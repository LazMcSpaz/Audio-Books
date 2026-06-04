/*
 * ocr.js — in-browser OCR fallback for scanned (image-only) PDFs.
 *
 * Some public-domain books are scans: the PDF is a sequence of page images with
 * no embedded text layer, so pdf.js extracts nothing. Here we render each page
 * to a canvas (pdf.js) and recognize it with Tesseract.js — a local WASM OCR
 * engine. This keeps the app's promise intact: nothing is uploaded, no API is
 * called, it stays free and backendless. It is just slow.
 *
 * Tesseract.js is loaded lazily (only when the user opts into OCR) so normal
 * text PDFs never pay the ~15 MB engine/language download.
 */

const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

let tesseractLoading = null;
function loadTesseract() {
  if (typeof Tesseract !== "undefined") return Promise.resolve();
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESSERACT_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load the OCR engine (Tesseract.js)."));
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

// Heuristic: a scanned/image PDF yields almost no extractable text. If the
// average non-whitespace character count per page is tiny, it's image-based.
const MIN_CHARS_PER_PAGE = 100;
export function pdfLooksScanned(text, numPages) {
  if (!numPages || numPages < 1) return false;
  const chars = (text || "").replace(/\s/g, "").length;
  return chars / numPages < MIN_CHARS_PER_PAGE;
}

/*
 * OCR every page of a PDF File and return the concatenated text.
 *
 * onProgress receives objects describing the current state:
 *   { phase: "engine", status }                  — loading/initializing engine
 *   { phase: "page", page, total, progress }     — recognizing a page (0..1)
 */
export async function ocrPdf(file, onProgress = () => {}) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("pdf.js failed to load (needed to render PDF pages for OCR).");
  }
  await loadTesseract();

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const total = pdf.numPages;
  let currentPage = 0;

  const worker = await Tesseract.createWorker("eng", 1, {
    // Do not persist language data to IndexedDB — keep all state in memory for
    // the session, consistent with the rest of the app.
    cacheMethod: "none",
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress({ phase: "page", page: currentPage, total, progress: m.progress });
      } else {
        onProgress({ phase: "engine", status: m.status });
      }
    },
  });

  const pages = [];
  try {
    for (let i = 1; i <= total; i++) {
      currentPage = i;
      onProgress({ phase: "page", page: i, total, progress: 0 });

      const page = await pdf.getPage(i);
      // Render at 2x for legible glyphs without ballooning memory too much.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data: { text } } = await worker.recognize(canvas);
      pages.push(text.trim());

      // Release the canvas memory before the next (potentially large) page.
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }

  return pages.join("\n\n");
}
