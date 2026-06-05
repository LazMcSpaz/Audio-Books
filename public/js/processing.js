/*
 * processing.js — Stage 1 text pipeline, ported 1:1 from the tested
 * prep_book.py reference. Pure, deterministic, browser-side. No AI/API calls.
 *
 * Order of operations matches the reference exactly:
 *   stripGutenberg -> applyMechanicalFixes -> collectFlags -> splitIntoChapters
 *   -> chunkChapter (per chapter)
 *
 * Everything here is a pure function so it can be reasoned about and tested
 * independently of the DOM / file ingestion.
 */

// ElevenLabs hard limit per paragraph is 5000 chars. We target lower to leave
// room for the <break> tags the Claude review pass adds in Stage 2.
export const DEFAULT_MAX_CHARS = 4500;

// ---------------------------------------------------------------------------
// BOILERPLATE REMOVAL — strip Project Gutenberg license wrappers
// ---------------------------------------------------------------------------

export function stripGutenberg(text) {
  const startRe = /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[\s\S]*?\*\*\*/i;
  const endRe = /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG[\s\S]*?\*\*\*/i;

  const start = startRe.exec(text);
  if (start) {
    text = text.slice(start.index + start[0].length);
  }
  // Re-search for the END marker in the (possibly trimmed) text.
  const end = endRe.exec(text);
  if (end) {
    text = text.slice(0, end.index);
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// MECHANICAL FIXES — safe substitutions that read better aloud
// ---------------------------------------------------------------------------

// Titles that are virtually always followed by a capitalized name — these are
// NEVER sentence-ends, so we expand them without adding a period.
const TITLE_ABBR = [
  [/\bDr\./g, "Doctor"],
  [/\bMr\./g, "Mister"],
  [/\bMrs\./g, "Missus"],
  [/\bMs\./g, "Miss"],
  [/\bProf\./g, "Professor"],
  [/\bCapt\./g, "Captain"],
  [/\bGen\./g, "General"],
  [/\bSgt\./g, "Sergeant"],
  [/\bGov\./g, "Governor"],
  [/\bSen\./g, "Senator"],
  [/\bRev\./g, "Reverend"],
];

// These can legitimately end a sentence, so we preserve a following period.
// Source pattern (without flags) is kept so we can build two regexes from it.
const PHRASE_ABBR = [
  ["\\bvs\\.", "versus"],
  ["\\be\\.g\\.", "for example"],
  ["\\bi\\.e\\.", "that is"],
  ["\\betc\\.", "et cetera"],
];

// Curly/smart quote and dash normalization so the TTS doesn't choke.
const QUOTE_MAP = [
  ["“", '"'], ["”", '"'],
  ["‘", "'"], ["’", "'"],
  ["—", " — "], // em dash with spaces -> natural pause
  ["–", "-"],        // en dash
  ["…", "..."],      // ellipsis
];

// Compact integer-to-words for amounts likely in prose (<1,000,000).
export function numberToWords(n) {
  const ones = ["zero","one","two","three","four","five","six","seven","eight","nine",
    "ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen",
    "seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 === 0 ? "" : "-" + ones[n % 10]);
  if (n < 1000) return ones[Math.floor(n / 100)] + " hundred" + (n % 100 === 0 ? "" : " " + numberToWords(n % 100));
  if (n < 1000000) return numberToWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 === 0 ? "" : " " + numberToWords(n % 1000));
  return String(n); // leave very large numbers alone
}

function spellOutMoney(text) {
  // $100 -> one hundred dollars (whole-dollar amounts only; (?!\.\d) skips cents)
  return text.replace(/\$([\d,]+)(?!\.\d)/g, (_m, g1) => {
    const n = parseInt(g1.replace(/,/g, ""), 10);
    return `${numberToWords(n)} dollars`;
  });
}

export function applyMechanicalFixes(text) {
  // Smart quotes / dashes / ellipsis.
  for (const [ch, repl] of QUOTE_MAP) {
    text = text.split(ch).join(repl);
  }
  // Titles: expand directly, never add a period.
  for (const [pat, repl] of TITLE_ABBR) {
    text = text.replace(pat, repl);
  }
  // Phrase abbreviations: if followed by whitespace + capital, the period was
  // ending a sentence — preserve it. Then expand any remaining occurrences.
  for (const [pat, repl] of PHRASE_ABBR) {
    const sentenceEnd = new RegExp(pat + "(\\s+)([A-Z])", "g");
    text = text.replace(sentenceEnd, (_m, ws, cap) => repl + "." + ws + cap);
    text = text.replace(new RegExp(pat, "g"), repl);
  }
  text = spellOutMoney(text);
  // Collapse runs of whitespace but preserve paragraph breaks.
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

// ---------------------------------------------------------------------------
// AMBIGUITY FLAGS — never auto-fixed; collected with context for the review pass
// ---------------------------------------------------------------------------

// [sourcePattern, flags, note]. Order preserved from the reference.
const FLAG_PATTERNS = [
  ["\\bSt\\.", "g", "St. — Saint or Street? (left unchanged)"],
  ["\\bNo\\.\\s*\\d", "g", "No. — likely 'Number'; confirm in context"],
  ["\\b\\d{1,2}:\\d{2}\\b", "g", "time/ratio — confirm how it should be read"],
  ["\\b\\d+(st|nd|rd|th)\\b", "g", "ordinal — confirm spelled-out form"],
  ["&", "g", "ampersand — read as 'and'?"],
  ["\\b[A-Z]{2,}\\b", "g", "all-caps token — acronym (spell letters) or emphasis?"],
];

const ALLCAPS_PATTERN = "\\b[A-Z]{2,}\\b";

// Expected structural / common all-caps words we do NOT flag.
const ALLCAPS_SKIP = new Set([
  "CHAPTER", "BOOK", "PART", "VOLUME", "PROLOGUE", "EPILOGUE",
  "THE", "AND", "OR", "OF", "II", "III", "IV", "VI", "IX", "XI",
]);

export function collectFlags(text) {
  const flags = [];
  for (const [pat, fl, note] of FLAG_PATTERNS) {
    const re = new RegExp(pat, fl);
    let m;
    while ((m = re.exec(text)) !== null) {
      const tok = m[0];
      if (pat === ALLCAPS_PATTERN && ALLCAPS_SKIP.has(tok)) {
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
        continue;
      }
      const lo = Math.max(0, m.index - 35);
      const hi = Math.min(text.length, m.index + tok.length + 35);
      const snippet = text.slice(lo, hi).replace(/\n/g, " ").trim();
      flags.push({ note, snippet: `...${snippet}...`, token: tok });
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width matches
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// PRONUNCIATION EXTRACTION — candidate terms a TTS voice may mispronounce
// ---------------------------------------------------------------------------

/*
 * Letter patterns that are rare in ordinary English and tend to mark
 * foreign / esoteric / technical terms. Deliberately broad — recall matters
 * more than precision here, because the human triages the list by frequency.
 * Easy to extend: just add a regex.
 */
const RARE_LETTER_PATTERNS = [
  /[^\x00-\x7F]/,        // any non-ASCII letter (diacritics, non-Latin scripts)
  /aa|ii|uu/i,           // double vowels uncommon in English
  /q(?!u)/i,             // q not followed by u (Qabalah, Iraq, qi)
  /yph/i,                // glyph-like clusters
  /(kh|zh|tz|cz|sz)/i,   // transliteration digraphs (Khan, Zhukov, Mirza)
  /[wxz]{2,}/i,          // doubled rare consonants
];

// A token is sentence-initial if the nearest non-space, non-opening-punctuation
// character before it is a sentence terminator, a newline, or the start of the
// text. Lets us tell proper nouns from ordinary words that merely open a sentence.
function isSentenceInitial(text, idx) {
  let i = idx - 1;
  while (i >= 0) {
    const c = text[i];
    if (c === " " || c === "\t" || c === '"' || c === "'" || c === "’" ||
        c === "(" || c === "[" || c === "*" || c === "_") { i--; continue; }
    break;
  }
  if (i < 0) return true;
  const c = text[i];
  return c === "\n" || c === "." || c === "!" || c === "?";
}

const PRON_ALLCAPS = /^[A-Z]{2,}$/;

function isPronunciationCandidate(term, hasNonInitial) {
  // (2) all-caps tokens, excluding the structural words the flags logic skips.
  if (PRON_ALLCAPS.test(term) && !ALLCAPS_SKIP.has(term)) return true;
  // (3) rare-in-English letter patterns / non-ASCII letters.
  if (RARE_LETTER_PATTERNS.some((re) => re.test(term))) return true;
  // (1) capitalized but appearing somewhere NOT at a sentence start -> proper
  //     noun (name, place). Skips all-caps (handled above) and words that only
  //     ever open a sentence (can't tell those from ordinary capitalization).
  const startsUpper = /^\p{Lu}/u.test(term);
  const hasLower = /\p{Ll}/u.test(term);
  if (startsUpper && hasLower && !PRON_ALLCAPS.test(term) && hasNonInitial) return true;
  // (4) not-in-wordlist check: intentionally skipped in the browser. There is no
  //     system wordlist here, and per spec we skip the sub-check rather than ship
  //     a heavy bundled dictionary. (The Python reference does run this check.)
  return false;
}

/*
 * Scan cleaned text and return candidate terms sorted by frequency (desc).
 * Returns [{ term, count }]. Case-preserving and case-SENSITIVE — "Word" and
 * "word" are distinct rows, because ElevenLabs alias rules are case-sensitive.
 */
export function extractPronunciation(text) {
  const tokenRe = /\p{L}[\p{L}'’]*/gu;
  const terms = new Map(); // term -> { count, hasNonInitial }
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const term = m[0].replace(/^['’]+|['’]+$/g, "");
    if (!term) continue;
    let rec = terms.get(term);
    if (!rec) { rec = { count: 0, hasNonInitial: false }; terms.set(term, rec); }
    rec.count++;
    if (!isSentenceInitial(text, m.index)) rec.hasNonInitial = true;
  }
  const out = [];
  for (const [term, rec] of terms) {
    if (isPronunciationCandidate(term, rec.hasNonInitial)) out.push({ term, count: rec.count });
  }
  out.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return out;
}

export function buildPronunciationTsv(candidates) {
  const header = [
    "# _PRONUNCIATION.tsv — terms a text-to-speech voice may mispronounce.",
    "# Fill the 'alias' column with a plain phonetic RESPELLING, e.g.",
    "#   Qabalah  ->  Kah-BAH-lah",
    "# In ElevenLabs these become ALIAS rules, which work on ALL models.",
    "# Do NOT put IPA / phonemes here: phoneme rules only apply to",
    "# eleven_flash_v2 and are silently IGNORED on V3 and other models.",
    "# Sorted by frequency (most-spoken first) so you can triage the",
    "# high-impact names first. Case-sensitive: 'Word' and 'word' are separate.",
    "# Tab-separated; leave 'alias'/'notes' blank to fill in.",
    "#",
    "term\tcount\talias\tnotes",
  ].join("\n");
  const rows = candidates.map((c) => `${c.term}\t${c.count}\t\t`).join("\n");
  return `${header}\n${rows}\n`;
}

// ---------------------------------------------------------------------------
// CHAPTER DETECTION + CHUNKING
// ---------------------------------------------------------------------------

// "CHAPTER I", "CHAPTER 1", "Chapter One", bare roman numerals, or bare numbered
// headings on their own line, with an optional trailing period.
const CHAPTER_RE = /^[ \t]*(chapter\s+[\dIVXLC]+\.?|chapter\s+\w+\.?|[IVXLC]+\.|\d+\.)[ \t]*$/gim;

export function splitIntoChapters(text) {
  const matches = [];
  let m;
  CHAPTER_RE.lastIndex = 0;
  while ((m = CHAPTER_RE.exec(text)) !== null) {
    matches.push({ title: m[0].trim(), start: m.index });
    if (m.index === CHAPTER_RE.lastIndex) CHAPTER_RE.lastIndex++;
  }
  if (matches.length === 0) {
    return [{ title: "Book", body: text }];
  }
  const chapters = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    chapters.push({ title: matches[i].title, body: text.slice(start, end).trim() });
  }
  return chapters;
}

// Split a chapter into <=maxChars blocks, breaking only at paragraph boundaries
// so we never cut a sentence mid-flow. Oversized paragraphs split on sentences.
export function chunkChapter(body, maxChars) {
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > maxChars) {
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (cur.length + s.length + 1 > maxChars && cur) {
          chunks.push(cur.trim());
          cur = "";
        }
        cur += s + " ";
      }
      continue;
    }
    if (cur.length + p.length + 2 > maxChars && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += p + "\n\n";
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// ---------------------------------------------------------------------------
// STRUCTURAL PAUSES — conservative <break> tags at unambiguous boundaries only
// ---------------------------------------------------------------------------

// Guiding principle (do not violate): UNDER-tag rather than over-tag. Too many
// breaks, or long ones, destabilize ElevenLabs and sound worse than none. So we
// emit a pause only where the structure is mechanically certain: after a chapter
// heading, and at an explicit scene-divider line. Ordinary paragraph breaks get
// NOTHING — the model paces those from the text itself.
const CHAPTER_BREAK = '<break time="1.5s" />';
const SCENE_BREAK = '<break time="1.0s" />';

// A scene divider is a short line of only divider symbols (e.g. "***", "* * *",
// "---"). A bare blank-line gap is NOT treated as a divider: applyMechanicalFixes
// already collapsed large gaps to a single blank line, making them
// indistinguishable from ordinary paragraph breaks — tagging them would be
// exactly the over-tagging we must avoid.
function isSceneDivider(par) {
  const t = par.trim();
  if (t.length === 0 || t.length > 40) return false;
  if (!/^[\s*#~·•=_\-—–]+$/.test(t)) return false;
  return t.replace(/\s/g, "").length >= 3;
}

/*
 * Insert structural break tags into one chapter body (which begins with its
 * title line). Returns { body, breaks }. A no-op when `enabled` is false.
 */
export function insertStructuralBreaks(body, title, enabled) {
  if (!enabled) return { body, breaks: 0 };
  let breaks = 0;
  const paras = body.split(/\n\s*\n/);

  // 1) After the chapter title, before the body — but only when the body really
  //    starts with the title line (skips the synthetic single "Book" chapter,
  //    whose body has no heading line).
  if (paras.length && title) {
    const lines = paras[0].split("\n");
    if (lines[0].trim() === title.trim()) {
      lines.splice(1, 0, CHAPTER_BREAK);
      paras[0] = lines.join("\n");
      breaks++;
    }
  }

  // 2) Replace explicit scene-divider lines with a scene break.
  for (let i = 0; i < paras.length; i++) {
    if (isSceneDivider(paras[i])) {
      paras[i] = SCENE_BREAK;
      breaks++;
    }
  }

  return { body: paras.join("\n\n"), breaks };
}

// ---------------------------------------------------------------------------
// ORCHESTRATION
// ---------------------------------------------------------------------------

function pad(n, width) {
  return String(n).padStart(width, "0");
}

/*
 * Run the full pipeline on raw ingested text. Returns:
 *   { files: [{name, title, text, chars}], flags, chapters, totalChars,
 *     reviewFlagsText, pronunciation, pronunciationTsv, pronunciationCount,
 *     breakCount, chapterCount, chunkCount }
 *
 * options.insertBreaks (default true) toggles structural <break> insertion.
 */
export function processBook(rawText, maxChars = DEFAULT_MAX_CHARS, options = {}) {
  const { insertBreaks = true } = options;
  const stripped = stripGutenberg(rawText);
  const cleaned = applyMechanicalFixes(stripped);
  const flags = collectFlags(cleaned);
  // Pronunciation scan runs on the cleaned text, before any break tags are added.
  const pronunciation = extractPronunciation(cleaned);
  const pronunciationTsv = buildPronunciationTsv(pronunciation);
  const chapters = splitIntoChapters(cleaned);

  const files = [];
  let breakCount = 0;
  chapters.forEach((ch, ci) => {
    const chNum = ci + 1;
    const { body, breaks } = insertStructuralBreaks(ch.body, ch.title, insertBreaks);
    breakCount += breaks;
    const parts = chunkChapter(body, maxChars);
    parts.forEach((chunk, pi) => {
      const name = `ch${pad(chNum, 3)}_part${pad(pi + 1, 2)}.txt`;
      files.push({ name, title: ch.title, text: chunk, chars: chunk.length });
    });
  });

  const totalChars = files.reduce((acc, f) => acc + f.chars, 0);
  const reviewFlagsText = buildReviewFlagsText(flags);

  return {
    files,
    flags,
    chapters,
    totalChars,
    reviewFlagsText,
    pronunciation,
    pronunciationTsv,
    pronunciationCount: pronunciation.length,
    breakCount,
    chapterCount: chapters.length,
    chunkCount: files.length,
  };
}

export function buildReviewFlagsText(flags) {
  let out = `${flags.length} items the script left for manual review:\n\n`;
  for (const f of flags) {
    out += `[${f.note}]\n  ${f.snippet}\n\n`;
  }
  return out;
}

// Estimates surfaced in the UI summary.
export function estimateMonths(totalChars) {
  return totalChars / 100000; // ElevenLabs Creator plan = 100,000 chars/month
}

export function estimateAudioHours(totalChars) {
  // Matches the reference: ~1.1 minutes of audio per 1,000 chars.
  return (totalChars / 1000) * 1.1 / 60;
}
