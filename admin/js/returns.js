// admin/js/returns.js
// List/filter return requests, view details, update status/admin notes.
// Relies on supabaseClient (admin-config.js) and a session guaranteed by auth-guard.js.
// Mirrors the structure of orders.js for consistency.

// --- Modal back-button support (inlined, matches orders.js) ---
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

let allReturns = [];
let currentReturnId = null;

const els = {
  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorState'),
  empty: document.getElementById('emptyState'),
  table: document.getElementById('returnsTable'),
  tbody: document.getElementById('returnsTbody'),
  statusFilter: document.getElementById('statusFilter'),

  modal: document.getElementById('returnModal'),
  detailOrderId: document.getElementById('detailOrderId'),
  detailCustomerEmail: document.getElementById('detailCustomerEmail'),
  detailReason: document.getElementById('detailReason'),
  detailNote: document.getElementById('detailNote'),
  detailStatus: document.getElementById('detailStatus'),
  detailAdminNotes: document.getElementById('detailAdminNotes'),
  detailError: document.getElementById('detailError'),
  saveReturnBtn: document.getElementById('saveReturnBtn'),
};

const REASON_LABELS = {
  wrong_size: "Wrong size / doesn't fit",
  not_as_described: 'Item not as described',
  damaged: 'Arrived damaged or defective',
  changed_mind: 'Changed my mind',
  other: 'Other',
};

init();

async function init() {
  els.statusFilter.addEventListener('change', renderTable);
  await loadReturns();
}

function handleLogout() {
  supabaseClient.auth.signOut().then(() => { window.location.href = 'login.html'; });
}

async function loadReturns() {
  show(els.loading);
  hide(els.error, els.empty, els.table);

  const { data, error } = await supabaseClient
    .from('store_return_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    hide(els.loading);
    els.error.textContent = 'Failed to load return requests: ' + error.message;
    show(els.error);
    return;
  }

  allReturns = data || [];
  hide(els.loading);
  renderTable();
}

function renderTable() {
  const status = els.statusFilter.value;
  const filtered = allReturns.filter(r => !status || r.status === status);

  if (filtered.length === 0) {
    hide(els.table);
    show(els.empty);
    return;
  }
  hide(els.empty);
  show(els.table);

  els.tbody.innerHTML = filtered.map(r => `
    <tr data-id="${r.id}">
      <td><span class="admin-order-id" title="${r.cashfree_order_id}">${escapeHtml(r.cashfree_order_id)}</span></td>
      <td>${escapeHtml(r.customer_email)}</td>
      <td>${escapeHtml(REASON_LABELS[r.reason] || r.reason)}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><span class="admin-status-badge admin-status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
      <td><button class="btn btn-small" data-action="view" data-id="${r.id}">View</button></td>
    </tr>
  `).join('');

  els.tbody.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => openReturnDetail(btn.dataset.id));
  });
}

function openReturnDetail(returnId) {
  currentReturnId = returnId;
  els.detailError.hidden = true;

  const r = allReturns.find(x => x.id === returnId);
  if (!r) return;

  els.detailOrderId.textContent = `Order: ${r.cashfree_order_id}`;
  els.detailCustomerEmail.textContent = `Customer: ${r.customer_email}`;
  els.detailReason.textContent = `Reason: ${REASON_LABELS[r.reason] || r.reason}`;
  els.detailNote.textContent = r.note ? `Note: ${r.note}` : '';

  els.detailStatus.value = r.status;
  els.detailAdminNotes.value = r.admin_notes || '';

  show(els.modal);
  openModalWithBackSupport(closeReturnModal);
}

function closeReturnModal() {
  currentReturnId = null;
  hide(els.modal);
}

async function handleSaveReturn() {
  if (!currentReturnId) return;
  els.detailError.hidden = true;
  els.saveReturnBtn.disabled = true;
  els.saveReturnBtn.textContent = 'Saving…';

  const patch = {
    status: els.detailStatus.value,
    admin_notes: els.detailAdminNotes.value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from('store_return_requests')
    .update(patch)
    .eq('id', currentReturnId);

  els.saveReturnBtn.disabled = false;
  els.saveReturnBtn.textContent = 'Save changes';

  if (error) {
    els.detailError.textContent = 'Save failed: ' + error.message;
    els.detailError.hidden = false;
    return;
  }

  const idx = allReturns.findIndex(r => r.id === currentReturnId);
  if (idx !== -1) allReturns[idx] = { ...allReturns[idx], ...patch };

  requestCloseModal();
  renderTable();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function show(...elements) { elements.forEach(el => { el.hidden = false; }); }
function hide(...elements) { elements.forEach(el => { el.hidden = true; }); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
