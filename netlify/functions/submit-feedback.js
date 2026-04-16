// ============================================================
// MANDEA — Netlify Function: Neues Feedback einreichen
// POST { name, rating, text } → speichert mit approved: false
// ============================================================

const HEADERS = {
  'Content-Type':                'application/json',
  'Cache-Control':               'no-store',
  'Access-Control-Allow-Origin': '*',
};

const FILE_PATH = 'public/feedback.json';

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? 'main';
  const token  = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server-Konfigurationsfehler.' }) };
  }

  let name, email, rating, text, honeypot;
  try {
    ({ name, email, rating, text, honeypot } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Ungültiger Body.' }) };
  }

  // Honeypot-Check gegen Bots
  if (honeypot) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };

  // Validierung
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 50) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Bitte gib einen gültigen Namen ein.' }) };
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }) };
  }
  if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Bitte wähle eine Sternebewertung.' }) };
  }
  if (!text || typeof text !== 'string' || text.trim().length < 10 || text.trim().length > 600) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Dein Feedback muss zwischen 10 und 600 Zeichen lang sein.' }) };
  }

  // Aktuelle feedback.json laden
  let currentSha, currentData;
  try {
    const current = await githubRequest('GET', `/repos/${owner}/${repo}/contents/${FILE_PATH}?ref=${branch}`, null, token);
    currentSha = current.sha;
    currentData = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'));
  } catch {
    currentSha = undefined;
    currentData = { reviews: [] };
  }

  // Neues Review anhängen
  const newReview = {
    id:       `r${Date.now()}`,
    name:     name.trim(),
    email:    email.trim().toLowerCase(), // nur für Admin sichtbar, nie öffentlich
    rating,
    text:     text.trim(),
    date:     new Date().toISOString().split('T')[0],
    approved: false,
  };

  currentData.reviews = [...(currentData.reviews ?? []), newReview];

  // Speichern
  const contentB64 = Buffer.from(JSON.stringify(currentData, null, 2), 'utf-8').toString('base64');
  try {
    await githubRequest('PUT', `/repos/${owner}/${repo}/contents/${FILE_PATH}`, {
      message: `[skip ci] Neues Feedback von ${newReview.name}`,
      content: contentB64,
      sha:     currentSha,
      branch,
    }, token);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('submit-feedback Fehler:', err.message);
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Speichern fehlgeschlagen.' }) };
  }
};
