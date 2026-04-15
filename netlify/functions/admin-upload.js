// ============================================================
// MANDEA — Netlify Function: Produktfoto via GitHub API hochladen
//
// POST { token, filename, contentBase64 }
//   1. Token verifizieren
//   2. Dateiname sanitieren + Bildformat prüfen
//   3. Via GitHub API in public/images/products/ hochladen
//
// Benötigte Umgebungsvariablen: ADMIN_SECRET, GITHUB_TOKEN,
//   GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
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

  let token, filename, contentBase64;
  try {
    ({ token, filename, contentBase64 } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Ungültiger Body.' }) };
  }

  if (!token || !verifyToken(token, adminSecret)) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ message: 'Nicht authentifiziert.' }) };
  }

  if (!filename || typeof filename !== 'string') {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Dateiname fehlt.' }) };
  }

  // Dateiname sanitieren: nur erlaubte Zeichen, Kleinbuchstaben
  const safeFilename = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-');

  if (!/\.(jpe?g|png|webp|gif)$/i.test(safeFilename)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Nur Bilder erlaubt (jpg, png, webp).' }) };
  }

  if (!contentBase64 || typeof contentBase64 !== 'string') {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Bilddaten fehlen.' }) };
  }

  // Maximale Dateigröße: ~5 MB (base64 ist ~33% größer als binär)
  if (contentBase64.length > 7_000_000) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Datei zu groß (max. 5 MB).' }) };
  }

  const filePath = `public/images/products/${safeFilename}`;

  // Prüfen ob Datei schon existiert (SHA für Update nötig)
  let existingSha;
  try {
    const existing = await githubRequest(
      'GET',
      `/repos/${githubOwner}/${githubRepo}/contents/${filePath}?ref=${githubBranch}`,
      null,
      githubToken
    );
    existingSha = existing.sha;
  } catch {
    // Datei existiert noch nicht — kein SHA nötig
  }

  try {
    await githubRequest(
      'PUT',
      `/repos/${githubOwner}/${githubRepo}/contents/${filePath}`,
      {
        message: `[skip ci] Produktfoto hochgeladen: ${safeFilename}`,
        content: contentBase64,
        ...(existingSha ? { sha: existingSha } : {}),
        branch: githubBranch,
      },
      githubToken
    );

    // jsDelivr CDN: globale Edge-Server, schneller als raw.githubusercontent.com
    const rawUrl = `https://cdn.jsdelivr.net/gh/${githubOwner}/${githubRepo}@${githubBranch}/public/images/products/${safeFilename}`;

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, path: rawUrl }),
    };
  } catch (err) {
    console.error('GitHub Upload fehlgeschlagen:', err.message);
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({ message: `Upload fehlgeschlagen: ${err.message}` }),
    };
  }
};
