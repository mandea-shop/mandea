# Mandea — Handgefertigter Schmuck

Elegante E-Commerce-Website für das Schmuck-Label **Mandea**.  
Gebaut mit reinem HTML/CSS/JS + Stripe Checkout + Netlify Functions.

---

## Lokale Entwicklung

### Voraussetzungen
- [Node.js](https://nodejs.org/) (v18+)
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) (wird durch `npm install` mitinstalliert)
- Ein [Stripe-Konto](https://dashboard.stripe.com/register) (kostenlos)

### Setup

```bash
# 1. In den Projektordner wechseln
cd mandea

# 2. Abhängigkeiten installieren
npm install

# 3. .env anlegen
cp .env.example .env
# → .env öffnen und STRIPE_SECRET_KEY eintragen (Test-Key: sk_test_...)

# 4. Lokalen Dev-Server starten (inkl. Netlify Functions)
npm run dev
# → http://localhost:8888
```

> Ohne Stripe-Key läuft die Website vollständig — nur der Checkout-Button
> gibt einen Fehler. Für reine Design-/Content-Arbeit reicht `npm run serve`.

---

## Produkte verwalten

Alle Produkte stehen in **`products.json`** (Root) und **`public/products.json`** (Browser-Zugriff).  
Beide Dateien immer synchron halten.

```jsonc
{
  "id": "ohr-001",           // eindeutige ID (URL-safe)
  "name": "Sonnenblüte Ohrhänger",
  "category": "ohrringe",   // ohrringe | armbänder | ketten | ringe
  "categoryLabel": "Ohrringe",
  "price": 3900,             // IMMER in Cent (39,00 € = 3900)
  "description": "...",
  "details": ["Material: ...", "Länge: ..."],
  "badge": "Neu",            // oder null
  "images": [],              // Pfade zu Fotos, z.B. ["/images/products/ohr-001-1.jpg"]
  "inStock": true,
  "featured": true           // erscheint auf der Startseite
}
```

### Eigene Fotos einbinden

1. Fotos in `/public/images/products/` ablegen (empfohlen: WebP, max. 800 KB)
2. In `products.json` eintragen: `"images": ["/images/products/ohr-001.webp"]`
3. Beide `products.json` aktualisieren

---

## Netlify Deployment

### 1. Repository anlegen

```bash
cd mandea
git init
git add .
git commit -m "Initial commit"
# → Auf GitHub/GitLab pushen
```

### 2. Netlify mit dem Repo verbinden

1. [app.netlify.com](https://app.netlify.com) → „Add new site" → „Import an existing project"
2. Repo auswählen
3. Build-Einstellungen werden aus `netlify.toml` automatisch gelesen:
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. Deployment starten

### 3. Stripe-Key in Netlify hinterlegen

**Site settings → Environment variables → Add variable**

| Key                  | Value              |
|----------------------|--------------------|
| `STRIPE_SECRET_KEY`  | `sk_live_...`      |

> ⚠️ Für den Go-live unbedingt den **Live-Key** (`sk_live_...`) verwenden,  
> nicht den Test-Key.

### 4. Domain einrichten (optional)

**Site settings → Domain management → Add custom domain**

Nach dem Hinzufügen einer eigenen Domain:
- In `netlify/functions/create-checkout-session.js` die `ALLOWED_ORIGINS`-Liste aktualisieren
- Netlify stellt automatisch ein SSL-Zertifikat aus

---

## Stripe-Konfiguration

### Zahlungsmethoden aktivieren

Im [Stripe Dashboard](https://dashboard.stripe.com) unter **Settings → Payment methods** aktivieren:
- Kreditkarte (automatisch aktiv)
- PayPal
- Klarna
- EPS (für Österreich)

### Webhooks (optional, für Bestellbestätigungs-E-Mails)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://deine-domain.de/.netlify/functions/stripe-webhook`
3. Events: `checkout.session.completed`
4. Eine eigene `stripe-webhook.js` Function anlegen (Vorlage auf Anfrage)

### Test-Kreditkarten

| Karte                  | Nummer              | Datum | CVC |
|------------------------|---------------------|-------|-----|
| Erfolg                 | 4242 4242 4242 4242 | 12/34 | 123 |
| Karte abgelehnt        | 4000 0000 0000 0002 | 12/34 | 123 |
| 3D Secure erforderlich | 4000 0025 0000 3155 | 12/34 | 123 |

---

## Vor dem Go-live — Checkliste

### Pflicht
- [ ] Impressum vollständig ausgefüllt (contact.html → #impressum)
- [ ] Datenschutzerklärung geprüft und vervollständigt
- [ ] AGB geprüft (ggf. von trusted shops / Rechtsanwalt)
- [ ] Stripe Live-Key in Netlify eingetragen
- [ ] Eigene Domain konfiguriert
- [ ] `ALLOWED_ORIGINS` in `create-checkout-session.js` aktualisiert
- [ ] Instagram-Link aktualisiert (index.html, shop.html, footer)
- [ ] E-Mail-Adresse hinterlegt (contact.html)

### Empfohlen
- [ ] Eigene Produktfotos eingebunden
- [ ] Google Search Console einrichten
- [ ] Netlify Analytics aktivieren (kostenlos)
- [ ] Stripe-Webhook für Bestellbestätigungs-Mails einrichten

---

## Projektstruktur

```
mandea/
├── .env.example                    ← Vorlage für Umgebungsvariablen
├── .gitignore
├── netlify.toml                    ← Hosting-Konfiguration
├── package.json
├── products.json                   ← Produktkatalog (Server-Quelle)
│
├── netlify/functions/
│   └── create-checkout-session.js  ← Stripe Checkout Backend
│
└── public/                         ← Alles was deployed wird
    ├── index.html                  ← Startseite
    ├── shop.html                   ← Shop mit Kategoriefilter
    ├── product.html                ← Produktdetail (?id=...)
    ├── cart.html                   ← Warenkorb
    ├── success.html                ← Nach erfolgreicher Zahlung
    ├── cancel.html                 ← Zahlung abgebrochen
    ├── contact.html                ← Kontakt + Impressum + Datenschutz + AGB
    ├── products.json               ← Produktkatalog (Browser-Quelle)
    │
    ├── css/
    │   ├── main.css                ← Einstiegspunkt (@import)
    │   ├── tokens.css              ← Design-System (Farben, Abstände, ...)
    │   ├── base.css                ← Reset, Typografie, Utilities
    │   ├── components.css          ← Buttons, Navbar, Karten, Footer, ...
    │   ├── home.css                ← Startseite
    │   ├── shop.css                ← Shop-Seite
    │   ├── product.css             ← Produktdetail
    │   ├── cart.css                ← Warenkorb
    │   ├── status.css              ← Success / Cancel
    │   └── contact.css             ← Kontakt & Legal
    │
    ├── js/
    │   └── utils.js                ← Warenkorb, Produkte laden, Toast, Navbar
    │
    └── images/
        ├── favicon.svg
        └── products/               ← Produktfotos hier ablegen
```

---

## Tech Stack

| Bereich     | Technologie                          |
|-------------|--------------------------------------|
| Frontend    | HTML5, CSS3, Vanilla JS (ES Modules) |
| Checkout    | Stripe Hosted Checkout               |
| Backend     | Netlify Functions (Node.js)          |
| Hosting     | Netlify (kostenloser Free Tier)      |
| Datenbank   | Keine — Produkte als JSON-Datei      |

**Kosten im Betrieb:**
- Hosting: 0 € (Netlify Free Tier bis 100 GB Bandbreite/Monat)
- Stripe: 1,5 % + 0,25 € pro Transaktion (EU-Karten)
- Domain: ca. 10–15 €/Jahr (optional, eigene Domain)
