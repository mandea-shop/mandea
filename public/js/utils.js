/* ============================================================
   MANDEA — Utility-Funktionen
   Gemeinsame Hilfsfunktionen für alle Seiten
   ============================================================ */

'use strict';

// ── Preis-Formatierung ────────────────────────────────────

/**
 * Formatiert einen Cent-Betrag als deutschen Euro-Preis.
 * @param {number} cents - Betrag in Cent (z.B. 3900 für 39,00 €)
 * @returns {string} z.B. "39,00 €"
 */
export function formatPrice(cents) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(cents / 100);
}


// ── Produkte laden ────────────────────────────────────────

let _productsCache = null;

/**
 * Lädt products.json (gecacht nach erstem Laden).
 * @returns {Promise<Array>} Array aller Produkte
 */
export async function loadProducts() {
  if (_productsCache) return _productsCache;

  // Pfad relativ zur Domain-Root
  const res = await fetch('/.netlify/functions/get-products');
  if (!res.ok) throw new Error('Produkte konnten nicht geladen werden.');
  const data = await res.json();
  _productsCache = data.products;
  return _productsCache;
}

/**
 * Gibt ein einzelnes Produkt nach ID zurück.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getProductById(id) {
  const products = await loadProducts();
  return products.find(p => p.id === id) ?? null;
}


// ── Toast-Nachrichten ─────────────────────────────────────

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Zeigt eine Toast-Benachrichtigung.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration ms bis zur automatischen Ausblendung
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = ensureToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Icon
  const icons = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  toast.innerHTML = `
    <span class="toast__icon">${icons[type] ?? icons.info}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}


// ── Navbar-Scroll-Effekt & aktiver Link ───────────────────

export function initNavbar() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  // Scroll-Schatten
  const updateScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
  };
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();

  // Aktiven Link hervorheben
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.navbar__link').forEach(link => {
    const href = link.getAttribute('href')?.replace(/\/$/, '') || '';
    if (href === path || (href !== '/' && path.startsWith(href))) {
      link.classList.add('active');
    }
  });

  // Hamburger-Menü (Mobile)
  const hamburger = document.querySelector('.navbar__hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileClose = document.querySelector('.mobile-menu__close');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open');
      document.body.style.overflow = mobileMenu.classList.contains('open') ? 'hidden' : '';
    });

    mobileClose?.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
}


// ── Warenkorb-Badge aktualisieren ─────────────────────────

export function updateCartBadge() {
  const badge = document.querySelector('.cart-badge');
  if (!badge) return;

  const cart = getCart();
  const count = cart.reduce((sum, item) => sum + item.qty, 0);

  badge.textContent = count > 99 ? '99+' : count;
  badge.classList.toggle('visible', count > 0);
}


// ── Lokaler Warenkorb (localStorage) ─────────────────────

const CART_KEY = 'mandea_cart';

export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
  // Eigenes Event für andere Tabs/Listener
  window.dispatchEvent(new CustomEvent('mandea:cart-update', { detail: { cart } }));
}

export function addToCart(product, qty = 1) {
  const cart = getCart();
  const existing = cart.find(i => i.id === product.id);

  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id:           product.id,
      name:         product.name,
      category:     product.categoryLabel,
      price:        product.price,
      image:        product.images?.[0] ?? null,
      qty,
    });
  }

  saveCart(cart);
  showToast(`„${product.name}" wurde zum Warenkorb hinzugefügt.`, 'success');
}

export function removeFromCart(productId) {
  const cart = getCart().filter(i => i.id !== productId);
  saveCart(cart);
}

export function updateQty(productId, qty) {
  if (qty <= 0) {
    removeFromCart(productId);
    return;
  }
  const cart = getCart();
  const item = cart.find(i => i.id === productId);
  if (item) {
    item.qty = qty;
    saveCart(cart);
  }
}

export function clearCart() {
  saveCart([]);
}

export function getCartTotal() {
  return getCart().reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function getCartCount() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}


// ── Kategorien laden ──────────────────────────────────

let _categoriesCache = null;

export async function loadCategories() {
  if (_categoriesCache) return _categoriesCache;
  const res = await fetch('/.netlify/functions/get-categories');
  if (!res.ok) throw new Error('Kategorien konnten nicht geladen werden.');
  const data = await res.json();
  _categoriesCache = data.categories ?? [];
  return _categoriesCache;
}

/**
 * Befüllt den Footer-Shop-Nav dynamisch aus der Kategorien-API.
 * Voraussetzung: <nav id="footer-shop-links"> im HTML.
 */
export async function loadFooterCategories() {
  const el = document.getElementById('footer-shop-links');
  if (!el) return;
  try {
    const cats = await loadCategories();
    el.innerHTML = cats.map(c =>
      `<a href="/shop.html?kategorie=${encodeURIComponent(c.id)}">${c.label}</a>`
    ).join('');
  } catch {
    // Fallback: leer lassen
  }
}
