// ============================================================
// MANDEA — Netlify Function: Produkte via GitHub API speichern
//
// POST { token, products[] }
//   1. Token verifizieren
//   2. products.json validieren
//   3. Via GitHub API in public/products.json committen
//   4. Netlify erkennt den neuen Commit → automatisches Redeploy
//
// Benötigte Umgebungsvariablen:
//   ADMIN_SECRET     — gleicher Wert wie in admin-auth.js
//   GITHUB_TOKEN     — GitHub Personal Access Token
//                      (Settings → Developer settings → Fine-grained tokens
//                       → Repository: Contents: Read & Write)
//   GITHUB_OWNER     — GitHub-Benutzername (z.B. "mandyegerland")
//   GITHUB_REPO      — Repository-Name (z.B. "mandea")
//   GITHUB_BRANCH    — Branch (Standard: "main")
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

// ── Token-Verifikation (dupliziert aus admin-auth.js) ─────
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

// ── Produkt-Validierung ───────────────────────────────────
function validateProducts(products) {
  if (!Array.isArray(products)) return 'products muss ein Array sein.';
  if (products.length === 0)    return 'Produktliste ist leer.';

  const ids = new Set();

  for (const p of products) {
    if (!p.id || typeof p.id !== 'string')             return `Ungültige ID: ${JSON.stringify(p.id)}`;
    if (ids.has(p.id))                                  return `Doppelte ID: ${p.id}`;
    ids.add(p.id);
    if (!p.name || typeof p.name !== 'string')          return `Name fehlt bei: ${p.id}`;
    if (!p.category || typeof p.category !== 'string') return `Kategorie fehlt bei: ${p.id}`;
    if (typeof p.price !== 'number' || p.price <= 0)    return `Ungültiger Preis bei: ${p.id}`;
    if (typeof p.inStock !== 'boolean')                 return `inStock fehlt bei: ${p.id}`;
  }
  return null; // alles ok
}

// ── GitHub API Helpers ────────────────────────────────────
async function githubRequest(method, path, body, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
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

  const adminSecret   = process.env.ADMIN_SECRET;
  const githubToken   = process.env.GITHUB_TOKEN;
  const githubOwner   = process.env.GITHUB_OWNER;
  const githubRepo    = process.env.GITHUB_REPO;
  const githubBranch  = process.env.GITHUB_BRANCH ?? 'main';

  if (!adminSecret || !githubToken || !githubOwner || !githubRepo) {
    console.error('Fehlende Umgebungsvariablen: ADMIN_SECRET, GITHUB_TOKEN, GITHUB_OWNER oder GITHUB_REPO');
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ message: 'Server-Konfigurationsfehler.' }) };
  }

  // ── Request parsen ────────────────────────────────────────
  let token, products;
  try {
    ({ token, products } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Ungültiger Body.' }) };
  }

  // ── Token prüfen ──────────────────────────────────────────
  if (!token || !verifyToken(token, adminSecret)) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ message: 'Nicht authentifiziert.' }) };
  }

  // ── Produkte validieren ───────────────────────────────────
  const validationError = validateProducts(products);
  if (validationError) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: validationError }) };
  }

  // ── Aktuelle Datei-SHA lesen (für GitHub-Update nötig) ────
  const filePath = 'public/products.json';
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
    console.error('Fehler beim Lesen der aktuellen products.json:', err.message);
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ message: 'Aktuelle Datei konnte nicht gelesen werden.' }) };
  }

  // ── Neue products.json als Base64 kodieren ────────────────
  const newContent = JSON.stringify({ products }, null, 2);
  const contentB64 = Buffer.from(newContent, 'utf-8').toString('base64');

  const now       = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const commitMsg = `[skip ci] Produkte aktualisiert via Admin — ${now}`;

  // ── Commit via GitHub API ─────────────────────────────────
  try {
    await githubRequest(
      'PUT',
      `/repos/${githubOwner}/${githubRepo}/contents/${filePath}`,
      {
        message: commitMsg,
        content: contentB64,
        sha:     currentSha,
        branch:  githubBranch,
      },
      githubToken
    );

    console.log(`products.json erfolgreich aktualisiert (${products.length} Produkte)`);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, count: products.length }),
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
