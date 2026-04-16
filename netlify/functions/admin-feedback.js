// ============================================================
// MANDEA — Netlify Function: Feedback-Verwaltung (Admin)
//
// POST { token, action: 'list' }          → alle Reviews
// POST { token, action: 'approve', id }   → approve/unapprove togglen
// POST { token, action: 'delete',  id }   → Review löschen
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const FILE_PATH = 'public/feedback.json';

function verifyToken(token, secret) {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return false;
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
    const sigBuf      = Buffer.from(sig, 'base64url');
    const expSigBuf   = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expSigBuf.length) return false;
    if (!timingSafeEqual(sigBuf, expSigBuf)) return false;
    const { exp } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return Date.now() < exp;
  } catch {
    return false;
  }
}

async function githubRequest(method, path, body, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization':        `Bearer ${token}`,
      'Accept':               'application/vnd.github+json',
      'Content-Type':         'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `GitHub API ${res.status}`);
  return data;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const adminSecret  = process.env.ADMIN_SECRET;
  const githubToken  = process.env.GITHUB_TOKEN;
  const githubOwner  = process.env.GITHUB_OWNER;
  const githubRepo   = process.env.GITHUB_REPO;
  const githubBranch = process.env.GITHUB_BRANCH ?? 'main';

  if (!adminSecret || !githubToken || !githubOwner || !githubRepo) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ message: 'Server-Konfigurationsfehler.' }) };
  }

  let token, action, id;
  try {
    ({ token, action, id } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Ungültiger Body.' }) };
  }

  if (!token || !verifyToken(token, adminSecret)) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ message: 'Nicht authentifiziert.' }) };
  }

  // Aktuelle Daten laden
  let currentSha, data;
  try {
    const current = await githubRequest('GET', `/repos/${githubOwner}/${githubRepo}/contents/${FILE_PATH}?ref=${githubBranch}`, null, githubToken);
    currentSha = current.sha;
    data = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'));
  } catch {
    data = { reviews: [] };
  }

  if (action === 'list') {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ reviews: data.reviews ?? [] }) };
  }

  if (action === 'approve') {
    const review = (data.reviews ?? []).find(r => r.id === id);
    if (!review) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ message: 'Review nicht gefunden.' }) };
    review.approved = !review.approved;
  } else if (action === 'archive') {
    const review = (data.reviews ?? []).find(r => r.id === id);
    if (!review) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ message: 'Review nicht gefunden.' }) };
    review.archived = !review.archived;
    if (review.archived) review.approved = false; // archivierte Reviews nie öffentlich anzeigen
  } else if (action === 'delete') {
    const before = (data.reviews ?? []).length;
    data.reviews = (data.reviews ?? []).filter(r => r.id !== id);
    if (data.reviews.length === before) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ message: 'Review nicht gefunden.' }) };
  } else {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Unbekannte Aktion.' }) };
  }

  // Speichern
  const contentB64 = Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64');
  try {
    await githubRequest('PUT', `/repos/${githubOwner}/${githubRepo}/contents/${FILE_PATH}`, {
      message: `[skip ci] Feedback ${action}: ${id}`,
      content: contentB64,
      sha:     currentSha,
      branch:  githubBranch,
    }, githubToken);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, reviews: data.reviews }) };
  } catch (err) {
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ message: err.message }) };
  }
};
