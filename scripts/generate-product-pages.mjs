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

// Turns a "Label: value" line-based description into tidy <dl> markup.
// Falls back to plain paragraphs (with <br> for newlines) if the text
// doesn't look like a field list.
function formatDescription(description = '') {
  const lines = description
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const fieldLine = /^([A-Za-z][A-Za-z /-]{1,30}):\s*(.+)$/;
  const isFieldList = lines.length > 0 && lines.every((l) => fieldLine.test(l));

  if (isFieldList) {
    const rows = lines
      .map((l) => {
        const m = l.match(fieldLine);
        return `<div class="spec-row"><dt>${escapeHtml(m[1])}</dt><dd>${escapeHtml(m[2])}</dd></div>`;
      })
      .join('\n');
    return `<dl class="spec-list">${rows}</dl>`;
  }

  return `<p>${escapeHtml(description).replace(/\n/g, '<br>')}</p>`;
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

  const thumbs = images
    .map(
      (src, i) =>
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)} view ${i + 1}" class="thumb${i === 0 ? ' active' : ''}" data-full="${escapeHtml(src)}">`
    )
    .join('\n');

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
     It reuses the site's fonts/colors via CSS variables where possible,
     with a self-contained layout so it looks right even before/without
     custom classes in css/style.css. It also opens the existing product
     modal (main.js) on load via the ?product= query param, so
     add-to-cart / quick-view logic stays in one place. -->
<style>
  :root {
    --pp-bg: #faf3e8;
    --pp-ink: #2b2320;
    --pp-accent: #7a1f1f;
    --pp-accent-hover: #5c1717;
    --pp-muted: #7a7168;
    --pp-border: #e4d8c4;
  }
  .pp-wrap {
    max-width: 480px;
    margin: 0 auto;
    padding: 0 0 48px;
    background: var(--pp-bg);
    color: var(--pp-ink);
    font-family: Georgia, 'Times New Roman', serif;
  }
  .pp-gallery {
    position: relative;
  }
  .pp-gallery img.main {
    width: 100%;
    display: block;
  }
  .pp-thumbs {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    overflow-x: auto;
  }
  .pp-thumbs .thumb {
    width: 60px;
    height: 76px;
    object-fit: cover;
    border: 2px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.75;
  }
  .pp-thumbs .thumb.active {
    border-color: var(--pp-accent);
    opacity: 1;
  }
  .pp-body {
    padding: 16px 20px 0;
  }
  .pp-body h1 {
    font-style: italic;
    font-weight: 700;
    font-size: 1.7rem;
    line-height: 1.25;
    margin: 4px 0 10px;
  }
  .pp-price {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .pp-price s {
    color: var(--pp-muted);
    font-weight: 400;
    margin-left: 8px;
  }
  .pp-stock {
    font-size: 0.85rem;
    margin: 0 0 18px;
    color: ${inStock ? '#2f6b2f' : '#9c3d3d'};
  }
  .spec-list {
    margin: 0 0 20px;
    border-top: 1px solid var(--pp-border);
  }
  .spec-row {
    display: flex;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid var(--pp-border);
    font-size: 0.95rem;
  }
  .spec-row dt {
    flex: 0 0 42%;
    color: var(--pp-muted);
    font-weight: 600;
  }
  .spec-row dd {
    margin: 0;
    flex: 1;
  }
  .pp-cta {
    display: block;
    text-align: center;
    background: var(--pp-accent);
    color: #fff;
    text-decoration: none;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 0.85rem;
    font-weight: 700;
    padding: 15px 20px;
    border-radius: 3px;
    margin: 10px 0 6px;
  }
  .pp-cta:hover {
    background: var(--pp-accent-hover);
  }
  .pp-back {
    display: inline-block;
    margin: 18px 0 0;
    font-size: 0.85rem;
    color: var(--pp-muted);
    text-decoration: underline;
  }
</style>
</head>
<body data-product-slug="${escapeHtml(slug)}">

<header class="site-header">
  <a href="../index.html" class="logo">MoodManga Store</a>
</header>

<main class="pp-wrap product-page">
  <div class="pp-gallery">
    ${images[0] ? `<img class="main" id="pp-main-image" src="${escapeHtml(images[0])}" alt="${escapeHtml(name)}">` : ''}
  </div>
  ${images.length > 1 ? `<div class="pp-thumbs">${thumbs}</div>` : ''}

  <div class="pp-body">
    <h1>${escapeHtml(name)}</h1>
    <p class="pp-price">₹${price_inr}${compare_at_price_inr ? ` <s>₹${compare_at_price_inr}</s>` : ''}</p>
    <p class="pp-stock">${inStock ? 'In stock' : 'Out of stock'}</p>

    ${formatDescription(description)}

    <a href="../index.html?product=${encodeURIComponent(slug)}" class="pp-cta">View in store / Add to cart</a>
    <a href="../index.html" class="pp-back">&larr; Back to all products</a>
  </div>
</main>

<script src="../js/config.js"></script>
<script src="../js/main.js"></script>
<script>
  // Simple thumbnail swap (works even if main.js hasn't loaded yet).
  document.addEventListener('DOMContentLoaded', function () {
    var mainImg = document.getElementById('pp-main-image');
    document.querySelectorAll('.pp-thumbs .thumb').forEach(function (t) {
      t.addEventListener('click', function () {
        if (mainImg) mainImg.src = t.dataset.full;
        document.querySelectorAll('.pp-thumbs .thumb').forEach(function (o) {
          o.classList.remove('active');
        });
        t.classList.add('active');
      });
    });

    // If main.js exposes openProductModal(slug), auto-open it for visitors
    // who land here directly, without breaking crawlers (they only see the
    // static HTML above, which already has full title/description/JSON-LD).
    if (typeof window.openProductModal === 'function') {
      window.openProductModal('${slug}');
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
