# Stage 2 review notes — The Machinery of the Mind (Dion Fortune)

Reviewed from `chunks/dion-fortune-machinery-of-the-mind/` → this `final/` folder.
26 chapters, 39 chunk files, ~100,000 characters, all chunks under the 4,500 limit.

## Structural changes
- **Restored chapter structure.** Stage 1 detected no chapters (everything was
  `ch001`) because the headings are inline Roman-numeral style (`VII. The
  Instincts`), which the detector doesn't match. Re-split into the book's real
  sections: Foreword, Introduction, and chapters I–XXIV → `ch001`…`ch026`.
- **Removed Global Grey boilerplate.** The source is a Global Grey edition (not
  Project Gutenberg), so Stage 1's Gutenberg stripper left it in. Removed the
  front matter (title block, "published by Global Grey…", download URL) and the
  back-matter promo footer ("I'm Julie, the woman who runs Global Grey…").
- **Removed the table of contents** (not useful read aloud).
- **Headings** rendered as `Chapter One. <Title>.` etc. (Foreword/Introduction
  by name), each followed by a single `<break time="1.5s" />`. That is the only
  pause tag added — 26 total, one per chapter. No paragraph/scene/emphasis
  breaks (kept deliberately conservative; emphasis is for a later human pass).
- Appended a closing `The End.`

## Flag resolutions (the 80 `_REVIEW_FLAGS.txt` items)
- **All-caps tokens** were the bulk. None are acronyms, so none are spelled out:
  - **Drop-cap opening words** (`WHEN`, `THOSE`, `WHILE`, `ORIGINALLY`, `IT`,
    `WE`, `MUCH`, `SHOULD`…) → normal sentence case (`When`, `Those`, …).
  - **Defining terms in caps** (`DENDRITE`, `AXON`, `CENSOR`, `CONSCIOUS MIND`,
    `SUBLIMATION`, `REPRESSION`, `TRANSFERENCE`, `ABREACTION`, etc.) → lowercased
    so they're read as words, not letter-by-letter.
  - **Roman-numeral headings** → spoken chapter numbers (handled above).
- **Enumerated Roman list markers** (`I. … II. … III. … IV.`) in the Complexes
  and Reproductive-Instinct chapters → spoken ordinals (`First, … Second, …`).
- The lone **ordinal** flag (`21st May 2025`) was in the Global Grey boilerplate,
  now removed.

## High-confidence OCR/typo fixes (changed)
- `any -previous knowledge` → `any previous knowledge`
- `A.O. TANSLEY.` → `A. O. Tansley.`
- `insanity arid neuroticism` → `insanity and neuroticism`
- `an emotion may he said` → `an emotion may be said`
- `subjective mint pictures` → `subjective mind pictures`
- `selfpreservation` → `self-preservation`; `selfdisgust` → `self-disgust`
- `put out conclusions` → `put our conclusions`
- `Emile Couc'` → `Emile Coué` (the autosuggestion pioneer of the New Nancy school)

## Left UNCHANGED for a human (uncertain — please check the source)
- `…convey novel concepts to minds untrained in web physical subtleties` (Intro):
  **"web"** looks like a transcription error, but the intended word is unclear —
  not guessed.
- `the fatality functioning of the ductless glands` (Ch. 14): **"fatality"** may
  be "faulty", but uncertain — left as-is.
- `elan vitale` and `biourge` (Ch. 7): foreign/technical terms, left verbatim.
- Several `it's` used for `its` — left as-is (identical when spoken).

## Suggested pronunciation aliases (for your ElevenLabs alias dictionary)
Plain respellings — NOT IPA (alias rules work on all models):
- Coué → `Koo-AY`
- Jung → `Yoong`
- Freud → `Froyd`; Freudian → `FROY-dee-an`
- Zurich → `ZYOOR-ik`
- Du Bois → `doo-BWAH`  (the Swiss psychotherapist Paul Dubois)
- Nancy (New Nancy School) → `nahn-SEE` (French city; or keep `NAN-see` if preferred)
- horme → `HOR-mee`; libido → `lib-EE-doh`; coprophilic → `kop-ro-FIL-ik`
