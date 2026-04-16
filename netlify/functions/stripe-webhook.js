// ============================================================
// MANDEA — Netlify Function: Stripe Webhook
//
// Empfängt checkout.session.completed und reduziert
// den Lagerbestand in public/products.json via GitHub API.
//
// Benötigte Umgebungsvariablen:
//   STRIPE_SECRET_KEY      — sk_live_... oder sk_test_...
//   STRIPE_WEBHOOK_SECRET  — whsec_... (aus Stripe Dashboard)
//   GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
// ============================================================

import Stripe from 'stripe';

// ── Review-Request E-Mail via Resend ───────────────────────
async function sendReviewRequestEmail(session, resendKey) {
  const email     = session.customer_details?.email;
  const firstName = session.customer_details?.name?.split(' ')[0] ?? 'du';
  const orderId   = session.id;
  const feedbackUrl = `https://mandea-shop.de/?feedback=true&ref=${orderId}`;

  if (!email) return;

  // 3 Tage in der Zukunft
  const sendAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light}</style></head>
<body style="margin:0;padding:0;background:#F5F0EA;font-family:'Georgia',serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EA;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFCF8;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.06)">
        <tr><td style="background:#2C1810;padding:28px 24px;text-align:center">
          <p style="margin:0;font-family:'Georgia',serif;font-size:28px;letter-spacing:0.12em;color:#FFFCF8">MAN<span style="color:#B89A6A">DEA</span></p>
          <p style="margin:6px 0 0;font-family:'Arial',sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;white-space:nowrap;color:rgba(255,252,248,0.6)">schmuck. handmade. einzigartig.</p>
        </td></tr>
        <tr><td style="padding:48px 40px 32px">
          <p style="margin:0 0 8px;font-family:'Arial',sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#B89A6A">Wie gefällt dir dein neues Schmuckstück?</p>
          <h1 style="margin:0 0 24px;font-family:'Georgia',serif;font-size:28px;font-weight:400;color:#2C1810;line-height:1.3">Hallo ${firstName},<br>ich würde mich wirklich sehr über dein Feedback freuen!</h1>
          <p style="margin:0 0 16px;font-family:'Arial',sans-serif;font-size:15px;line-height:1.7;color:#5C4A3A">Dein MANDEA-Artikel ist hoffentlich gut bei dir angekommen und du hast Freude daran!<br>Dann freue ich mich über ein Feedback von dir!<br>Denn deine Meinung bedeutet mir wirklich viel — sie hilft mir, noch besser zu werden und anderen Kunden bei ihrer Entscheidung.</p>
          <p style="margin:0 0 32px;font-family:'Arial',sans-serif;font-size:15px;line-height:1.7;color:#5C4A3A">Es dauert nicht mal 1 Minute — versprochen ✦</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:0"><tr><td align="center">
            <a href="${feedbackUrl}" style="display:inline-block;background:#B89A6A;color:#FFFCF8;text-decoration:none;font-family:'Arial',sans-serif;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;padding:14px 36px;border-radius:50px">✦ Bewertung abgeben</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:0 40px"><div style="height:1px;background:#E8DDD4"></div></td></tr>
        <tr><td style="padding:24px 40px;text-align:center">
          <p style="margin:0 0 8px;font-family:'Arial',sans-serif;font-size:12px;color:#A08870;line-height:1.7">Bestellung: <code style="background:#F5F0EA;padding:2px 6px;border-radius:4px;font-size:11px">${orderId}</code></p>
          <p style="margin:0;font-family:'Arial',sans-serif;font-size:12px;color:#A08870;line-height:1.7">
            <a href="https://mandea-shop.de/contact.html" style="color:#B89A6A;text-decoration:underline">Kontakt</a> ·
            <a href="https://mandea-shop.de/contact.html#datenschutz" style="color:#B89A6A;text-decoration:underline">Datenschutz</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:        'MANDEA <info@mandea-shop.de>',
      to:          [email],
      subject:     'Wie gefällt dir dein neues Schmuckstück? ✦ Dein Feedback für MANDEA',
      html,
      scheduled_at: sendAt, // Resend: in 3 Tagen senden
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend Fehler: ${err.message ?? res.status}`);
  }
}

export const handler = async (event) => {
  const stripeKey     = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('Stripe-Konfiguration fehlt.');
    return { statusCode: 500, body: 'Config error' };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });

  // ── Webhook-Signatur prüfen ─────────────────────────────
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook-Signatur ungültig:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Nur Completed-Events verarbeiten
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = stripeEvent.data.object;
  const itemsJson = session.metadata?.items;
  if (!itemsJson) {
    console.log('Kein items-Metadata in Session — überspringe Lagerbestand-Update.');
    return { statusCode: 200, body: 'No items metadata' };
  }

  let purchasedItems;
  try {
    purchasedItems = JSON.parse(itemsJson);
  } catch {
    console.error('items-Metadata ist kein gültiges JSON.');
    return { statusCode: 400, body: 'Invalid items metadata' };
  }

  // ── GitHub API: products.json laden ────────────────────
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? 'main';
  const token  = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    console.error('GitHub-Konfiguration fehlt.');
    return { statusCode: 500, body: 'GitHub config error' };
  }

  try {
    const fileRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/public/products.json?ref=${branch}`,
      {
        headers: {
          'Authorization':        `Bearer ${token}`,
          'Accept':               'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!fileRes.ok) throw new Error(`GitHub GET ${fileRes.status}`);
    const fileData = await fileRes.json();
    const sha      = fileData.sha;
    const text     = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    const data     = JSON.parse(text);
    const products = data.products;

    // ── Lagerbestand reduzieren ─────────────────────────
    for (const item of purchasedItems) {
      const product = products.find(p => p.id === item.id);
      if (!product) {
        console.warn(`Produkt ${item.id} nicht in products.json gefunden.`);
        continue;
      }

      if (item.size && product.variants?.length) {
        // Varianten-Produkt
        const variant = product.variants.find(v => v.size === item.size);
        if (variant && variant.stock !== null && variant.stock !== undefined) {
          variant.stock   = Math.max(0, variant.stock - item.qty);
          variant.inStock = variant.stock > 0;
        }
        // Produkt-Level inStock aus Varianten ableiten
        product.inStock = product.variants.some(v => v.inStock && (v.stock === null || v.stock > 0));
      } else if (product.stock !== null && product.stock !== undefined) {
        // Produkt ohne Varianten
        product.stock   = Math.max(0, product.stock - item.qty);
        product.inStock = product.stock > 0;
      }
    }

    // ── Zurück zu GitHub speichern ──────────────────────
    const newContent = Buffer.from(JSON.stringify({ products }, null, 2)).toString('base64');

    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/public/products.json`,
      {
        method: 'PUT',
        headers: {
          'Authorization':        `Bearer ${token}`,
          'Accept':               'application/vnd.github+json',
          'Content-Type':         'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          message: `[skip ci] Lagerbestand nach Bestellung ${session.id} aktualisiert`,
          content: newContent,
          sha,
          branch,
        }),
      }
    );

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(`GitHub PUT ${putRes.status}: ${err.message}`);
    }

    console.log(`Lagerbestand für Session ${session.id} aktualisiert.`);

    // ── Review-Request E-Mail (geplant für Tag 3) ───────────
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await sendReviewRequestEmail(session, resendKey);
        console.log(`Review-Request für ${session.customer_details?.email} geplant (Tag 3).`);
      } catch (emailErr) {
        // E-Mail-Fehler darf den Webhook nicht scheitern lassen
        console.error('Review-Request E-Mail Fehler:', emailErr.message);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('Webhook-Fehler:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
