// ============================================================
// MANDEA — Netlify Function: Kategorien via GitHub API speichern
//
// POST { token, categories[] }
//   1. Token verifizieren
//   2. Kategorien validieren
//   3. Via GitHub API in public/categories.json committen
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

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

function validateCategories(categories) {
  if (!Array.isArray(categories)) return 'categories muss ein Array sein.';
  if (categories.length === 0)    return 'Mindestens eine Kategorie erforderlich.';

  const ids = new Set();
  for (const c of categories) {
    if (!c.id || typeof c.id !== 'string' || !/^[a-zäöüß][a-zäöüß0-9-]*$/.test(c.id)) {
      return `Ungültige Kategorie-ID: "${c.id}" — nur Kleinbuchstaben, Ziffern und Bindestriche.`;
    }
    if (ids.has(c.id)) return `Doppelte Kategorie-ID: ${c.id}`;
    ids.add(c.id);
    if (!c.label || typeof c.label !== 'string') return `Label fehlt bei: ${c.id}`;
    if (!c.idPrefix || typeof c.idPrefix !== 'string') return `idPrefix fehlt bei: ${c.id}`;
  }
  return null;
}

async function githubRequest(method, path, body, ghToken) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization':        `Bearer ${ghToken}`,
      'Accept':               'application/vnd.github+json',
      'Content-Type':         'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `GitHub API Fehler ${res.status}`);
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

  let token, categories;
  try {
    ({ token, categories } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Ungültiger Body.' }) };
  }

  if (!token || !verifyToken(token, adminSecret)) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ message: 'Nicht authentifiziert.' }) };
  }

  const validationError = validateCategories(categories);
  if (validationError) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: validationError }) };
  }

  const filePath = 'public/categories.json';
  let currentSha;

  try {
    const current = await githubRequest(
      'GET',
      `/repos/${githubOwner}/${githubRepo}/contents/${filePath}?ref=${githubBranch}`,
      null,
      githubToken
    );
    currentSha = current.sha;
  } catch (err) {
    console.error('Fehler beim Lesen der aktuellen categories.json:', err.message);
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ message: 'Aktuelle Datei konnte nicht gelesen werden.' }) };
  }

  const newContent = JSON.stringify({ categories }, null, 2);
  const contentB64 = Buffer.from(newContent, 'utf-8').toString('base64');
  const now        = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  try {
    await githubRequest(
      'PUT',
      `/repos/${githubOwner}/${githubRepo}/contents/${filePath}`,
      {
        message: `Kategorien aktualisiert via Admin — ${now}`,
        content: contentB64,
        sha:     currentSha,
        branch:  githubBranch,
      },
      githubToken
    );

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, count: categories.length }),
    };
  } catch (err) {
    console.error('GitHub Commit fehlgeschlagen:', err.message);
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({ message: `Speichern fehlgeschlagen: ${err.message}` }),
    };
  }
};
