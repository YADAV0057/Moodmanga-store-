// scripts/generate-product-pages.mjs
// Generates /product/<slug>.html for every active product in Supabase.
// Run this in CI (GitHub Actions) before deploy, or locally with:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/generate-product-pages.mjs
//
// Each generated page has a unique <title>, meta description, and
// schema.org Product JSON-LD, and redirects/links back to the storefront
// so the modal-based quick-view/add-to-cart flow still works.

import { writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SITE_URL = process.env.SITE_URL || 'https://yadav0057.github.io/Moodmanga-store-';
const OUTPUT_DIR = path.join(process.cwd(), 'product');
// Busts the browser cache for css/style.css and js/main.js on every
// regeneration — otherwise browsers (mobile ones especially) can keep
// serving a stale main.js indefinitely after a fix ships, since the
// filename never changes.
const ASSET_VERSION = Date.now();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars.');
  process.exit(1);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turns a line-based description into tidy markup. Handles three kinds
// of lines: "Label: value" (bolded label), "Label:" with nothing after
// it (a section header, e.g. "Sizes:"), and plain continuation lines
// (e.g. "XS, S (Bust Size: 36 in...)") which get indented under the
// most recent header.
function formatDescription(description = '') {
  const lines = description
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';

  const fieldLine = /^([A-Za-z][A-Za-z /-]{1,30}):\s*(.*)$/;
  const rows = lines.map((l) => {
    const m = l.match(fieldLine);
    if (m && m[2]) {
      // "Label: value"
      return `<p class="spec-line"><strong>${escapeHtml(m[1])}:</strong> ${escapeHtml(m[2])}</p>`;
    }
    if (m && !m[2]) {
      // "Label:" with nothing after it — treat as a section header
      return `<p class="spec-header"><strong>${escapeHtml(m[1])}:</strong></p>`;
    }
    // Plain continuation line (e.g. a size row)
    return `<p class="spec-sub">${escapeHtml(l)}</p>`;
  });

  return `<div class="spec-list">${rows.join('\n')}</div>`;
}

function buildPage(product) {
  const {
    slug,
    name,
    description,
    price_inr,
    compare_at_price_inr,
    image_url,
    gallery_urls,
    seo_keywords,
    meta_description,
    stock_qty,
    category,
  } = product;

  const title = `${name} | Mood Store`;
  const metaDesc = meta_description || (description || '').slice(0, 155);
  const keywords = Array.isArray(seo_keywords) ? seo_keywords.join(', ') : '';
  const images = [image_url, ...(gallery_urls || [])].filter(Boolean);
  const canonicalUrl = `${SITE_URL}/product/${slug}.html`;
  const inStock = stock_qty > 0;
  const availability = inStock
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: metaDesc,
    image: images,
    sku: slug,
    category: category || undefined,
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      priceCurrency: 'INR',
      price: price_inr,
      availability,
    },
  };

  // Lightweight pre-JS content: shown briefly while main.js loads the
  // real interactive view, and is what search engines / no-JS visitors
  // see. main.js immediately replaces this with the full experience
  // (size picker, qty, add to bag, reviews) — there is only ONE actual
  // ordering surface; this is just its instant-paint placeholder.
  const fallbackHtml = `
    ${images[0] ? `<img class="img-wrap gallery-main" style="width:100%;display:block;" src="${escapeHtml(images[0])}" alt="${escapeHtml(name)}">` : ''}
    <h2>${escapeHtml(name)}</h2>
    <div class="price">₹${price_inr}${compare_at_price_inr ? ` <s>₹${compare_at_price_inr}</s>` : ''}</div>
    <div class="desc">${formatDescription(description)}</div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
${keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}">` : ''}
<link rel="canonical" href="${canonicalUrl}">

<!-- Open Graph -->
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(name)}">
<meta property="og:description" content="${escapeHtml(metaDesc)}">
${images[0] ? `<meta property="og:image" content="${escapeHtml(images[0])}">` : ''}
<meta property="og:url" content="${canonicalUrl}">

<link rel="stylesheet" href="../css/style.css?v=${ASSET_VERSION}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<!-- This page IS the storefront's single ordering surface for this
     product — main.js renders the same gallery/size-picker/cart/reviews
     UI used elsewhere directly into #productDetail below. It reuses the
     site's existing classes (.gallery, .price, .variant-row, .size-btn,
     .btn-primary, etc.) so it's already styled by css/style.css. This
     <style> block only adds page-level layout: header, cart drawer, and
     a content wrapper — plus safety-net fallbacks in case those classes
     aren't defined for a bare page context. -->
<style>
  :root {
    --pp-bg: #faf3e8;
    --pp-ink: #2b2320;
    --pp-accent: #7a1f1f;
    --pp-accent-hover: #5c1717;
    --pp-muted: #7a7168;
    --pp-border: #e4d8c4;
  }
  body { margin: 0; background: var(--pp-bg); color: var(--pp-ink); font-family: Georgia, 'Times New Roman', serif; }
  .ppage-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--pp-border);
  }
  .ppage-header .logo { font-size: 1.2rem; text-decoration: underline; color: var(--pp-ink); }
  .ppage-cart-btn {
    position: relative;
    background: none;
    border: 1px solid var(--pp-border);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 1rem;
    cursor: pointer;
    font-family: Arial, sans-serif;
  }
  .ppage-cart-count {
    display: inline-block;
    min-width: 16px;
    padding: 0 4px;
    margin-left: 4px;
    background: var(--pp-accent);
    color: #fff;
    border-radius: 10px;
    font-size: 0.75rem;
    line-height: 16px;
  }
  .ppage-wrap {
    max-width: 480px;
    margin: 0 auto;
    padding: 0 20px 48px;
  }
  .ppage-wrap h2 { font-style: italic; font-size: 1.7rem; line-height: 1.25; margin: 14px 0 8px; }
  .ppage-wrap .price { font-size: 1.15rem; font-weight: 600; }
  .ppage-wrap .btn-primary, .ppage-wrap #addToCartBtn {
    display: block; width: 100%; text-align: center; background: var(--pp-accent); color: #fff;
    border: none; text-decoration: none; letter-spacing: 0.08em; text-transform: uppercase;
    font-family: Arial, Helvetica, sans-serif; font-size: 0.85rem; font-weight: 700;
    padding: 15px 20px; border-radius: 3px; margin: 14px 0 6px; cursor: pointer;
  }
  .ppage-wrap #addToCartBtn:hover { background: var(--pp-accent-hover); }
  .ppage-wrap #addToCartBtn:disabled { background: var(--pp-muted); cursor: not-allowed; }
  .ppage-wrap .size-btn, .ppage-wrap .swatch {
    font-family: Arial, sans-serif; border: 1px solid var(--pp-border); background: #fff;
    padding: 6px 12px; margin: 0 6px 6px 0; border-radius: 3px; cursor: pointer;
  }
  .ppage-wrap .size-btn.selected { border-color: var(--pp-accent); background: var(--pp-accent); color: #fff; }
  .ppage-wrap .qty-stepper button { font-family: Arial, sans-serif; padding: 4px 10px; }
  .ppage-back { display: inline-block; margin: 18px 0 0; font-size: 0.85rem; color: var(--pp-muted); text-decoration: underline; }
  .spec-list { margin: 0 0 20px; padding-top: 14px; border-top: 1px solid var(--pp-border); }
  .spec-list p { margin: 0 0 8px; font-size: 0.95rem; line-height: 1.5; }
  .spec-header { margin-top: 14px !important; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pp-muted); }
  .spec-sub { margin-left: 14px !important; color: #4a4038; }
  .spec-sub::before { content: "– "; color: var(--pp-muted); }

  /* Cart drawer — self-contained so it works even if css/style.css
     doesn't define these page-level IDs. */
  #backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 40; }
  #backdrop.open { opacity: 1; pointer-events: auto; }
  #cartDrawer {
    position: fixed; top: 0; right: 0; height: 100%; width: min(340px, 88vw);
    background: var(--pp-bg); box-shadow: -2px 0 12px rgba(0,0,0,.2);
    transform: translateX(100%); transition: transform .25s; z-index: 41;
    padding: 18px; box-sizing: border-box; overflow-y: auto;
  }
  #cartDrawer.open { transform: translateX(0); }
  #cartDrawer .cart-item { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--pp-border); font-size: 0.9rem; }
  #cartDrawer .qty-controls { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  #cartDrawer .qty-controls button { font-family: Arial, sans-serif; }
  #closeCart { background: none; border: none; font-size: 1.2rem; cursor: pointer; float: right; }
</style>
</head>
<body>

<header class="ppage-header site-header">
  <a href="../index.html" class="logo">Mood Store</a>
  <button type="button" id="cartToggle" class="ppage-cart-btn">🛍 Bag <span id="cartCount" class="ppage-cart-count">0</span></button>
</header>

<main class="ppage-wrap product-page">
  <div id="productDetail" data-slug="${escapeHtml(slug)}">${fallbackHtml}</div>
  <a href="../index.html" class="ppage-back">&larr; Back to all products</a>
</main>

<div id="backdrop"></div>
<aside id="cartDrawer">
  <button type="button" id="closeCart">&times;</button>
  <h3>Your Bag</h3>
  <div id="cartItems"></div>
  <div style="margin-top:14px;font-weight:600;">Total: <span id="cartTotal">₹0</span></div>
  <button type="button" id="checkoutBtn" class="btn btn-primary" style="width:100%;margin-top:14px;">GO TO CHECKOUT</button>
</aside>

<!-- Checkout modal — was missing from this template, which is why Bag
     had no working checkout and Buy Now silently failed on product
     pages (checkout.js wasn't loaded either; see script tags below). -->
<div class="modal-overlay" id="checkoutModal">
  <div class="modal">
    <button class="modal-close" id="closeCheckout">×</button>
    <div class="modal-body">
      <h2>Checkout</h2>
      <form class="checkout-form" id="checkoutForm">
        <label>Full name</label>
        <input type="text" name="name" required />
        <label>Email</label>
        <input type="email" name="email" required />
        <label>Phone</label>
        <input type="tel" name="phone" required />
        <label>Address line</label>
        <input type="text" name="line1" required />
        <label>City</label>
        <input type="text" name="city" required />
        <label>State</label>
        <input type="text" name="state" required />
        <label>Pincode</label>
        <input type="text" name="pincode" required />
        <div class="cart-total"><span>Total</span><span id="checkoutTotal">₹0</span></div>
        <button type="submit" class="btn btn-dark" id="payBtn">PAY WITH CASHFREE</button>
      </form>
    </div>
  </div>
</div>

<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="../js/config.js?v=${ASSET_VERSION}"></script>
<script src="../js/track.js?v=${ASSET_VERSION}"></script>  
<script src="../js/main.js?v=${ASSET_VERSION}"></script>
<script src="../js/checkout.js?v=${ASSET_VERSION}"></script>
</body>
</html>
`;
}

async function main() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/store_products?is_active=eq.true&select=*`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
  }

  const products = await res.json();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const sitemapUrls = [];
  const currentSlugs = new Set();

  for (const product of products) {
    if (!product.slug) {
      console.warn(`Skipping product ${product.id} — no slug.`);
      continue;
    }
    currentSlugs.add(`${product.slug}.html`);
    const html = buildPage(product);
    const filePath = path.join(OUTPUT_DIR, `${product.slug}.html`);
    await writeFile(filePath, html, 'utf8');
    sitemapUrls.push(`${SITE_URL}/product/${product.slug}.html`);
    console.log(`Generated product/${product.slug}.html`);
  }

  // Remove stale pages for products that were deleted or deactivated
  // since the last run — otherwise a removed product's page (with
  // whatever template was current when it was last built) stays live
  // and indexable forever.
  const existingFiles = await readdir(OUTPUT_DIR);
  for (const file of existingFiles) {
    if (!file.endsWith('.html')) continue;
    if (currentSlugs.has(file)) continue;
    await rm(path.join(OUTPUT_DIR, file));
    console.log(`Removed stale product/${file} (no longer an active product).`);
  }

  // Minimal sitemap covering only product pages; merge with your main
  // sitemap if you already generate one.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(process.cwd(), 'sitemap-products.xml'), sitemap, 'utf8');

  console.log(`Done. ${sitemapUrls.length} product pages generated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
