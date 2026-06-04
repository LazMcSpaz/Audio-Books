/*
 * app.js — UI glue. Wires the drag-drop zone to the ingest + processing
 * pipeline and renders the summary, chunk list, and review-flags panels.
 *
 * State lives only in memory for the session — no localStorage/sessionStorage.
 */

import { ingest, fileExtension } from "./ingest.js";
import { pdfLooksScanned, ocrPdf } from "./ocr.js";
import {
  processBook,
  estimateMonths,
  estimateAudioHours,
  DEFAULT_MAX_CHARS,
} from "./processing.js";

const ACCEPTED = new Set([".txt", ".epub", ".pdf"]);

// In-memory result for the current session (used by ZIP/download actions).
let current = null;

const $ = (sel) => document.querySelector(sel);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function num(n) {
  return n.toLocaleString("en-US");
}

function setStatus(msg, kind = "info") {
  const el = $("#status");
  el.textContent = msg;
  el.className = `status status--${kind}`;
  el.hidden = !msg;
}

function show(el) { el.hidden = false; }

// --- rendering ------------------------------------------------------------

function renderSummary(result, sourceName) {
  const months = estimateMonths(result.totalChars);
  const hours = estimateAudioHours(result.totalChars);
  $("#summary").innerHTML = `
    <h2>Processing summary</h2>
    <p class="muted">Source: <strong>${escapeHtml(sourceName)}</strong></p>
    <div class="stats">
      <div class="stat"><span class="stat__n">${num(result.chapterCount)}</span><span class="stat__l">chapters detected</span></div>
      <div class="stat"><span class="stat__n">${num(result.chunkCount)}</span><span class="stat__l">chunks generated</span></div>
      <div class="stat"><span class="stat__n">${num(result.totalChars)}</span><span class="stat__l">total characters</span></div>
      <div class="stat"><span class="stat__n">${months.toFixed(1)}</span><span class="stat__l">Creator-plan months<br><small>(100k chars/mo)</small></span></div>
      <div class="stat"><span class="stat__n">~${hours.toFixed(1)}</span><span class="stat__l">estimated audio hours</span></div>
      <div class="stat"><span class="stat__n">${num(result.flags.length)}</span><span class="stat__l">items to review</span></div>
    </div>
    <div class="actions">
      <button id="downloadZip" class="btn btn--primary">Download all as ZIP</button>
      <button id="downloadFlags" class="btn">Download _REVIEW_FLAGS.txt</button>
    </div>
  `;
  show($("#summary"));
  $("#downloadZip").addEventListener("click", onDownloadZip);
  $("#downloadFlags").addEventListener("click", onDownloadFlags);
}

function renderChunks(result) {
  const rows = result.files
    .map(
      (f) => `
      <li class="chunk">
        <span class="chunk__name">${escapeHtml(f.name)}</span>
        <span class="chunk__title">${escapeHtml(f.title)}</span>
        <span class="chunk__chars ${f.chars > 5000 ? "over" : ""}">${num(f.chars)} chars</span>
        <button class="btn btn--sm" data-file="${escapeHtml(f.name)}">download</button>
      </li>`
    )
    .join("");
  $("#chunks").innerHTML = `
    <h2>Generated chunks <span class="muted">(${result.files.length})</span></h2>
    <ul class="chunk-list">${rows}</ul>
  `;
  show($("#chunks"));
  $("#chunks").querySelectorAll("button[data-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = current.files.find((x) => x.name === btn.dataset.file);
      if (f) downloadBlob(new Blob([f.text], { type: "text/plain" }), f.name);
    });
  });
}

function renderFlags(result) {
  const panel = $("#flags");
  if (result.flags.length === 0) {
    panel.innerHTML = `<h2>Review flags</h2><p class="ok">No ambiguous items detected. 🎉</p>`;
    show(panel);
    return;
  }
  // Group by note for a scannable view.
  const groups = new Map();
  for (const f of result.flags) {
    if (!groups.has(f.note)) groups.set(f.note, []);
    groups.get(f.note).push(f);
  }
  let html = `<h2>⚠️ Review flags <span class="muted">(${result.flags.length})</span></h2>
    <p class="muted">These were left <strong>untouched</strong>. Resolve them in the Stage 2 review pass.</p>`;
  for (const [note, items] of groups) {
    html += `<details open class="flag-group">
      <summary>${escapeHtml(note)} <span class="badge">${items.length}</span></summary>
      <ul>${items
        .map((it) => `<li><code>${escapeHtml(it.snippet)}</code></li>`)
        .join("")}</ul>
    </details>`;
  }
  panel.innerHTML = html;
  show(panel);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- actions --------------------------------------------------------------

async function onDownloadZip() {
  if (!current) return;
  if (typeof JSZip === "undefined") {
    setStatus("JSZip unavailable — use the per-file download buttons instead.", "error");
    return;
  }
  const zip = new JSZip();
  for (const f of current.files) zip.file(f.name, f.text);
  zip.file("_REVIEW_FLAGS.txt", current.reviewFlagsText);
  const blob = await zip.generateAsync({ type: "blob" });
  const base = current.sourceName.replace(/\.[^.]+$/, "") || "book";
  downloadBlob(blob, `${base}_chunks.zip`);
}

function onDownloadFlags() {
  if (!current) return;
  downloadBlob(
    new Blob([current.reviewFlagsText], { type: "text/plain" }),
    "_REVIEW_FLAGS.txt"
  );
}

// --- OCR fallback (scanned / image-only PDFs) -----------------------------

// Render the opt-in OCR offer when a PDF has no usable text layer.
function offerOcr(file, { empty } = {}) {
  current = null;
  const panel = $("#ocr");
  const lead = empty
    ? `<strong>No text could be extracted from this PDF.</strong> It looks like a
       scan (page images with no text layer).`
    : `<strong>This PDF looks like a scan</strong> — page images with little or no
       embedded text.`;
  panel.innerHTML = `
    <h2>📄 Scanned PDF detected</h2>
    <p>${lead}</p>
    <p class="muted">
      You can run <strong>OCR in your browser</strong> to read the text off the
      page images. It runs locally — nothing is uploaded and no API is called —
      but it's slow and downloads ~15&nbsp;MB of engine/language data on first
      use. OCR of old scans is imperfect; expect to fix typos in the Stage 2
      review pass.
    </p>
    <div class="actions">
      <button id="runOcr" class="btn btn--primary">Run OCR in browser</button>
    </div>
    <div id="ocrProgress" class="ocr-progress" hidden>
      <div class="ocr-bar"><div id="ocrBar" class="ocr-bar__fill"></div></div>
      <p id="ocrMsg" class="muted"></p>
    </div>
  `;
  show(panel);
  $("#runOcr").addEventListener("click", () => runOcr(file));
}

async function runOcr(file) {
  const btn = $("#runOcr");
  if (btn) btn.disabled = true;
  const progress = $("#ocrProgress");
  const bar = $("#ocrBar");
  const msg = $("#ocrMsg");
  if (progress) progress.hidden = false;

  const setProgress = (frac, text) => {
    if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
    if (msg) msg.textContent = text;
  };

  try {
    setProgress(0, "Loading OCR engine…");
    const text = await ocrPdf(file, (p) => {
      if (p.phase === "engine") {
        setProgress(0, `Preparing OCR engine — ${p.status}…`);
      } else if (p.phase === "page") {
        // Overall fraction = completed pages + this page's progress.
        const frac = (p.page - 1 + (p.progress || 0)) / p.total;
        setProgress(frac, `OCR page ${p.page} of ${p.total} — ${Math.round((p.progress || 0) * 100)}%`);
      }
    });
    if (!text || !text.trim()) {
      setStatus("OCR finished but found no readable text on the pages.", "error");
      return;
    }
    $("#ocr").hidden = true;
    await finish(text, file.name);
  } catch (err) {
    console.error(err);
    setStatus(`OCR error: ${err.message}`, "error");
    if (btn) btn.disabled = false;
  }
}

// --- main flow ------------------------------------------------------------

function resetPanels() {
  current = null;
  for (const id of ["#summary", "#flags", "#chunks", "#ocr"]) {
    const el = $(id);
    el.hidden = true;
    el.innerHTML = "";
  }
}

// Run the deterministic pipeline on extracted text and render the results.
async function finish(text, sourceName) {
  setStatus("Processing…", "info");
  // Yield once so the status paints before the (synchronous) heavy work.
  await new Promise((r) => setTimeout(r, 0));
  const result = processBook(text, DEFAULT_MAX_CHARS);
  result.sourceName = sourceName;
  current = result;

  renderSummary(result, sourceName);
  renderChunks(result);
  renderFlags(result);
  setStatus("", "info");
}

async function handleFile(file) {
  const ext = fileExtension(file.name);
  if (!ACCEPTED.has(ext)) {
    setStatus(`Unsupported file type "${ext || "?"}". Use .txt, .epub, or .pdf.`, "error");
    return;
  }
  resetPanels();
  setStatus(`Reading ${file.name}…`, "info");
  try {
    const { text, numPages } = await ingest(file);

    // Scanned PDFs have no usable text layer — offer in-browser OCR instead of
    // failing or processing an empty document.
    if (ext === ".pdf" && pdfLooksScanned(text, numPages)) {
      setStatus("", "info");
      offerOcr(file, { empty: !text || !text.trim() });
      return;
    }

    if (!text || !text.trim()) {
      setStatus("No text could be extracted from that file.", "error");
      return;
    }
    await finish(text, file.name);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, "error");
  }
}

function wireDropZone() {
  const dz = $("#dropzone");
  const input = $("#fileInput");

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener("change", () => {
    if (input.files.length) handleFile(input.files[0]);
    input.value = ""; // allow re-selecting the same file
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("dropzone--active");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dropzone--active");
    })
  );

  dz.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 1) {
      setStatus("Please drop only one file at a time.", "error");
      return;
    }
    if (files.length === 1) handleFile(files[0]);
  });
}

wireDropZone();
