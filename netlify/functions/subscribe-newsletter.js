// ============================================================
// MANDEA — Netlify Function: Newsletter-Anmeldung
//
// POST { email } → speichert in subscribers.json (GitHub)
//                 → sendet Welcome-E-Mail mit Rabattcode via Resend
//
// Benötigte Umgebungsvariablen:
//   GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
//   RESEND_API_KEY
// ============================================================

const HEADERS = {
  'Content-Type':                'application/json',
  'Cache-Control':               'no-store',
  'Access-Control-Allow-Origin': '*',
};

const FILE_PATH    = 'public/subscribers.json';
const DISCOUNT_CODE = 'MANDEA10'; // 10 % — muss in Stripe als Gutscheincode angelegt sein

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

async function sendWelcomeEmail(email, resendKey) {
  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light}</style></head>
<body style="margin:0;padding:0;background:#F5F0EA;font-family:'Georgia',serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EA;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFCF8;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.06)">

        <!-- Header -->
        <tr>
          <td style="background:#2C1810;padding:28px 24px;text-align:center">
            <p style="margin:0;font-family:'Georgia',serif;font-size:28px;letter-spacing:0.12em;color:#FFFCF8">
              MAN<span style="color:#B89A6A">DEA</span>
            </p>
            <p style="margin:6px 0 0;font-family:'Arial',sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;white-space:nowrap;color:rgba(255,252,248,0.6)">
              schmuck. handmade. einzigartig.
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:48px 40px 32px">
            <p style="margin:0 0 8px;font-family:'Arial',sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#B89A6A">
              Willkommen bei MANDEA
            </p>
            <h1 style="margin:0 0 24px;font-family:'Georgia',serif;font-size:28px;font-weight:400;color:#2C1810;line-height:1.3">
              Schön, dass du dabei bist!
            </h1>
            <p style="margin:0 0 16px;font-family:'Arial',sans-serif;font-size:15px;line-height:1.7;color:#5C4A3A">
              Du gehörst jetzt zu den Ersten, die neue Artikel, Behind-the-Scenes-Einblicke und exklusive Angebote direkt in ihr Postfach bekommen.
            </p>
            <p style="margin:0 0 32px;font-family:'Arial',sans-serif;font-size:15px;line-height:1.7;color:#5C4A3A">
              Als kleines Dankeschön schenke ich dir <strong style="color:#2C1810">10 % Rabatt</strong> auf deine erste Bestellung:
            </p>

            <!-- Rabattcode -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center">
                <div style="display:inline-block;background:#F5F0EA;border:1.5px dashed #B89A6A;border-radius:8px;padding:20px 40px;text-align:center">
                  <p style="margin:0 0 6px;font-family:'Arial',sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#B89A6A">Dein Rabattcode</p>
                  <p style="margin:0;font-family:'Georgia',serif;font-size:28px;letter-spacing:0.15em;color:#2C1810;font-weight:bold">${DISCOUNT_CODE}</p>
                  <p style="margin:6px 0 0;font-family:'Arial',sans-serif;font-size:12px;color:#8A7060">Einfach beim Checkout eingeben</p>
                </div>
              </td></tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px">
              <tr><td align="center">
                <a href="https://mandea-shop.de/shop.html"
                   style="display:inline-block;background:#B89A6A;color:#FFFCF8;text-decoration:none;font-family:'Arial',sans-serif;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;padding:14px 36px;border-radius:50px">
                  Zur Kollektion →
                </a>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 40px"><div style="height:1px;background:#E8DDD4"></div></td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;text-align:center">
            <p style="margin:0;font-family:'Arial',sans-serif;font-size:12px;color:#A08870;line-height:1.7">
              Du erhältst diese E-Mail, weil du dich auf mandea-shop.de angemeldet hast.<br>
              <a href="https://mandea-shop.de/contact.html" style="color:#B89A6A;text-decoration:underline">Abmelden</a> ·
              <a href="https://mandea-shop.de/contact.html#datenschutz" style="color:#B89A6A;text-decoration:underline">Datenschutz</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'MANDEA <info@mandea-shop.de>',
      to:      [email],
      subject: `Willkommen! Dein Rabattcode: ${DISCOUNT_CODE}`,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend Fehler: ${err.message ?? res.status}`);
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Ungültiger Body.' }) };
  }

  // E-Mail validieren
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }) };
  }

  const emailClean = email.trim().toLowerCase();

  const owner      = process.env.GITHUB_OWNER;
  const repo       = process.env.GITHUB_REPO;
  const branch     = process.env.GITHUB_BRANCH ?? 'main';
  const ghToken    = process.env.GITHUB_TOKEN;
  const resendKey  = process.env.RESEND_API_KEY;

  if (!owner || !repo || !ghToken) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server-Konfigurationsfehler.' }) };
  }

  // Aktuelle subscribers.json laden
  let currentSha, currentData;
  try {
    const current = await githubRequest('GET', `/repos/${owner}/${repo}/contents/${FILE_PATH}?ref=${branch}`, null, ghToken);
    currentSha    = current.sha;
    currentData   = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'));
  } catch {
    currentSha  = undefined;
    currentData = { subscribers: [] };
  }

  const subscribers = currentData.subscribers ?? [];

  // Duplikat-Check — trotzdem Erfolg zurückgeben (kein Datenleck)
  const alreadySubscribed = subscribers.some(s => s.email === emailClean);
  if (!alreadySubscribed) {
    subscribers.push({
      email:     emailClean,
      date:      new Date().toISOString().split('T')[0],
      source:    'homepage',
    });
    currentData.subscribers = subscribers;

    const contentB64 = Buffer.from(JSON.stringify(currentData, null, 2), 'utf-8').toString('base64');
    try {
      await githubRequest('PUT', `/repos/${owner}/${repo}/contents/${FILE_PATH}`, {
        message: `[skip ci] Newsletter-Anmeldung: ${emailClean}`,
        content: contentB64,
        sha:     currentSha,
        branch,
      }, ghToken);
    } catch (err) {
      console.error('GitHub-Fehler beim Speichern:', err.message);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Speichern fehlgeschlagen.' }) };
    }
  }

  // Welcome-E-Mail senden (auch bei Duplikat, falls Resend verfügbar)
  if (resendKey) {
    try {
      await sendWelcomeEmail(emailClean, resendKey);
    } catch (err) {
      // E-Mail-Fehler → Anmeldung trotzdem als erfolgreich werten
      console.error('Resend-Fehler:', err.message);
    }
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true }),
  };
};
