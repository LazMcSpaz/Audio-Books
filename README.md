# 📖 Audiobook Prep — Stage 1

A static, **100% client-side** web app that prepares public-domain books for
audiobook narration in [ElevenLabs](https://elevenlabs.io). It does the
deterministic, mechanical work: stripping boilerplate, applying safe text
fixes, detecting chapters, and chunking the result into ElevenLabs-friendly
`.txt` files.

> **Zero AI / API calls.** All parsing and processing happens in your browser.
> Nothing is uploaded, there is no backend, and it costs nothing to run.
> This is a direct port of a tested Python reference (`prep_book.py`).

---

## The two-stage pipeline

This app is **Stage 1** of a two-stage workflow:

| Stage | Who | What | Folder |
|-------|-----|------|--------|
| **1. Mechanical** | This web app | Strip Gutenberg boilerplate, safe text fixes, chapter detection, chunking, ambiguity flagging | `/incoming` → `/chunks` |
| **2. Judgment** | A Claude Code agent | Review the chunks, resolve the flagged ambiguities, add `<break>` pause tags, polish archaic prose | `/chunks` → `/final` |

Stage 1 deliberately **never guesses** on ambiguous cases. It leaves them
untouched and writes them to `_REVIEW_FLAGS.txt` with surrounding context so the
Stage 2 reviewer (human + Claude) can resolve them deliberately.

### Repo layout

```
public/          The static web app that gets deployed (index.html, css/, js/, _headers).
wrangler.jsonc   Cloudflare Workers static-assets config (points at ./public).
/incoming        Source books you start from (.txt / .epub / .pdf).
/chunks          Stage 1 output: ch001_part01.txt … plus _REVIEW_FLAGS.txt.
/final           Stage 2 output: the reviewed, break-tagged chunks ready to narrate.
```

Only `public/` is published to the web. The `/incoming`, `/chunks`, and `/final`
folders are a documented pipeline convention kept in the repo for organization;
they are **not** served. The web app itself does **not** read or write them — it
produces downloads in the browser.
You save those downloads into `/chunks/<book-name>/` to keep the pipeline tidy.
See each folder's own `README.md` for details.

---

## Per-book steps

1. **Drop the source** into the app (drag-drop or click). One file at a time —
   `.txt`, `.epub`, or `.pdf`. (Conventionally you keep the original in
   `/incoming/<book-name>/`.)
2. **Review the on-screen summary**: chapters detected, chunk count, total
   characters, estimated ElevenLabs Creator-plan months (at 100,000 chars/mo),
   and estimated audio hours.
3. **Read the Review Flags panel** — this is the most important output. It lists
   every ambiguous token the app refused to auto-fix, grouped by type, with
   context snippets.
4. **Download all as ZIP** (chunks + `_REVIEW_FLAGS.txt`) and unzip into
   `/chunks/<book-name>/`. (Or grab individual files.)
5. **Run the Stage 2 review pass** with Claude Code over `/chunks/<book-name>/`,
   resolving the flags and adding pause tags. Write results to
   `/final/<book-name>/`.
6. **Narrate** the `/final` chunks in ElevenLabs.

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

## Cloudflare deployment (Workers static assets)

Cloudflare has **unified Workers and Pages**, and now recommends **Workers with
static assets** for new static sites (Pages still works, but new features and
optimizations target Workers). So this deploys as a **Worker** — a purely static
one with **no Worker script**. Cloudflare just serves the files in `public/`.

The config is `wrangler.jsonc`:

```jsonc
{
  "name": "audiobook-prep",
  "compatibility_date": "2026-06-04",
  "assets": { "directory": "./public" }
}
```

There is no `main` (no server code), no build step, and no Functions.

### Deploy by connecting Git (recommended)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a
   repository** (Workers Builds) → select this repo.
3. Build settings:
   - **Build command:** *(leave empty — nothing to build)*
   - **Deploy command:** `npx wrangler deploy`
   - Cloudflare reads `wrangler.jsonc` and uploads `public/` as static assets.
4. Deploy. Every push to the connected branch redeploys automatically.

### Or deploy from your machine

```bash
npx wrangler deploy
```

`_headers` (a few static security headers) lives inside `public/` and is
[honored natively by Workers static assets](https://developers.cloudflare.com/workers/static-assets/headers/),
just as it was under Pages.

### Libraries

The app loads its parsing libraries in the browser from CDN:

- **[JSZip](https://stuk.github.io/jszip/)** — unzips EPUBs and builds the
  ZIP download.
- **[pdf.js](https://mozilla.github.io/pdf.js/)** — extracts text from PDFs and
  renders pages for OCR.
- **[Tesseract.js](https://tesseract.projectnaptha.com/)** — in-browser OCR for
  scanned PDFs (loaded lazily, only when you opt into OCR).

These run entirely client-side and make no API calls. (They are the only
external network requests the page makes; everything else is local.)

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
`.txt`/`.epub` first and feed that in, rather than expecting a backend; by design
there isn't one. (If this ever becomes a routine problem, the right fix is to add
a `main` Worker script to `wrangler.jsonc` and do the heavy lifting server-side
via the `ASSETS`-bound Worker; it is intentionally not added here to keep the app
free and backendless.)

---

## Design constraints (by request)

- **No AI/API calls** — pure deterministic text processing. (The optional OCR
  pass uses Tesseract.js, which runs **locally** in the browser via WASM — no
  cloud API, no uploads, no cost.)
- **No backend** — static files only.
- **No `localStorage` / `sessionStorage`** — all state lives in memory for the
  session; reloading the page clears everything. (OCR is run with
  `cacheMethod: "none"` so it doesn't persist language data to IndexedDB either.)
- **One file, no round-trips** — a single drag-drop upload; no download/re-upload
  within this stage.
