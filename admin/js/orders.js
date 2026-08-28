// admin/js/orders.js
// List/filter orders, view details + line items, update status/tracking/notes.
// Relies on supabaseClient (admin-config.js) and a session guaranteed by auth-guard.js.

let allOrders = [];
let currentOrderId = null;

const els = {
  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorState'),
  empty: document.getElementById('emptyState'),
  table: document.getElementById('ordersTable'),
  tbody: document.getElementById('ordersTbody'),
  search: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  logoutBtn: document.getElementById('logoutBtn'),

  modal: document.getElementById('orderModal'),
  closeModal: document.getElementById('closeModal'),
  detailCustomer: document.getElementById('detailCustomer'),
  detailContact: document.getElementById('detailContact'),
  detailAddress: document.getElementById('detailAddress'),
  detailItemsTbody: document.getElementById('detailItemsTbody'),
  detailSubtotal: document.getElementById('detailSubtotal'),
  detailShipping: document.getElementById('detailShipping'),
  detailTotal: document.getElementById('detailTotal'),
  detailPayment: document.getElementById('detailPayment'),
  detailStatus: document.getElementById('detailStatus'),
  detailCarrier: document.getElementById('detailCarrier'),
  detailTracking: document.getElementById('detailTracking'),
  detailNotes: document.getElementById('detailNotes'),
  detailError: document.getElementById('detailError'),
  saveOrderBtn: document.getElementById('saveOrderBtn'),
};

init();

async function init() {
  els.logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });

  els.closeModal.addEventListener('click', requestCloseModal);
  els.saveOrderBtn.addEventListener('click', handleSaveOrder);
  els.search.addEventListener('input', renderTable);
  els.statusFilter.addEventListener('change', renderTable);

  await loadOrders();
}

async function loadOrders() {
  show(els.loading);
  hide(els.error, els.empty, els.table);

  const { data, error } = await supabaseClient
    .from('store_orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    hide(els.loading);
    els.error.textContent = 'Failed to load orders: ' + error.message;
    show(els.error);
    return;
  }

  allOrders = data || [];
  hide(els.loading);
  renderTable();
}

function renderTable() {
  const q = els.search.value.trim().toLowerCase();
  const status = els.statusFilter.value;

  const filtered = allOrders.filter(o => {
    if (status && o.status !== status) return false;
    if (q) {
      const haystack = `${o.customer_name} ${o.customer_email} ${o.id} ${o.cashfree_order_id || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    hide(els.table);
    show(els.empty);
    return;
  }
  hide(els.empty);
  show(els.table);

  els.tbody.innerHTML = filtered.map(o => `
    <tr data-id="${o.id}">
      <td><span class="admin-order-id" title="${o.id}">#${o.id.slice(0, 8)}</span></td>
      <td>
        <div class="admin-product-name">${escapeHtml(o.customer_name)}</div>
        <div class="admin-product-slug">${escapeHtml(o.customer_email)}</div>
      </td>
      <td>${formatDate(o.created_at)}</td>
      <td>₹${Number(o.total_inr).toFixed(2)}</td>
      <td><span class="admin-status-badge admin-status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
      <td><button class="btn btn-small" data-action="view" data-id="${o.id}">View</button></td>
    </tr>
  `).join('');

  els.tbody.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => openOrderDetail(btn.dataset.id));
  });
}

async function openOrderDetail(orderId) {
  currentOrderId = orderId;
  els.detailError.hidden = true;

  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const { data: items, error } = await supabaseClient
    .from('store_order_items')
    .select('*')
    .eq('order_id', orderId);

  if (error) {
    alert('Failed to load order items: ' + error.message);
    return;
  }

  els.detailCustomer.textContent = order.customer_name;
  els.detailContact.textContent = `${order.customer_email} · ${order.customer_phone}`;
  els.detailAddress.textContent = formatAddress(order.shipping_address);

  els.detailItemsTbody.innerHTML = (items || []).map(it => `
    <tr>
      <td>${escapeHtml(it.product_name)}</td>
      <td>${it.quantity}</td>
      <td>₹${Number(it.unit_price_inr).toFixed(2)}</td>
      <td>₹${Number(it.line_total_inr).toFixed(2)}</td>
    </tr>
  `).join('');

  els.detailSubtotal.textContent = `₹${Number(order.subtotal_inr).toFixed(2)}`;
  els.detailShipping.textContent = `₹${Number(order.shipping_inr).toFixed(2)}`;
  els.detailTotal.textContent = `₹${Number(order.total_inr).toFixed(2)}`;

  els.detailPayment.textContent = order.cashfree_order_id
    ? `Cashfree order ${order.cashfree_order_id}${order.cashfree_payment_id ? ` · payment ${order.cashfree_payment_id}` : ''}${order.paid_at ? ` · paid ${formatDate(order.paid_at)}` : ''}`
    : 'No payment recorded yet.';

  els.detailStatus.value = order.status;
  els.detailCarrier.value = order.tracking_carrier || '';
  els.detailTracking.value = order.tracking_number || '';
  els.detailNotes.value = order.admin_notes || '';

  show(els.modal);
  openModalWithBackSupport(closeModal);
}

function closeModal() {
  currentOrderId = null;
  hide(els.modal);
}

async function handleSaveOrder() {
  if (!currentOrderId) return;
  els.detailError.hidden = true;
  els.saveOrderBtn.disabled = true;
  els.saveOrderBtn.textContent = 'Saving…';

  const patch = {
    status: els.detailStatus.value,
    tracking_carrier: els.detailCarrier.value.trim() || null,
    tracking_number: els.detailTracking.value.trim() || null,
    admin_notes: els.detailNotes.value.trim() || null,
  };
  // If moving to "paid" and paid_at isn't set yet, stamp it.
  const order = allOrders.find(o => o.id === currentOrderId);
  if (patch.status === 'paid' && order && !order.paid_at) {
    patch.paid_at = new Date().toISOString();
  }

  const { error } = await supabaseClient
    .from('store_orders')
    .update(patch)
    .eq('id', currentOrderId);

  els.saveOrderBtn.disabled = false;
  els.saveOrderBtn.textContent = 'Save changes';

  if (error) {
    els.detailError.textContent = 'Save failed: ' + error.message;
    els.detailError.hidden = false;
    return;
  }

  const idx = allOrders.findIndex(o => o.id === currentOrderId);
  if (idx !== -1) allOrders[idx] = { ...allOrders[idx], ...patch };

  requestCloseModal();
  renderTable();
}

function formatAddress(addr) {
  if (!addr) return '—';
  const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean);
  return parts.join(', ');
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
