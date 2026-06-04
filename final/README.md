# /final — Stage 2 output (ready to narrate)

After the **Stage 2** review pass, the polished chunks land here, one folder per
book:

```
/final/the-time-machine/ch001_part01.txt
/final/the-time-machine/ch002_part01.txt
```

What Stage 2 does to get here (Claude Code reviewing `/chunks/<book-name>/`):

- Resolves every item in `_REVIEW_FLAGS.txt` (St. → Saint/Street, No. → Number,
  ordinals, ratios, ampersands, all-caps acronyms, etc.).
- Adds `<break>` pause tags for natural narration pacing.
- Polishes archaic phrasing where it would read awkwardly aloud.

These files are what you paste into ElevenLabs for narration. Each stays under
the 5,000-character per-paragraph limit even after pause tags are added (Stage 1
chunked to 4,500 to leave the headroom).
