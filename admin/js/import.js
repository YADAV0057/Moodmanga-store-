// admin/js/import.js
// Relies on supabaseClient from admin-config.js and the session guaranteed
// valid by auth-guard.js.

const SCRAPE_URL = `${SUPABASE_URL}/functions/v1/scrape-meesho-products`;
const CLEAN_PRODUCT_URL = `${SUPABASE_URL}/functions/v1/admin-clean-product`;

let scannedProducts = [];

const els = {
  urlsInput: document.getElementById('urlsInput'),
  scanBtn: document.getElementById('scanBtn'),
  scanError: document.getElementById('scanError'),
  reviewSection: document.getElementById('reviewSection'),
  reviewCards: document.getElementById('reviewCards'),
  uploadBtn: document.getElementById('uploadBtn'),
  uploadError: document.getElementById('uploadError'),
  uploadStatus: document.getElementById('uploadStatus'),
  loadCapturedBtn: document.getElementById('loadCapturedBtn'),
  loadCapturedError: document.getElementById('loadCapturedError'),
};

function handleLogout() {
  supabaseClient.auth.signOut().then(() => { window.location.href = 'login.html'; });
}

async function handleScan() {
  els.scanError.hidden = true;

  const urls = els.urlsInput.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    els.scanError.textContent = 'Paste at least one Meesho product URL.';
    els.scanError.hidden = false;
    return;
  }
  if (urls.length > 25) {
    els.scanError.textContent = 'Max 25 URLs per scan — split into batches.';
    els.scanError.hidden = false;
    return;
  }

  els.scanBtn.disabled = true;
  els.scanBtn.textContent = 'Scanning…';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(SCRAPE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok) {
      const debugSuffix = data.debug ? ` (debug: ${JSON.stringify(data.debug)})` : '';
      throw new Error((data.error || 'Scan failed') + debugSuffix);
    }

    scannedProducts = data.products.map(p => ({ ...p, _include: !p.error }));
    renderReviewCards();
    els.reviewSection.hidden = false;
  } catch (err) {
    els.scanError.textContent = err.message;
    els.scanError.hidden = false;
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = 'Scan links';
  }
}

// Bookmarklet-captured products land in scraped_products_staging with
// status 'pending'. This pulls them into the same review/edit UI the
// URL-scan flow uses, tagging each with _staging_id so upload can mark
// them as imported afterwards.
async function handleLoadCaptured() {
  if (els.loadCapturedError) els.loadCapturedError.hidden = true;

  if (els.loadCapturedBtn) {
    els.loadCapturedBtn.disabled = true;
    els.loadCapturedBtn.textContent = 'Loading…';
  }

  try {
    const { data, error } = await supabaseClient
      .from('scraped_products_staging')
      .select('*')
      .eq('status', 'pending')
      .order('captured_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      if (els.loadCapturedError) {
        els.loadCapturedError.textContent = 'No captured items waiting — capture some from the Meesho app first.';
        els.loadCapturedError.hidden = false;
      }
      return;
    }

    scannedProducts = data.map(row => ({
      source_url: row.source_url,
      name: row.name,
      description: row.description,
      price_inr: row.price_inr,
      compare_at_price_inr: row.compare_at_price_inr,
      image_url: row.image_url,
      gallery_urls: row.gallery_urls || [],
      sizes: row.sizes || [],
      colors: row.colors || [],
      category: row.category || 'Clothing',
      mood_tag: row.mood_tag,
      stock_qty: row.stock_qty ?? 10,
      _needs_review: row.needs_review,
      _include: true,
      _staging_id: row.id,
    }));

    renderReviewCards();
    els.reviewSection.hidden = false;
  } catch (err) {
    if (els.loadCapturedError) {
      els.loadCapturedError.textContent = err.message;
      els.loadCapturedError.hidden = false;
    }
  } finally {
    if (els.loadCapturedBtn) {
      els.loadCapturedBtn.disabled = false;
      els.loadCapturedBtn.textContent = 'Load captured items';
    }
  }
}

function renderReviewCards() {
  els.reviewCards.innerHTML = scannedProducts.map((p, i) => {
    if (p.error) {
      return `
        <div class="admin-order-section" style="border-color:#c0392b;">
          <strong>Failed:</strong> ${escapeHtml(p.source_url)}<br>
          <span style="color:#c0392b;">${escapeHtml(p.error)}</span>
        </div>`;
    }
    return `
      <div class="admin-order-section" data-idx="${i}">
        <div class="admin-form-row" style="align-items:flex-start;">
          <label class="admin-checkbox-label" style="flex:0;">
            <input type="checkbox" data-field="_include" data-idx="${i}" ${p._include ? 'checked' : ''}>
          </label>
          ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="" class="admin-thumb" style="width:60px;height:60px;">` : ''}
          <div style="flex:1;">
            <a href="${escapeHtml(p.source_url)}" target="_blank" style="font-size:0.8em; color:#888;">source ↗</a>
            ${p._needs_review ? '<span style="color:#c0392b; font-size:0.8em; margin-left:8px;">needs review</span>' : ''}
          </div>
        </div>
        <label>Name<input type="text" data-field="name" data-idx="${i}" value="${escapeHtml(p.name || '')}"></label>
        <div class="admin-form-row">
          <label>Price (INR)<input type="number" data-field="price_inr" data-idx="${i}" value="${p.price_inr ?? ''}" min="0" step="0.01"></label>
          <label>Compare-at price (INR)<input type="number" data-field="compare_at_price_inr" data-idx="${i}" value="${p.compare_at_price_inr ?? ''}" min="0" step="0.01"></label>
        </div>
        <div class="admin-form-row">
          <label>Category<input type="text" data-field="category" data-idx="${i}" value="${escapeHtml(p.category || 'Clothing')}"></label>
          <label>Mood tag<input type="text" data-field="mood_tag" data-idx="${i}" value="${escapeHtml(p.mood_tag || '')}"></label>
        </div>
        <div class="admin-form-row">
          <label>Sizes (comma separated)<input type="text" data-field="sizes" data-idx="${i}" value="${escapeHtml((p.sizes || []).join(', '))}"></label>
          <label>Stock qty<input type="number" data-field="stock_qty" data-idx="${i}" value="${p.stock_qty ?? 10}" min="0" step="1"></label>
        </div>
        <label>SEO keywords (comma separated)<input type="text" data-field="seo_keywords" data-idx="${i}" value="${escapeHtml((p.seo_keywords || []).join(', '))}"></label>
        <label>Meta description<input type="text" data-field="meta_description" data-idx="${i}" maxlength="155" value="${escapeHtml(p.meta_description || '')}"></label>
        <button type="button" class="clean-ai-btn" data-idx="${i}" ${p._cleaning ? 'disabled' : ''}>
          ${p._cleaning ? '✨ Cleaning…' : '✨ Clean with AI'}
        </button>
        ${p._cleanError ? `<span style="color:#c0392b; font-size:0.8em; margin-left:8px;">${escapeHtml(p._cleanError)}</span>` : ''}
      </div>`;
  }).join('');

  els.reviewCards.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', handleFieldEdit);
    el.addEventListener('change', handleFieldEdit);
  });
  els.reviewCards.querySelectorAll('.clean-ai-btn').forEach(btn => {
    btn.addEventListener('click', () => handleCleanWithAI(Number(btn.dataset.idx)));
  });
}

// Sends one product's raw name/description to admin-clean-product (Gemini)
// and fills in display title, SEO keywords, and meta description with the
// result. Admin can still edit anything before uploading — this never
// writes to the DB itself.
async function handleCleanWithAI(idx) {
  const product = scannedProducts[idx];
  if (!product) return;

  product._cleaning = true;
  product._cleanError = null;
  renderReviewCards();

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(CLEAN_PRODUCT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        products: [{ name: product.name, description: product.description }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Clean failed');

    const result = data.products[0];
    if (result.error) throw new Error(result.error);

    product.name = result.display_title;
    product.seo_keywords = result.seo_keywords;
    product.meta_description = result.meta_description;
  } catch (err) {
    product._cleanError = err.message;
  } finally {
    product._cleaning = false;
    renderReviewCards();
  }
}

function handleFieldEdit(e) {
  const el = e.currentTarget;
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  const product = scannedProducts[idx];
  if (!product) return;

  if (field === '_include') {
    product._include = el.checked;
  } else if (field === 'sizes' || field === 'seo_keywords') {
    product[field] = el.value.split(',').map(s => s.trim()).filter(Boolean);
  } else if (field === 'price_inr' || field === 'compare_at_price_inr' || field === 'stock_qty') {
    product[field] = el.value === '' ? null : Number(el.value);
  } else {
    product[field] = el.value;
  }
}

async function handleUpload() {
  els.uploadError.hidden = true;
  els.uploadStatus.textContent = '';

  const toUpload = scannedProducts
    .filter(p => p._include && !p.error && p.name && p.price_inr)
    .map(p => ({
      slug: slugify(p.name),
      name: p.name,
      description: p.description || null,
      price_inr: p.price_inr,
      compare_at_price_inr: p.compare_at_price_inr || null,
      image_url: p.image_url || null,
      gallery_urls: p.gallery_urls || [],
      sizes: p.sizes || [],
      colors: p.colors || [],
      category: p.category || 'Clothing',
      mood_tag: p.mood_tag || null,
      stock_qty: p.stock_qty ?? 10,
      seo_keywords: p.seo_keywords || [],
      meta_description: p.meta_description || null,
      is_active: true,
      size_guide: 'tops',
    }));

  if (toUpload.length === 0) {
    els.uploadError.textContent = 'Nothing selected to upload — check at least one product with a name and price.';
    els.uploadError.hidden = false;
    return;
  }

  els.uploadBtn.disabled = true;
  els.uploadBtn.textContent = 'Uploading…';

  // Same RLS-protected path products.js uses for single-product saves.
  // upsert on slug so re-scanning/re-uploading the same product updates it
  // instead of creating a duplicate row.
  const { error } = await supabaseClient
    .from('store_products')
    .upsert(toUpload, { onConflict: 'slug' });

  els.uploadBtn.disabled = false;
  els.uploadBtn.textContent = 'Upload selected';

  if (error) {
    els.uploadError.textContent = 'Upload failed: ' + error.message;
    els.uploadError.hidden = false;
    return;
  }

  // Mark any bookmarklet-captured rows that made it into this upload as
  // imported, so they drop out of "Load captured items" next time.
  const importedStagingIds = scannedProducts
    .filter(p => p._include && !p.error && p.name && p.price_inr && p._staging_id)
    .map(p => p._staging_id);

  if (importedStagingIds.length > 0) {
    const { error: stagingErr } = await supabaseClient
      .from('scraped_products_staging')
      .update({ status: 'imported' })
      .in('id', importedStagingIds);
    if (stagingErr) {
      // Non-fatal — the products already uploaded fine, this just means
      // they may reappear next "Load captured items". Surface it quietly.
      console.warn('Failed to mark staging rows imported:', stagingErr.message);
    }
  }

  els.uploadStatus.textContent = `Uploaded ${toUpload.length} product(s). View them in Products.`;
  scannedProducts = [];
  els.reviewCards.innerHTML = '';
  els.reviewSection.hidden = true;
  els.urlsInput.value = '';
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
