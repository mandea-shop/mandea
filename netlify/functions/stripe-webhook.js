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
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('Webhook-Fehler:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
