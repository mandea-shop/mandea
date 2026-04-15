// ============================================================
// MANDEA — Netlify Function: Stripe Checkout Session erstellen
//
// Ablauf:
//   1. Frontend POST mit { items: [{id, name, price, qty, ...}] }
//   2. Function validiert die Items gegen products.json (Preise
//      IMMER serverseitig — nie vom Client übernehmen!)
//   3. Stripe Checkout Session wird erstellt
//   4. URL der gehosteten Stripe-Seite wird zurückgegeben
//
// Benötigte Umgebungsvariablen (in Netlify Dashboard setzen):
//   STRIPE_SECRET_KEY  — sk_live_... oder sk_test_...
//
// Lokales Testen:
//   netlify dev  (liest .env automatisch)
// ============================================================

import Stripe from 'stripe';

// Produkte von GitHub API laden (identisch zu get-products.js)
async function loadProducts() {
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? 'main';
  const token  = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error('GitHub-Konfiguration fehlt.');
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/public/products.json?ref=${branch}`,
    {
      headers: {
        'Authorization':        `Bearer ${token}`,
        'Accept':               'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return data.products ?? [];
}

const ALLOWED_ORIGINS = [
  'https://mandea.netlify.app',
  'https://mandea.de',
  'https://www.mandea.de',
  'http://localhost:3000',
  'http://localhost:8888',
];

export const handler = async (event) => {
  // ── CORS ────────────────────────────────────────────────────
  const origin = event.headers.origin ?? '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin':  corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  // ── Stripe initialisieren ────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY fehlt in den Umgebungsvariablen.');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Server-Konfigurationsfehler.' }),
    };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });

  // ── Request-Body parsen ──────────────────────────────────────
  let items;
  try {
    ({ items } = JSON.parse(event.body ?? '{}'));
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Ungültiger Request-Body.' }),
    };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Warenkorb ist leer.' }),
    };
  }

  // ── Preise serverseitig validieren ───────────────────────────
  // Wir laden die Produkte aus products.json und vergleichen IDs.
  // Der Client-Preis wird IGNORIERT — nur der Server-Preis gilt.
  let catalog;
  try {
    catalog = loadProducts();
  } catch (err) {
    console.error('products.json konnte nicht geladen werden:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Produktkatalog nicht verfügbar.' }),
    };
  }

  const lineItems = [];
  for (const item of items) {
    const product = catalog.find(p => p.id === item.id);

    if (!product) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: `Produkt „${item.id}" nicht gefunden.` }),
      };
    }

    if (!product.inStock) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: `„${product.name}" ist leider nicht mehr verfügbar.` }),
      };
    }

    const qty = parseInt(item.qty, 10);
    if (!qty || qty < 1 || qty > 10) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: `Ungültige Menge für „${product.name}".` }),
      };
    }

    lineItems.push({
      price_data: {
        currency:     'eur',
        unit_amount:  product.price,   // Cent aus der Server-Datei
        product_data: {
          name:        product.name,
          description: product.description.substring(0, 500),
          metadata: {
            mandea_id: product.id,
            category:  product.category,
          },
        },
      },
      quantity: qty,
    });
  }

  // ── Versandkosten ────────────────────────────────────────────
  const subtotal = lineItems.reduce(
    (sum, li) => sum + li.price_data.unit_amount * li.quantity, 0
  );
  const freeShippingThreshold = 6000; // 60 €

  const shippingOptions = subtotal >= freeShippingThreshold
    ? [{
        shipping_rate_data: {
          type:         'fixed_amount',
          fixed_amount: { amount: 0, currency: 'eur' },
          display_name: 'Kostenloser Versand',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 4 },
          },
        },
      }]
    : [{
        shipping_rate_data: {
          type:         'fixed_amount',
          fixed_amount: { amount: 490, currency: 'eur' },
          display_name: 'Standardversand',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 4 },
          },
        },
      }];

  // ── Checkout Session anlegen ─────────────────────────────────
  const baseUrl = event.headers.origin ?? ALLOWED_ORIGINS[0];

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                  'payment',
      line_items:            lineItems,
      shipping_options:      shippingOptions,
      shipping_address_collection: {
        allowed_countries: ['DE', 'AT', 'CH'],
      },
      locale:                'de',
      success_url:           `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:            `${baseUrl}/cancel.html`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        source: 'mandea-shop',
      },
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('Stripe-Fehler:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Checkout konnte nicht gestartet werden.' }),
    };
  }
};
