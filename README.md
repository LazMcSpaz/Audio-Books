# 📖 Audiobook Prep — Stage 1

A web app that prepares public-domain books for audiobook narration in
[ElevenLabs](https://elevenlabs.io). It does the deterministic, mechanical work:
stripping boilerplate, applying safe text fixes, detecting chapters, and chunking
the result into ElevenLabs-friendly `.txt` files. You can **batch-load many books
at once**, OCR scanned PDFs in the browser, and **push the finished chunks
straight to a repo branch**.

> **Zero AI calls.** All text parsing, OCR, cleaning, and chunking happen in your
> browser — no AI/LLM API, no cost. The text processing port is a direct
> translation of a tested Python reference (`prep_book.py`).
>
> **One tiny backend, by choice.** Deployed as a Cloudflare Worker that mostly
> just serves the static app. It also exposes a single password-gated endpoint
> (`/api/push`) that commits finished chunks to the repo using a server-side
> token — so a GitHub token never lives in the browser. If you don't connect it,
> the app is fully client-side and you just download a ZIP.

---

## The two-stage pipeline

This app is **Stage 1** of a two-stage workflow:

| Stage | Who | What | Folder |
|-------|-----|------|--------|
| **1. Mechanical** | This web app | Batch ingest, OCR scans, strip Gutenberg boilerplate, safe text fixes, chapter detection, chunking, ambiguity flagging, push to branch | `/incoming` → `chunks/<book>/` (on the push branch) |
| **2. Judgment** | A Claude Code agent | Review the chunks, resolve the flagged ambiguities, add `<break>` pause tags, polish archaic prose | `chunks/` → `final/` |

The app commits each finished book to a dedicated branch (default
`book-chunks`) under `chunks/<book-slug>/`. After a batch, you ask Claude Code to
review that branch and produce `final/`.

Stage 1 deliberately **never guesses** on ambiguous cases. It leaves them
untouched and writes them to `_REVIEW_FLAGS.txt` with surrounding context so the
Stage 2 reviewer (human + Claude) can resolve them deliberately.

### Repo layout

```
public/          The static web app served to the browser (index.html, css/, js/, _headers).
src/             The Worker: index.js (serves assets + /api/push) and github.js (commit logic).
wrangler.jsonc   Cloudflare Worker config (main = src/index.js, assets = ./public, push vars).
/incoming        Source books you start from (.txt / .epub / .pdf).
/chunks          Stage 1 output (the app pushes here, on the book-chunks branch).
/final           Stage 2 output: the reviewed, break-tagged chunks ready to narrate.
```

Only `public/` is published as web assets. `src/` runs as the Worker. The
`/incoming`, `/chunks`, and `/final` folders are a documented pipeline
convention; `/chunks` is where the app commits output (on the push branch). See
each folder's own `README.md`.

---

## Batch workflow

1. **Add books** — drag-drop or pick **multiple** `.txt`/`.epub`/`.pdf` files.
   They queue up in the list.
2. **(Optional) Connect the push backend** — type your app password and click
   **Connect**. Once connected, each finished book is committed to the repo
   branch automatically. Skip this to keep everything local.
3. **Leave _Auto-OCR_ on** so scanned PDFs are OCR'd without prompting (required
   for an unattended run).
4. **Start processing.** The app works through the queue one book at a time,
   OCR'ing scans as needed, and (if connected) pushing each book as it finishes.
   It requests a **screen wake lock** so the display won't sleep mid-run. Keep the
   tab in the foreground — browsers suspend background tabs.
5. Each book row shows chunk count, char count, flag count, audio-hour estimate,
   and push status. Expand a row to see the file list and review flags, or grab a
   per-book / **Download all as ZIP** if you're not pushing.
6. **Run the Stage 2 review pass**: ask Claude Code to review the `book-chunks`
   branch (`chunks/<book>/`), resolve the flags, add pause tags, and write
   `final/<book>/`.
7. **Narrate** the `final/` chunks in ElevenLabs.

---

## What Stage 1 does (in order)

1. **Strip Project Gutenberg boilerplate** — removes everything before the
   `*** START OF (THE|THIS) PROJECT GUTENBERG …***` marker and after the
   matching `*** END OF …***` marker (case-insensitive).
2. **Mechanical text fixes:**
   - Normalize smart quotes / curly apostrophes → straight quotes.
   - Em-dash → spaced `" — "` for a natural pause; en-dash → `-`; `…` → `...`.
   - Spell out whole-dollar amounts (`$1,500` → `one thousand five hundred dollars`).
   - Expand **title abbreviations** that always precede a name —
     `Dr. Mr. Mrs. Ms. Prof. Capt. Gen. Sgt. Gov. Sen. Rev.` — **without** adding
     a period (they never end a sentence).
   - Expand **phrase abbreviations** that *can* end a sentence —
     `vs. → versus`, `e.g. → for example`, `i.e. → that is`, `etc. → et cetera` —
     **preserving** the sentence-ending period when followed by whitespace + a
     capital letter.
   - Collapse runs of whitespace while preserving paragraph breaks.
3. **Detect chapters** via headings like `CHAPTER I`, `CHAPTER 1`,
   `Chapter One`, bare roman numerals, or bare numbered headings on their own
   line (optional trailing period).
4. **Chunk** each chapter into blocks under **4,500 characters** (ElevenLabs'
   hard per-paragraph limit is 5,000; the headroom is for the pause tags Stage 2
   adds). Breaks happen only at paragraph boundaries; a single oversized
   paragraph is split at sentence boundaries — **never mid-sentence**.

### Ambiguities it will NOT auto-fix (flagged for review)

These are collected into `_REVIEW_FLAGS.txt` with context, never changed:

- `St.` — Saint vs. Street
- `No.` + digits — likely "Number", but confirm
- times / ratios like `3:30`
- ordinals (`1st`, `2nd`, …)
- ampersands (`&`)
- all-caps tokens that aren't expected structural words (CHAPTER, BOOK, PART,
  VOLUME, PROLOGUE, EPILOGUE, and common short roman numerals are excluded)

---

## Output

- `ch001_part01.txt`, `ch002_part01.txt`, … — one file per chunk.
- `_REVIEW_FLAGS.txt` — every flagged item with a context snippet.
- **Download all as ZIP** bundles all of the above.

---

## Running locally

It's a static site — serve the `public/` folder (ES modules require `http://`,
not `file://`):

```bash
python3 -m http.server 8000 --directory public
# then open http://localhost:8000
```

Or, to preview exactly as Cloudflare will serve it (honoring `wrangler.jsonc`
and `_headers`):

```bash
npx wrangler dev
```

---

## Cloudflare deployment (full-stack Worker)

Cloudflare has **unified Workers and Pages** and recommends **Workers** for new
projects. This deploys as a **full-stack Worker**: it serves the static app from
`public/` (via the `ASSETS` binding) and runs `src/index.js` for the `/api/*`
routes. Static assets are served first, so the Worker script only executes for
the push endpoint.

`wrangler.jsonc`:

```jsonc
{
  "name": "audiobook-prep",
  "main": "src/index.js",
  "compatibility_date": "2026-06-04",
  "assets": { "directory": "./public", "binding": "ASSETS" },
  "vars": { "GITHUB_OWNER": "...", "GITHUB_REPO": "...", "GITHUB_BRANCH": "book-chunks" }
}
```

### Secrets (set once)

The push endpoint needs two secrets — **never** put these in `wrangler.jsonc`:

```bash
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: this repo, Contents: Read and write
npx wrangler secret put APP_PASSWORD   # the password you'll type in the app to authorize pushes
```

(In the dashboard you can instead set them under **Worker → Settings → Variables
and Secrets** as *encrypted* values.)

### Deploy by connecting Git (recommended)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a
   repository** → select this repo.
3. Build settings:
   - **Build command:** *(leave empty)*
   - **Deploy command:** `npx wrangler deploy`
   - Wrangler bundles `src/index.js` and uploads `public/` as assets.
4. Add the two secrets (above) to the Worker.
5. Deploy. Pushes to the connected branch redeploy automatically.

### Or deploy from your machine

```bash
npx wrangler deploy
```

`_headers` (static security headers) lives in `public/` and is
[honored natively by Workers static assets](https://developers.cloudflare.com/workers/static-assets/headers/).

### How the push works (security)

- The browser never sees the GitHub token. It sends finished chunk files to
  `POST /api/push` with your **app password** in the `X-App-Password` header.
- The Worker checks the password (constant-time) and, if valid, commits the files
  to `chunks/<slug>/` on the push branch using the server-side `GITHUB_TOKEN` (via
  the GitHub Git Data API — one commit per book).
- The endpoint validates the slug and only accepts `ch###_part##.txt` /
  `_REVIEW_FLAGS.txt` filenames, so it can't be used to write arbitrary paths.
- Because the deployed site is public, the app password is what stops strangers
  from pushing to your repo. **Use a strong app password.** For extra safety you
  can also put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/).
- Pushes target a dedicated branch (`book-chunks`), keeping book data off `main`
  and avoiding needless redeploys.

### Libraries

The app loads its parsing libraries in the browser from CDN:

- **[JSZip](https://stuk.github.io/jszip/)** — unzips EPUBs and builds the
  ZIP download.
- **[pdf.js](https://mozilla.github.io/pdf.js/)** — extracts text from PDFs and
  renders pages for OCR.
- **[Tesseract.js](https://tesseract.projectnaptha.com/)** — in-browser OCR for
  scanned PDFs (loaded lazily, only when you opt into OCR).

These run entirely client-side and make no API calls. The only request that ever
leaves the browser with your content is the optional `POST /api/push` to your own
Worker when you choose to push — and that carries just the finished chunk text.

### Scanned / image-only PDFs (OCR)

Some old public-domain books are **scans**: the PDF is a sequence of page images
with no embedded text layer, so ordinary extraction finds nothing. When the app
detects this (a PDF with little or no text relative to its page count), it offers
an **opt-in, in-browser OCR** pass:

- It renders each page with pdf.js and recognizes the text with **Tesseract.js**,
  a local WASM OCR engine. Nothing is uploaded and no API is called — it stays
  free and backendless, just like the rest of the app.
- OCR is **slow** and downloads ~15 MB of engine + English language data on
  first use. A full book can take several minutes.
- Per the no-storage rule, Tesseract is run with `cacheMethod: "none"`, so the
  language data is **not** persisted to IndexedDB (it re-downloads each session).
- OCR of old scans is **imperfect** — expect to fix recognition typos during the
  Stage 2 review pass. For badly degraded scans, a dedicated desktop OCR tool may
  give cleaner results; you can then feed the resulting `.txt` back in.

### Note on very large PDFs

PDF text extraction (and OCR) runs in the browser. For most public-domain books
this is fine. If you hit a memory/performance wall on an unusually large PDF — or
a very long scan where in-browser OCR is too slow — convert or pre-OCR it to
`.txt`/`.epub` on the desktop first and feed that in. The Worker backend only
handles the small commit step; the heavy text/OCR work stays in the browser by
design (it's free and needs real hardware anyway).

---

## Design constraints (by request)

- **No AI calls** — pure deterministic text processing. (The OCR pass uses
  Tesseract.js, which runs **locally** in the browser via WASM — no cloud AI, no
  cost.)
- **Minimal backend** — the Worker is mostly a static-file server; its only
  dynamic route is the password-gated `/api/push` commit endpoint. No database,
  no AI, no per-request cost of note.
- **No `localStorage` / `sessionStorage`** — all state (including the app
  password and any connection info) lives in memory for the session; reloading
  clears everything. OCR runs with `cacheMethod: "none"` so it doesn't persist
  language data to IndexedDB either.
- **Batch, no round-trips** — load many files at once; processing and OCR happen
  in place, and only the finished chunk text is sent (to your own Worker) when you
  push.
