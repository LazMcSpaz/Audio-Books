/*
 * ingest.js — extract plain text from .txt, .epub, or .pdf entirely in the
 * browser. No uploads, no round-trips, no backend.
 *
 *   .txt  -> read as UTF-8
 *   .epub -> unzip with JSZip, walk the OPF spine, strip XHTML to text
 *   .pdf  -> pdf.js, concatenate per-page text content
 *
 * JSZip and pdf.js are loaded as globals from CDN in index.html.
 */

export function fileExtension(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

async function readTxt(file) {
  return await file.text();
}

// --- EPUB -----------------------------------------------------------------

function resolvePath(base, relative) {
  // Resolve an href relative to the OPF location, normalizing ../ segments.
  const stack = base.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "..") stack.pop();
    else if (part === "." || part === "") continue;
    else stack.push(part);
  }
  return stack.join("/");
}

async function readEpub(file) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip failed to load (needed for EPUB parsing).");
  }
  const zip = await JSZip.loadAsync(file);

  // 1. container.xml points at the OPF package file.
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("Invalid EPUB: missing META-INF/container.xml");
  const containerXml = await containerFile.async("text");
  const parser = new DOMParser();
  const container = parser.parseFromString(containerXml, "application/xml");
  const rootfile = container.querySelector("rootfile");
  const opfPath = rootfile && rootfile.getAttribute("full-path");
  if (!opfPath) throw new Error("Invalid EPUB: no OPF rootfile declared");

  // 2. Parse the OPF: manifest (id -> href) + spine (reading order).
  const opfXml = await zip.file(opfPath).async("text");
  const opf = parser.parseFromString(opfXml, "application/xml");

  const manifest = {};
  opf.querySelectorAll("manifest > item").forEach((item) => {
    manifest[item.getAttribute("id")] = item.getAttribute("href");
  });

  const spineIds = [];
  opf.querySelectorAll("spine > itemref").forEach((ref) => {
    spineIds.push(ref.getAttribute("idref"));
  });

  // 3. Read each spine document in order and strip it to text.
  const parts = [];
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;
    const path = resolvePath(opfPath, href.split("#")[0]);
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async("text");
    const doc = parser.parseFromString(html, "text/html");
    // Drop non-narrative nodes before extracting text.
    doc.querySelectorAll("script, style").forEach((n) => n.remove());
    const text = (doc.body ? doc.body.innerText || doc.body.textContent : "") || "";
    if (text.trim()) parts.push(text);
  }
  return parts.join("\n\n");
}

// --- PDF ------------------------------------------------------------------

async function readPdf(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("pdf.js failed to load (needed for PDF parsing).");
  }
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      pageText += item.str;
      // pdf.js marks end-of-line items so we can rebuild line breaks.
      if (item.hasEOL) pageText += "\n";
      else pageText += " ";
    }
    pages.push(pageText.trim());
  }
  // numPages lets the caller detect image-only scans (little/no text layer).
  return { text: pages.join("\n\n"), numPages: pdf.numPages };
}

// --- dispatch -------------------------------------------------------------

// Returns { text, numPages? }. numPages is only present for PDFs and is used to
// decide whether a PDF is a scan that needs the OCR fallback.
export async function ingest(file) {
  const ext = fileExtension(file.name);
  if (ext === ".txt") return { text: await readTxt(file) };
  if (ext === ".epub") return { text: await readEpub(file) };
  if (ext === ".pdf") return await readPdf(file);
  throw new Error(`Unsupported format: ${ext || "(none)"}. Use .txt, .epub, or .pdf`);
}
