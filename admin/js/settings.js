// admin/js/settings.js
// Phase 5: coupon codes management + editable shipping threshold.
// Relies on supabaseClient (admin-config.js) and a session guaranteed by auth-guard.js.

// --- Modal back-button support (inlined, matches orders.js/products.js) ---
const _modalStack = [];
function openModalWithBackSupport(closeFn) {
  _modalStack.push(closeFn);
  history.pushState({ adminModalDepth: _modalStack.length }, document.title);
}
function requestCloseModal() {
  if (_modalStack.length === 0) return;
  history.back();
}
window.addEventListener('popstate', () => {
  const closeFn = _modalStack.pop();
  if (closeFn) closeFn();
});
// --- end modal back-button support ---

let allCoupons = [];
let currentCouponId = null;   // set while add/edit modal is open
let pendingDeleteId = null;   // set while delete-confirm modal is open

const els = {
  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorState'),
  empty: document.getElementById('emptyState'),
  table: document.getElementById('couponsTable'),
  tbody: document.getElementById('couponsTbody'),
  logoutBtn: document.getElementById('logoutBtn'),

  settingsError: document.getElementById('settingsError'),
  settingsSaved: document.getElementById('settingsSaved'),
  fieldShippingThreshold: document.getElementById('fieldShippingThreshold'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),

  modal: document.getElementById('couponModal'),
  modalTitle: document.getElementById('modalTitle'),
  form: document.getElementById('couponForm'),
  couponId: document.getElementById('couponId'),
  fieldCode: document.getElementById('fieldCode'),
  fieldDiscountType: document.getElementById('fieldDiscountType'),
  fieldDiscountValue: document.getElementById('fieldDiscountValue'),
  fieldMinOrder: document.getElementById('fieldMinOrder'),
  fieldMaxUses: document.getElementById('fieldMaxUses'),
  fieldExpiresAt: document.getElementById('fieldExpiresAt'),
  fieldActive: document.getElementById('fieldActive'),
  formError: document.getElementById('formError'),
  saveBtn: document.getElementById('saveBtn'),

  deleteModal: document.getElementById('deleteModal'),
  deleteCouponCode: document.getElementById('deleteCouponCode'),
};

init();

async function init() {
  els.logoutBtn.addEventListener('click', handleLogout);
  await Promise.all([loadSettings(), loadCoupons()]);
}

function handleLogout() {
  supabaseClient.auth.signOut().then(() => { window.location.href = 'login.html'; });
}

// ── Shipping threshold ──────────────────────────────────

async function loadSettings() {
  els.settingsError.hidden = true;
  const { data, error } = await supabaseClient
    .from('store_settings')
    .select('*')
    .eq('key', 'free_shipping_threshold_inr')
    .maybeSingle();

  if (error) {
    els.settingsError.textContent = 'Failed to load settings: ' + error.message;
    els.settingsError.hidden = false;
    return;
  }

  els.fieldShippingThreshold.value = data ? data.value : '';
}

async function handleSaveSettings() {
  els.settingsError.hidden = true;
  els.settingsSaved.hidden = true;
  const value = els.fieldShippingThreshold.value.trim();

  if (value === '' || Number(value) < 0) {
    els.settingsError.textContent = 'Enter a valid non-negative amount.';
    els.settingsError.hidden = false;
    return;
  }

  els.saveSettingsBtn.disabled = true;
  els.saveSettingsBtn.textContent = 'Saving…';

  const { error } = await supabaseClient
    .from('store_settings')
    .upsert({ key: 'free_shipping_threshold_inr', value: String(Number(value)), updated_at: new Date().toISOString() });

  els.saveSettingsBtn.disabled = false;
  els.saveSettingsBtn.textContent = 'Save';

  if (error) {
    els.settingsError.textContent = 'Save failed: ' + error.message;
    els.settingsError.hidden = false;
    return;
  }

  els.settingsSaved.hidden = false;
  setTimeout(() => { els.settingsSaved.hidden = true; }, 2000);
}

// ── Coupons ──────────────────────────────────────────────

async function loadCoupons() {
  show(els.loading);
  hide(els.error, els.empty, els.table);

  const { data, error } = await supabaseClient
    .from('store_coupons')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    hide(els.loading);
    els.error.textContent = 'Failed to load coupons: ' + error.message;
    show(els.error);
    return;
  }

  allCoupons = data || [];
  hide(els.loading);
  renderTable();
}

function renderTable() {
  if (allCoupons.length === 0) {
    hide(els.table);
    show(els.empty);
    return;
  }
  hide(els.empty);
  show(els.table);

  els.tbody.innerHTML = allCoupons.map(c => `
    <tr data-id="${c.id}">
      <td><span class="admin-order-id">${escapeHtml(c.code)}</span></td>
      <td>${c.discount_type === 'percent' ? `${Number(c.discount_value)}%` : `₹${Number(c.discount_value).toFixed(2)}`}</td>
      <td>₹${Number(c.min_order_inr).toFixed(2)}</td>
      <td>${c.uses_count}${c.max_uses ? ` / ${c.max_uses}` : ''}</td>
      <td>${c.expires_at ? formatDate(c.expires_at) : '—'}</td>
      <td><span class="admin-status-badge ${c.active ? 'admin-status-paid' : 'admin-status-cancelled'}">${c.active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <button class="btn btn-small" data-action="edit" data-id="${c.id}">Edit</button>
        <button class="btn btn-small btn-danger-outline" data-action="delete" data-id="${c.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  els.tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.id));
  });
  els.tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
  });
}

function openModal(id) {
  currentCouponId = id || null;
  els.formError.hidden = true;
  els.form.reset();
  els.fieldActive.checked = true;

  if (id) {
    const c = allCoupons.find(x => x.id === id);
    if (!c) return;
    els.modalTitle.textContent = 'Edit coupon';
    els.couponId.value = c.id;
    els.fieldCode.value = c.code;
    els.fieldDiscountType.value = c.discount_type;
    els.fieldDiscountValue.value = c.discount_value;
    els.fieldMinOrder.value = c.min_order_inr;
    els.fieldMaxUses.value = c.max_uses ?? '';
    els.fieldExpiresAt.value = c.expires_at ? c.expires_at.slice(0, 10) : '';
    els.fieldActive.checked = c.active;
  } else {
    els.modalTitle.textContent = 'Add coupon';
    els.couponId.value = '';
  }

  show(els.modal);
  openModalWithBackSupport(closeModal);
}

function closeModal() {
  currentCouponId = null;
  hide(els.modal);
}

async function handleSave(event) {
  event.preventDefault();
  els.formError.hidden = true;

  const payload = {
    code: els.fieldCode.value.trim().toUpperCase(),
    discount_type: els.fieldDiscountType.value,
    discount_value: Number(els.fieldDiscountValue.value),
    min_order_inr: Number(els.fieldMinOrder.value || 0),
    max_uses: els.fieldMaxUses.value ? Number(els.fieldMaxUses.value) : null,
    expires_at: els.fieldExpiresAt.value ? new Date(els.fieldExpiresAt.value).toISOString() : null,
    active: els.fieldActive.checked,
  };

  if (!payload.code) {
    els.formError.textContent = 'Code is required.';
    els.formError.hidden = false;
    return;
  }
  if (!payload.discount_value || payload.discount_value <= 0) {
    els.formError.textContent = 'Discount value must be greater than 0.';
    els.formError.hidden = false;
    return;
  }
  if (payload.discount_type === 'percent' && payload.discount_value > 100) {
    els.formError.textContent = 'Percent discount cannot exceed 100.';
    els.formError.hidden = false;
    return;
  }

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = 'Saving…';

  let error;
  if (currentCouponId) {
    ({ error } = await supabaseClient.from('store_coupons').update(payload).eq('id', currentCouponId));
  } else {
    ({ error } = await supabaseClient.from('store_coupons').insert(payload));
  }

  els.saveBtn.disabled = false;
  els.saveBtn.textContent = 'Save';

  if (error) {
    els.formError.textContent = (error.code === '23505' ? 'That code already exists.' : 'Save failed: ' + error.message);
    els.formError.hidden = false;
    return;
  }

  requestCloseModal();
  await loadCoupons();
}

function openDeleteModal(id) {
  pendingDeleteId = id;
  const c = allCoupons.find(x => x.id === id);
  els.deleteCouponCode.textContent = c ? c.code : '';
  show(els.deleteModal);
  openModalWithBackSupport(closeDeleteModal);
}

function closeDeleteModal() {
  pendingDeleteId = null;
  hide(els.deleteModal);
}

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  const { error } = await supabaseClient.from('store_coupons').delete().eq('id', pendingDeleteId);
  if (error) {
    alert('Delete failed: ' + error.message);
    return;
  }
  requestCloseModal();
  await loadCoupons();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function show(...elements) { elements.forEach(el => { el.hidden = false; }); }
function hide(...elements) { elements.forEach(el => { el.hidden = true; }); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
