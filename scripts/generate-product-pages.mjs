// scripts/generate-product-pages.mjs
// Generates /product/<slug>.html for every active product in Supabase.
// Run this in CI (GitHub Actions) before deploy, or locally with:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/generate-product-pages.mjs
//
// Each generated page has a unique <title>, meta description, and
// schema.org Product JSON-LD, and redirects/links back to the storefront
// so the modal-based quick-view/add-to-cart flow still works.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SITE_URL = process.env.SITE_URL || 'https://yadav0057.github.io/Moodmanga-store-';
const OUTPUT_DIR = path.join(process.cwd(), 'product');

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

  const title = `${name} | MoodManga Store`;
  const metaDesc = meta_description || (description || '').slice(0, 155);
  const keywords = Array.isArray(seo_keywords) ? seo_keywords.join(', ') : '';
  const images = [image_url, ...(gallery_urls || [])].filter(Boolean);
  const canonicalUrl = `${SITE_URL}/product/${slug}.html`;
  const availability = stock_qty > 0
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

<link rel="stylesheet" href="../css/style.css">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<!-- This page is a crawlable, shareable landing page for the product.
     It reuses the same storefront CSS and simply opens the existing
     product modal (main.js) on load, via the ?product= query param,
     so add-to-cart / quick-view logic stays in one place. -->
</head>
<body data-product-slug="${escapeHtml(slug)}">

<header class="site-header">
  <a href="../index.html" class="logo">MoodManga Store</a>
</header>

<main class="product-page">
  <h1>${escapeHtml(name)}</h1>
  ${images[0] ? `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(name)}" width="600">` : ''}
  <p class="price">₹${price_inr}${compare_at_price_inr ? ` <s>₹${compare_at_price_inr}</s>` : ''}</p>
  <div class="description">${escapeHtml(description || '').replace(/\n/g, '<br>')}</div>
  <p><a href="../index.html?product=${encodeURIComponent(slug)}" class="btn-primary">View in store / Add to cart</a></p>
</main>

<script src="../js/config.js"></script>
<script src="../js/main.js"></script>
<script>
  // main.js exposes window.productsReady (the loadProducts() promise) and
  // openProductModal() now accepts a slug as well as a DB id. We wait for
  // productsReady so this doesn't fire before PRODUCTS is populated —
  // crawlers never run this script, they only see the static HTML above,
  // which already has the full title/description/JSON-LD.
  document.addEventListener('DOMContentLoaded', function () {
    if (window.productsReady && typeof window.openProductModal === 'function') {
      window.productsReady.then(function () {
        window.openProductModal('${slug}');
      });
    }
  });
</script>
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

  for (const product of products) {
    if (!product.slug) {
      console.warn(`Skipping product ${product.id} — no slug.`);
      continue;
    }
    const html = buildPage(product);
    const filePath = path.join(OUTPUT_DIR, `${product.slug}.html`);
    await writeFile(filePath, html, 'utf8');
    sitemapUrls.push(`${SITE_URL}/product/${product.slug}.html`);
    console.log(`Generated product/${product.slug}.html`);
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
