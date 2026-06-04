/*
 * src/index.js — full-stack Worker entry point.
 *
 * Routing: static assets (the web app in ./public) are served first by the
 * platform; this script only runs for requests that don't match an asset —
 * namely the /api/* routes below. Everything else falls through to ASSETS.
 *
 * Endpoints (both require the X-App-Password header to match APP_PASSWORD):
 *   POST /api/verify  -> { ok, owner, repo, branch }  (checks password + token)
 *   POST /api/push    -> { commitSha, htmlUrl }        (commits one book)
 *
 * The GitHub token (GITHUB_TOKEN secret) is used only here, server-side; the
 * browser never sees it.
 */

import { getRepo, commitBook } from "./github.js";

const MAX_FILES = 2000;
const MAX_FILE_CHARS = 60000; // generous headroom over the 4,500-char chunks
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const FILENAME_RE = /^(ch\d{3}_part\d{2}\.txt|_REVIEW_FLAGS\.txt)$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish comparison: hash both sides (fixed length) then XOR-compare.
async function passwordOk(provided, expected) {
  if (!expected || typeof provided !== "string") return false;
  const a = await sha256Hex(provided);
  const b = await sha256Hex(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function repoConfig(env) {
  return {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || "book-chunks",
    token: env.GITHUB_TOKEN,
  };
}

function configError(env) {
  if (!env.GITHUB_TOKEN) return "Server is missing the GITHUB_TOKEN secret.";
  if (!env.APP_PASSWORD) return "Server is missing the APP_PASSWORD secret.";
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO) return "Server is missing GITHUB_OWNER/GITHUB_REPO vars.";
  return null;
}

async function handleVerify(request, env) {
  const cfg = repoConfig(env);
  // Confirm the token actually works and has push rights.
  const data = await getRepo(cfg);
  if (!data.permissions || !data.permissions.push) {
    return json({ ok: false, error: "Server token lacks write access to the repo." }, 500);
  }
  return json({ ok: true, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch });
}

async function handlePush(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const { slug, files } = payload || {};

  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return json({ ok: false, error: "Invalid book slug." }, 400);
  }
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    return json({ ok: false, error: "Invalid or empty file list." }, 400);
  }
  for (const f of files) {
    if (!f || typeof f.name !== "string" || typeof f.text !== "string") {
      return json({ ok: false, error: "Malformed file entry." }, 400);
    }
    if (!FILENAME_RE.test(f.name)) {
      return json({ ok: false, error: `Disallowed filename: ${f.name}` }, 400);
    }
    if (f.text.length > MAX_FILE_CHARS) {
      return json({ ok: false, error: `File too large: ${f.name}` }, 400);
    }
  }

  const result = await commitBook(repoConfig(env), slug, files);
  return json({ ok: true, ...result });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Not an API route — serve the static web app.
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    const cfgErr = configError(env);
    if (cfgErr) return json({ ok: false, error: cfgErr }, 500);

    // Gate every API call behind the app password.
    if (!(await passwordOk(request.headers.get("X-App-Password"), env.APP_PASSWORD))) {
      return json({ ok: false, error: "Unauthorized — wrong app password." }, 401);
    }

    try {
      if (url.pathname === "/api/verify") return await handleVerify(request, env);
      if (url.pathname === "/api/push") return await handlePush(request, env);
      return json({ ok: false, error: "Not found." }, 404);
    } catch (err) {
      return json({ ok: false, error: err.message || "Server error." }, 502);
    }
  },
};
