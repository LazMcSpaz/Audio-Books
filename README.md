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

### Folder convention

```
/incoming   Source books you start from (.txt / .epub / .pdf).
/chunks     Stage 1 output: ch001_part01.txt … plus _REVIEW_FLAGS.txt.
/final      Stage 2 output: the reviewed, break-tagged chunks ready to narrate.
```

These folders are part of the repo as a documented convention. The web app
itself does **not** read or write them — it produces downloads in the browser.
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

It's a static site — just serve the folder (ES modules require `http://`, not
`file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## Cloudflare Pages deployment

This is a pure static client-side app, so deployment is trivial:

| Setting | Value |
|---------|-------|
| **Framework preset** | None |
| **Build command** | *(leave empty)* |
| **Build output directory** | `/` (repo root) |
| **Root directory** | *(leave empty)* |

Steps:

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
   Git**, and select this repo.
3. Use the settings above (no build step — Cloudflare just serves the files).
4. Deploy. Every push to the connected branch redeploys automatically.

No **Pages Functions** are needed — there is no server-side code. `_headers`
applies a few static security headers and is honored automatically by Pages.

### Libraries

The app loads two parsing libraries in the browser from cdnjs:

- **[JSZip](https://stuk.github.io/jszip/)** — unzips EPUBs and builds the
  ZIP download.
- **[pdf.js](https://mozilla.github.io/pdf.js/)** — extracts text from PDFs.

These run entirely client-side and make no API calls. (They are the only
external network requests the page makes; everything else is local.)

### Note on very large PDFs

PDF text extraction runs in the browser via pdf.js. For most public-domain
books this is fine. If you hit a memory/performance wall on an unusually large
or image-heavy PDF, convert it to `.txt` or `.epub` first rather than expecting
a backend — by design there isn't one. (If this ever becomes a routine problem,
the right fix is a Cloudflare Pages Function for PDF parsing; it is intentionally
not added here to keep the app free and backendless.)

---

## Design constraints (by request)

- **No AI/API calls** — pure deterministic text processing.
- **No backend** — static files only.
- **No `localStorage` / `sessionStorage`** — all state lives in memory for the
  session; reloading the page clears everything.
- **One file, no round-trips** — a single drag-drop upload; no download/re-upload
  within this stage.
