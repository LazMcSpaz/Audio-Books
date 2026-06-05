# Stage 2 review notes — The Machinery of the Mind (Dion Fortune)

Reviewed from `chunks/dion-fortune-machinery-of-the-mind/` → this `final/` folder.
26 chapters (Foreword, Introduction, I–XXIV), 35 chunk files, all under the limit.

Stage 1 now does the structural work itself (chapter splitting, Global Grey
boilerplate removal, and one `<break time="1.5s" />` per chapter), so this pass
was the judgment-level cleanup only, applied in place over Stage 1's chunks:

## What this pass changed
- **Spoken chapter headings.** `I. The Physical Vehicle Of Consciousness` →
  `Chapter One. The Physical Vehicle Of Consciousness.` (Foreword / Introduction
  given a trailing period). The chapter `<break>` from Stage 1 is preserved.
- **All-caps resolved** (none are acronyms):
  - drop-cap opening words (`WHEN`, `THOSE`, `MUCH`, `IT`, `SHOULD`, …) →
    sentence case (`When`, `Those`, …);
  - in-text defining terms (`DENDRITE`, `AXON`, `SUBLIMATION`, `TRANSFERENCE`, …)
    → lowercase, so they're read as words rather than letter-by-letter.
- **Enumerated Roman list markers** (`I. … II. … III. … IV.`) in the Complexes
  and Reproductive-Instinct chapters → spoken ordinals (`First, … Second, …`).
  (One marker that the chunker split across the ch008 part01/part02 boundary was
  rejoined correctly.)
- **High-confidence OCR/typo fixes:** `-previous`→`previous`,
  `A.O. TANSLEY.`→`A. O. Tansley.`, `arid`→`and`, `may he said`→`may be said`,
  `mint pictures`→`mind pictures`, `selfpreservation`→`self-preservation`,
  `selfdisgust`→`self-disgust`, `put out conclusions`→`put our conclusions`,
  `Emile Couc'`→`Emile Coué`.
- Appended `The End.` to the final chapter.

## Left UNCHANGED for a human (uncertain — please check the source)
- `…minds untrained in web physical subtleties` (Introduction): **"web"** looks
  like a transcription error, but the intended word is unclear — not guessed.
- `the fatality functioning of the ductless glands` (Ch. 14): **"fatality"** may
  be "faulty", but uncertain — left as-is.
- `elan vitale`, `biourge` (Ch. 7): foreign/technical terms, left verbatim.
- Several `it's` for `its` — left as-is (identical when spoken).

## Suggested pronunciation aliases (for your ElevenLabs alias dictionary)
Plain respellings — NOT IPA (alias rules work on all models):
- Coué → `Koo-AY`; Jung → `Yoong`; Freud → `Froyd`; Freudian → `FROY-dee-an`
- Zurich → `ZYOOR-ik`; Du Bois → `doo-BWAH` (the Swiss therapist Paul Dubois)
- Nancy (New Nancy School) → `nahn-SEE`; horme → `HOR-mee`
- libido → `lib-EE-doh`; coprophilic → `kop-ro-FIL-ik`
