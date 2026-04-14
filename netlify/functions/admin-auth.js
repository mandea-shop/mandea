// ============================================================
// MANDEA — Netlify Function: Admin-Authentifizierung
//
// POST { password }          → prüft gegen ADMIN_PASSWORD
// POST { token }             → validiert ein bestehendes Token
//
// Gibt bei Erfolg ein signiertes Token zurück (JWT-ähnlich,
// aber ohne externe Abhängigkeit — HMAC-SHA256 via crypto).
//
// Benötigte Umgebungsvariable:
//   ADMIN_PASSWORD  — das Passwort das Mandy beim Login nutzt
//   ADMIN_SECRET    — zufälliger langer String zum Token-Signieren
//                     (z.B. via: openssl rand -hex 32)
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

// Token hat 8 Stunden Gültigkeit
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function createToken(secret) {
  const payload = JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyToken(token, secret) {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return false;

    // Signatur prüfen (timing-safe gegen Timing-Angriffe)
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
    const sigBuf      = Buffer.from(sig, 'base64url');
    const expSigBuf   = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expSigBuf.length) return false;
    if (!timingSafeEqual(sigBuf, expSigBuf)) return false;

    // Ablaufzeit prüfen
    const { exp } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return Date.now() < exp;
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminSecret   = process.env.ADMIN_SECRET;

  if (!adminPassword || !adminSecret) {
    console.error('ADMIN_PASSWORD oder ADMIN_SECRET fehlt in den Umgebungsvariablen.');
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ message: 'Server-Konfigurationsfehler.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Ungültiger Body.' }) };
  }

  // ── Token-Validierung (Auto-Login) ────────────────────────
  if (body.token) {
    const valid = verifyToken(body.token, adminSecret);
    if (valid) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    } else {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ message: 'Token abgelaufen.' }) };
    }
  }

  // ── Passwort-Login ────────────────────────────────────────
  if (body.password) {
    // Timing-sicherer Vergleich
    let match = false;
    try {
      const a = Buffer.from(body.password);
      const b = Buffer.from(adminPassword);
      match = a.length === b.length && timingSafeEqual(a, b);
    } catch {
      match = false;
    }

    if (!match) {
      // Kurze künstliche Verzögerung gegen Brute-Force
      await new Promise(r => setTimeout(r, 400));
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ message: 'Falsches Passwort.' }) };
    }

    const token = createToken(adminSecret);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ token }) };
  }

  return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ message: 'Passwort oder Token fehlt.' }) };
};
