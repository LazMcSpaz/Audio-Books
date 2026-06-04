/*
 * app.js — UI glue. Wires the drag-drop zone to the ingest + processing
 * pipeline and renders the summary, chunk list, and review-flags panels.
 *
 * State lives only in memory for the session — no localStorage/sessionStorage.
 */

import { ingest, fileExtension } from "./ingest.js";
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

function bytesToFile(name, text) {
  return new File([text], name, { type: "text/plain" });
}

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

// --- main flow ------------------------------------------------------------

async function handleFile(file) {
  const ext = fileExtension(file.name);
  if (!ACCEPTED.has(ext)) {
    setStatus(`Unsupported file type "${ext || "?"}". Use .txt, .epub, or .pdf.`, "error");
    return;
  }
  setStatus(`Reading ${file.name}…`, "info");
  try {
    const raw = await ingest(file);
    if (!raw || !raw.trim()) {
      setStatus("No text could be extracted from that file.", "error");
      return;
    }
    setStatus("Processing…", "info");
    // Yield once so the status paints before the (synchronous) heavy work.
    await new Promise((r) => setTimeout(r, 0));
    const result = processBook(raw, DEFAULT_MAX_CHARS);
    result.sourceName = file.name;
    current = result;

    renderSummary(result, file.name);
    renderChunks(result);
    renderFlags(result);
    setStatus("", "info");
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
