// admin/js/products.js
// CRUD for store_products. Relies on supabaseClient from admin-config.js
// and the session guaranteed valid by auth-guard.js.

let allProducts = [];

const els = {
  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorState'),
  empty: document.getElementById('emptyState'),
  table: document.getElementById('productsTable'),
  tbody: document.getElementById('productsTbody'),
  search: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  statusFilter: document.getElementById('statusFilter'),
  openAddModal: document.getElementById('openAddModal'),
  modal: document.getElementById('productModal'),
  modalTitle: document.getElementById('modalTitle'),
  closeModal: document.getElementById('closeModal'),
  cancelForm: document.getElementById('cancelForm'),
  form: document.getElementById('productForm'),
  formError: document.getElementById('formError'),
  saveBtn: document.getElementById('saveBtn'),
  deleteModal: document.getElementById('deleteModal'),
  deleteProductName: document.getElementById('deleteProductName'),
  cancelDelete: document.getElementById('cancelDelete'),
  confirmDelete: document.getElementById('confirmDelete'),
  logoutBtn: document.getElementById('logoutBtn'),
};

let pendingDeleteId = null;

init();

async function init() {
  els.logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });

  els.openAddModal.addEventListener('click', () => openModal());
  els.closeModal.addEventListener('click', requestCloseModal);
  els.cancelForm.addEventListener('click', requestCloseModal);
  els.form.addEventListener('submit', handleSave);

  els.cancelDelete.addEventListener('click', requestCloseModal);
  els.confirmDelete.addEventListener('click', handleConfirmDelete);

  els.search.addEventListener('input', renderTable);
  els.categoryFilter.addEventListener('change', renderTable);
  els.statusFilter.addEventListener('change', renderTable);

  await loadProducts();
}

async function loadProducts() {
  show(els.loading);
  hide(els.error, els.empty, els.table);

  const { data, error } = await supabaseClient
    .from('store_products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    hide(els.loading);
    els.error.textContent = 'Failed to load products: ' + error.message;
    show(els.error);
    return;
  }

  allProducts = data || [];
  populateCategoryFilter();
  hide(els.loading);
  renderTable();
}

function populateCategoryFilter() {
  const current = els.categoryFilter.value;
  const categories = [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort();
  els.categoryFilter.innerHTML = '<option value="">All categories</option>' +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  els.categoryFilter.value = current;
}

function renderTable() {
  const q = els.search.value.trim().toLowerCase();
  const cat = els.categoryFilter.value;
  const status = els.statusFilter.value;

  const filtered = allProducts.filter(p => {
    if (q && !(p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))) return false;
    if (cat && p.category !== cat) return false;
    if (status === 'active' && !p.is_active) return false;
    if (status === 'inactive' && p.is_active) return false;
    return true;
  });

  if (filtered.length === 0) {
    hide(els.table);
    show(els.empty);
    return;
  }
  hide(els.empty);
  show(els.table);

  els.tbody.innerHTML = filtered.map(p => `
    <tr data-id="${p.id}">
      <td>${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="" class="admin-thumb">` : ''}</td>
      <td>
        <div class="admin-product-name">${escapeHtml(p.name)}</div>
        <div class="admin-product-slug">${escapeHtml(p.slug)}</div>
      </td>
      <td>${escapeHtml(p.category)}</td>
      <td>₹${Number(p.price_inr).toFixed(2)}${p.compare_at_price_inr ? `<span class="admin-strike">₹${Number(p.compare_at_price_inr).toFixed(2)}</span>` : ''}</td>
      <td>
        <div class="admin-stock-control">
          <button class="admin-stock-btn" data-action="stock-dec" data-id="${p.id}">−</button>
          <span class="admin-stock-value" data-stock-for="${p.id}">${p.stock_qty}</span>
          <button class="admin-stock-btn" data-action="stock-inc" data-id="${p.id}">+</button>
        </div>
      </td>
      <td>
        <label class="admin-switch">
          <input type="checkbox" ${p.is_active ? 'checked' : ''} data-action="toggle-active" data-id="${p.id}">
          <span class="admin-switch-slider"></span>
        </label>
      </td>
      <td class="admin-row-actions">
        <button class="btn btn-small" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="btn btn-small btn-danger-outline" data-action="delete" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  els.tbody.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', handleRowAction);
    if (el.dataset.action === 'toggle-active') el.addEventListener('change', handleRowAction);
  });
}

async function handleRowAction(e) {
  const el = e.currentTarget;
  const action = el.dataset.action;
  const id = el.dataset.id;
  const product = allProducts.find(p => p.id === id);
  if (!product) return;

  if (action === 'edit') return openModal(product);
  if (action === 'delete') return openDeleteModal(product);
  if (action === 'toggle-active') return updateProduct(id, { is_active: el.checked }, el);
  if (action === 'stock-inc') return adjustStock(id, 1);
  if (action === 'stock-dec') return adjustStock(id, -1);
}

async function adjustStock(id, delta) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;
  const newQty = Math.max(0, product.stock_qty + delta);
  if (newQty === product.stock_qty) return;
  await updateProduct(id, { stock_qty: newQty });
  const valueEl = document.querySelector(`[data-stock-for="${id}"]`);
  if (valueEl) valueEl.textContent = newQty;
}

async function updateProduct(id, patch, revertEl) {
  const { error } = await supabaseClient.from('store_products').update(patch).eq('id', id);
  if (error) {
    alert('Update failed: ' + error.message);
    if (revertEl) revertEl.checked = !revertEl.checked;
    return;
  }
  const idx = allProducts.findIndex(p => p.id === id);
  if (idx !== -1) allProducts[idx] = { ...allProducts[idx], ...patch };
}

function openModal(product = null) {
  els.formError.hidden = true;
  els.form.reset();
  document.getElementById('productId').value = product?.id || '';
  els.modalTitle.textContent = product ? 'Edit product' : 'Add product';
  document.getElementById('fieldName').value = product?.name || '';
  document.getElementById('fieldSlug').value = product?.slug || '';
  document.getElementById('fieldDescription').value = product?.description || '';
  document.getElementById('fieldPrice').value = product?.price_inr ?? '';
  document.getElementById('fieldCompareAt').value = product?.compare_at_price_inr ?? '';
  document.getElementById('fieldCategory').value = product?.category || 'general';
  document.getElementById('fieldMoodTag').value = product?.mood_tag || '';
  document.getElementById('fieldImageUrl').value = product?.image_url || '';
  document.getElementById('fieldGallery').value = (product?.gallery_urls || []).join('\n');
  document.getElementById('fieldStock').value = product?.stock_qty ?? 0;
  document.getElementById('fieldActive').checked = product ? product.is_active : true;
  show(els.modal);
  openModalWithBackSupport(closeModal);
}

function closeModal() {
  hide(els.modal);
}

async function handleSave(e) {
  e.preventDefault();
  els.formError.hidden = true;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = 'Saving…';

  const id = document.getElementById('productId').value || null;
  const galleryText = document.getElementById('fieldGallery').value.trim();

  const payload = {
    name: document.getElementById('fieldName').value.trim(),
    slug: document.getElementById('fieldSlug').value.trim(),
    description: document.getElementById('fieldDescription').value.trim() || null,
    price_inr: parseFloat(document.getElementById('fieldPrice').value),
    compare_at_price_inr: document.getElementById('fieldCompareAt').value
      ? parseFloat(document.getElementById('fieldCompareAt').value) : null,
    category: document.getElementById('fieldCategory').value.trim() || 'general',
    mood_tag: document.getElementById('fieldMoodTag').value.trim() || null,
    image_url: document.getElementById('fieldImageUrl').value.trim() || null,
    gallery_urls: galleryText ? galleryText.split('\n').map(s => s.trim()).filter(Boolean) : [],
    stock_qty: parseInt(document.getElementById('fieldStock').value, 10),
    is_active: document.getElementById('fieldActive').checked,
  };

  let error;
  if (id) {
    ({ error } = await supabaseClient.from('store_products').update(payload).eq('id', id));
  } else {
    ({ error } = await supabaseClient.from('store_products').insert(payload));
  }

  els.saveBtn.disabled = false;
  els.saveBtn.textContent = 'Save';

  if (error) {
    els.formError.textContent = error.message.includes('duplicate')
      ? 'That slug is already in use — pick a unique one.'
      : 'Save failed: ' + error.message;
    els.formError.hidden = false;
    return;
  }

  requestCloseModal();
  await loadProducts();
}

function openDeleteModal(product) {
  pendingDeleteId = product.id;
  els.deleteProductName.textContent = product.name;
  show(els.deleteModal);
  openModalWithBackSupport(closeDeleteModal);
}

function closeDeleteModal() {
  pendingDeleteId = null;
  hide(els.deleteModal);
}

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  els.confirmDelete.disabled = true;
  const { error } = await supabaseClient.from('store_products').delete().eq('id', pendingDeleteId);
  els.confirmDelete.disabled = false;
  if (error) {
    alert('Delete failed: ' + error.message);
    return;
  }
  requestCloseModal();
  await loadProducts();
}

function show(...elements) { elements.forEach(el => { el.hidden = false; }); }
function hide(...elements) { elements.forEach(el => { el.hidden = true; }); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
