/*
 * src/github.js — GitHub Git Data API helpers, run *inside the Worker* so the
 * token never reaches the browser. Commits all of a book's files in a single
 * commit on the target branch.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "audiobook-prep-worker",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.message || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    const err = new Error(`GitHub ${method} ${path} → ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getRepo({ owner, repo, token }) {
  return gh(token, "GET", `/repos/${owner}/${repo}`);
}

// Commit SHA the branch points at, or null if the branch doesn't exist.
async function getBranchHead({ owner, repo, token, branch }) {
  try {
    const ref = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// Ensure the branch exists, creating it from the repo's default branch if not.
export async function ensureBranch({ owner, repo, token, branch }) {
  const head = await getBranchHead({ owner, repo, token, branch });
  if (head) return head;
  const repoData = await getRepo({ owner, repo, token });
  const base = repoData.default_branch;
  const baseRef = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseRef.object.sha,
  });
  return baseRef.object.sha;
}

/*
 * Commit one book's files to the branch as a single commit.
 *   files: [{ name, text }] — placed under chunks/<slug>/
 * Returns { commitSha, htmlUrl }.
 */
export async function commitBook({ owner, repo, token, branch }, slug, files) {
  const parentSha = await ensureBranch({ owner, repo, token, branch });
  const parentCommit = await gh(token, "GET", `/repos/${owner}/${repo}/git/commits/${parentSha}`);

  const tree = files.map((f) => ({
    path: `chunks/${slug}/${f.name}`,
    mode: "100644",
    type: "blob",
    content: f.text,
  }));

  const newTree = await gh(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
    base_tree: parentCommit.tree.sha,
    tree,
  });

  const commit = await gh(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
    message: `Add Stage 1 chunks for ${slug}`,
    tree: newTree.sha,
    parents: [parentSha],
  });

  await gh(token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    sha: commit.sha,
  });

  return {
    commitSha: commit.sha,
    htmlUrl: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}/chunks/${slug}`,
  };
}
