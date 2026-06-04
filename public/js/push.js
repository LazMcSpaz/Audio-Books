/*
 * push.js — thin client for the Worker's /api endpoints. The app password is
 * held in memory by app.js and passed in per call (never stored).
 */

async function postJson(path, password, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Password": password,
    },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok || !data || data.ok === false) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Validate the app password + that the server can reach the repo with write
// access. Returns { owner, repo, branch }.
export function verifyBackend(password) {
  return postJson("/api/verify", password, {});
}

// Commit one book's files. files: [{ name, text }]. Returns { commitSha, htmlUrl }.
export function pushBook(password, slug, files) {
  return postJson("/api/push", password, { slug, files });
}
