/*
 * app.js — batch controller.
 *
 * Load many books at once, process them sequentially (OCR'ing scanned PDFs
 * automatically when enabled), and — if connected to the Worker backend — push
 * each finished book to the repo branch as it completes. A ZIP-all download is
 * always available as a fallback.
 *
 * All state is in memory for the session (no localStorage/sessionStorage). The
 * app password is held only in this module's `gh` object and sent per request.
 */

import { ingest, fileExtension } from "./ingest.js";
import { pdfLooksScanned, ocrPdf } from "./ocr.js";
import { verifyBackend, pushBook } from "./push.js";
import { processBook, estimateMonths, estimateAudioHours, DEFAULT_MAX_CHARS } from "./processing.js";

const ACCEPTED = new Set([".txt", ".epub", ".pdf"]);

const $ = (s) => document.querySelector(s);
const num = (n) => n.toLocaleString("en-US");

// --- session state (in memory only) ---------------------------------------

let books = [];           // see makeBook()
let processing = false;
let autoOcr = true;
let wakeLock = null;
let nextId = 1;

const gh = { connected: false, password: null, owner: "", repo: "", branch: "" };

function makeBook(file, slug) {
  return {
    id: nextId++,
    file,
    slug,
    name: file.name,
    status: "queued", // queued | reading | ocr | processing | done | error
    error: "",
    ocr: { page: 0, total: 0, progress: 0 },
    result: null,
    push: { state: gh.connected ? "idle" : "off", url: "", error: "" }, // off|idle|pushing|pushed|failed
  };
}

// --- helpers ---------------------------------------------------------------

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

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Filename -> repo-safe slug matching the Worker's /^[a-z0-9][a-z0-9-]{0,80}$/.
function slugify(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  let s = base.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9]/.test(s)) s = "b-" + s;
  s = s.slice(0, 80).replace(/-+$/, "");
  return s || "book";
}

function uniqueSlug(slug) {
  const taken = new Set(books.map((b) => b.slug));
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

function setStatus(msg, kind = "info") {
  const el = $("#status");
  el.textContent = msg;
  el.className = `status status--${kind}`;
  el.hidden = !msg;
}

// Chunk files + the per-book review flags file, ready for ZIP/push.
function bookFiles(result) {
  const files = result.files.map((f) => ({ name: f.name, text: f.text }));
  files.push({ name: "_REVIEW_FLAGS.txt", text: result.reviewFlagsText });
  return files;
}

// --- wake lock (keep the screen on during a long batch) --------------------

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  try {
    if (wakeLock) wakeLock.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (processing && wakeLock === null && document.visibilityState === "visible") acquireWakeLock();
});

// --- rendering -------------------------------------------------------------

function statusCell(b) {
  switch (b.status) {
    case "queued": return `<span class="bdg">Queued</span>`;
    case "reading": return `<span class="bdg bdg--busy">Reading…</span>`;
    case "ocr": {
      const pct = Math.round((b.ocr.page - 1 + (b.ocr.progress || 0)) / Math.max(b.ocr.total, 1) * 100);
      return `<span class="bdg bdg--busy">OCR ${b.ocr.page}/${b.ocr.total}</span>
        <div class="rowbar"><div class="rowbar__fill" style="width:${pct}%"></div></div>`;
    }
    case "processing": return `<span class="bdg bdg--busy">Processing…</span>`;
    case "error": return `<span class="bdg bdg--err">Error</span>`;
    case "done": {
      const r = b.result;
      return `<span class="bdg bdg--ok">✓ ${num(r.chunkCount)} chunks</span>
        <span class="muted small">${num(r.totalChars)} chars · ${r.flags.length} flags · ~${estimateAudioHours(r.totalChars).toFixed(1)}h</span>`;
    }
    default: return "";
  }
}

function pushCell(b) {
  if (b.status !== "done") return "";
  switch (b.push.state) {
    case "off": return `<span class="muted small">not pushed (no backend)</span>`;
    case "idle": return `<span class="muted small">waiting to push…</span>`;
    case "pushing": return `<span class="bdg bdg--busy">Pushing…</span>`;
    case "pushed": return `<a class="small ok" href="${escapeHtml(b.push.url)}" target="_blank" rel="noreferrer">✓ pushed to branch ↗</a>`;
    case "failed": return `<span class="bdg bdg--err">push failed</span> <span class="muted small">${escapeHtml(b.push.error)}</span>`;
    default: return "";
  }
}

function detailsCell(b) {
  if (b.status === "error") return `<p class="small err-text">${escapeHtml(b.error)}</p>`;
  if (b.status !== "done") return "";
  const r = b.result;
  const fileList = r.files
    .map((f) => `<li><code>${escapeHtml(f.name)}</code> <span class="muted">${num(f.chars)} chars${f.chars > 5000 ? " ⚠️" : ""}</span></li>`)
    .join("");
  let flagsHtml = `<p class="ok small">No ambiguous items flagged.</p>`;
  if (r.flags.length) {
    const groups = new Map();
    for (const f of r.flags) {
      if (!groups.has(f.note)) groups.set(f.note, []);
      groups.get(f.note).push(f);
    }
    flagsHtml = [...groups]
      .map(([note, items]) =>
        `<details class="flag-group"><summary>${escapeHtml(note)} <span class="badge">${items.length}</span></summary>
          <ul>${items.map((it) => `<li><code>${escapeHtml(it.snippet)}</code></li>`).join("")}</ul></details>`)
      .join("");
  }
  return `
    <details class="book-details">
      <summary>Files (${r.files.length}) &amp; review flags (${r.flags.length})</summary>
      <div class="book-details__body">
        <button class="btn btn--sm" data-zip="${b.id}">Download this book as ZIP</button>
        <h4>Chunks</h4><ul class="file-list">${fileList}</ul>
        <h4>Review flags</h4>${flagsHtml}
      </div>
    </details>`;
}

function rowInner(b) {
  return `
    <div class="book-row__head">
      <span class="book-row__name">${escapeHtml(b.name)}</span>
      <span class="book-row__slug muted small">chunks/${escapeHtml(b.slug)}/</span>
    </div>
    <div class="book-row__status">${statusCell(b)}</div>
    <div class="book-row__push">${pushCell(b)}</div>
    ${detailsCell(b)}`;
}

function renderBatch() {
  const panel = $("#batch");
  if (books.length === 0) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const doneCount = books.filter((b) => b.status === "done").length;
  const rows = books.map((b) => `<li class="book-row" id="book-${b.id}">${rowInner(b)}</li>`).join("");
  panel.innerHTML = `
    <h2>Books <span class="muted">(${doneCount}/${books.length} done)</span></h2>
    <ul class="book-list">${rows}</ul>`;
  panel.hidden = false;
  panel.querySelectorAll("button[data-zip]").forEach((btn) =>
    btn.addEventListener("click", () => downloadBookZip(Number(btn.dataset.zip)))
  );
}

function updateRow(b) {
  const li = document.getElementById(`book-${b.id}`);
  if (li) li.innerHTML = rowInner(b);
  // Keep the done-count header fresh.
  const header = $("#batch h2 .muted");
  if (header) header.textContent = `(${books.filter((x) => x.status === "done").length}/${books.length} done)`;
}

function updateControls() {
  const hasQueued = books.some((b) => b.status === "queued");
  const hasDone = books.some((b) => b.status === "done");
  $("#startBtn").disabled = processing || !hasQueued;
  $("#startBtn").textContent = processing ? "Processing…" : "Start processing";
  $("#zipAllBtn").hidden = !hasDone;
  $("#clearBtn").disabled = processing || books.length === 0;
}

// --- GitHub backend connect ------------------------------------------------

async function connectBackend() {
  const pw = $("#appPassword").value.trim();
  const statusEl = $("#ghStatus");
  if (!pw) {
    statusEl.textContent = "Enter the app password first.";
    statusEl.className = "small err-text";
    return;
  }
  $("#connectBtn").disabled = true;
  statusEl.textContent = "Connecting…";
  statusEl.className = "small muted";
  try {
    const info = await verifyBackend(pw);
    gh.connected = true;
    gh.password = pw;
    gh.owner = info.owner;
    gh.repo = info.repo;
    gh.branch = info.branch;
    statusEl.innerHTML = `✓ Connected — will push to <code>${escapeHtml(info.owner)}/${escapeHtml(info.repo)}</code> branch <code>${escapeHtml(info.branch)}</code>`;
    statusEl.className = "small ok";
    // Books already queued should now intend to push.
    for (const b of books) if (b.push.state === "off") b.push.state = "idle";
    renderBatch();
  } catch (err) {
    gh.connected = false;
    gh.password = null;
    statusEl.textContent = `Connect failed: ${err.message}`;
    statusEl.className = "small err-text";
  } finally {
    $("#connectBtn").disabled = false;
  }
}

// --- processing pipeline ---------------------------------------------------

function addFiles(fileList) {
  let added = 0;
  for (const file of fileList) {
    if (!ACCEPTED.has(fileExtension(file.name))) {
      setStatus(`Skipped "${file.name}" — only .txt, .epub, .pdf are supported.`, "error");
      continue;
    }
    const slug = uniqueSlug(slugify(file.name));
    books.push(makeBook(file, slug));
    added++;
  }
  if (added) setStatus("", "info");
  renderBatch();
  updateControls();
}

async function processOne(b) {
  try {
    b.status = "reading";
    updateRow(b);
    const ext = fileExtension(b.name);
    let text;
    const ing = await ingest(b.file);
    text = ing.text;

    if (ext === ".pdf" && pdfLooksScanned(text, ing.numPages)) {
      if (!autoOcr) {
        throw new Error("Looks like a scanned PDF, but auto-OCR is off. Enable auto-OCR and re-run.");
      }
      b.status = "ocr";
      b.ocr = { page: 0, total: ing.numPages || 0, progress: 0 };
      updateRow(b);
      text = await ocrPdf(b.file, (p) => {
        if (p.phase === "page") {
          b.ocr = { page: p.page, total: p.total, progress: p.progress || 0 };
          updateRow(b);
        }
      });
    }

    if (!text || !text.trim()) throw new Error("No text could be extracted.");

    b.status = "processing";
    updateRow(b);
    await new Promise((r) => setTimeout(r, 0)); // let the row paint
    b.result = processBook(text, DEFAULT_MAX_CHARS);
    b.status = "done";
    updateRow(b);

    if (gh.connected) await pushOne(b);
  } catch (err) {
    console.error(err);
    b.status = "error";
    b.error = err.message;
    updateRow(b);
  }
}

async function pushOne(b) {
  b.push.state = "pushing";
  updateRow(b);
  try {
    const res = await pushBook(gh.password, b.slug, bookFiles(b.result));
    b.push.state = "pushed";
    b.push.url = res.htmlUrl;
  } catch (err) {
    b.push.state = "failed";
    b.push.error = err.message;
  }
  updateRow(b);
}

async function startProcessing() {
  if (processing) return;
  processing = true;
  updateControls();
  await acquireWakeLock();
  try {
    // Re-read each time so books added mid-run (queued) are still picked up.
    for (let i = 0; i < books.length; i++) {
      if (books[i].status === "queued") await processOne(books[i]);
    }
  } finally {
    releaseWakeLock();
    processing = false;
    updateControls();
  }
}

// --- downloads -------------------------------------------------------------

async function downloadBookZip(id) {
  const b = books.find((x) => x.id === id);
  if (!b || !b.result || typeof JSZip === "undefined") return;
  const zip = new JSZip();
  const folder = zip.folder(`chunks/${b.slug}`);
  for (const f of bookFiles(b.result)) folder.file(f.name, f.text);
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${b.slug}_chunks.zip`);
}

async function downloadAllZip() {
  if (typeof JSZip === "undefined") {
    setStatus("JSZip unavailable — use per-book download buttons instead.", "error");
    return;
  }
  const done = books.filter((b) => b.status === "done");
  if (!done.length) return;
  const zip = new JSZip();
  for (const b of done) {
    const folder = zip.folder(`chunks/${b.slug}`);
    for (const f of bookFiles(b.result)) folder.file(f.name, f.text);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), "audiobook_chunks.zip");
}

function clearAll() {
  if (processing) return;
  books = [];
  renderBatch();
  updateControls();
  setStatus("", "info");
}

// --- wiring ----------------------------------------------------------------

function wire() {
  const dz = $("#dropzone");
  const input = $("#fileInput");

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    if (input.files.length) addFiles(input.files);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dropzone--active"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dropzone--active"); })
  );
  dz.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  $("#autoOcr").addEventListener("change", (e) => { autoOcr = e.target.checked; });
  $("#connectBtn").addEventListener("click", connectBackend);
  $("#appPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") connectBackend(); });
  $("#startBtn").addEventListener("click", startProcessing);
  $("#zipAllBtn").addEventListener("click", downloadAllZip);
  $("#clearBtn").addEventListener("click", clearAll);

  updateControls();
}

wire();
