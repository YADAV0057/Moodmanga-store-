// admin/js/customers.js
// Phase 6: read-only customer list derived from store_orders.
// No customers table — grouped client-side by customer_email.
// Relies on supabaseClient (admin-config.js) and a session guaranteed by auth-guard.js.

// --- Modal back-button support (inlined, matches orders.js/products.js/settings.js) ---
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

// Same "counts as revenue" definition dashboard.js uses.
const REVENUE_STATUSES = ['paid', 'processing', 'shipped', 'delivered'];

let allOrders = [];
let customers = [];   // [{ email, name, phone, address, orders: [...], orderCount, totalSpent, lastOrderAt }]

const els = {
  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorState'),
  empty: document.getElementById('emptyState'),
  table: document.getElementById('customersTable'),
  tbody: document.getElementById('customersTbody'),
  search: document.getElementById('searchInput'),
  logoutBtn: document.getElementById('logoutBtn'),

  modal: document.getElementById('customerModal'),
  detailName: document.getElementById('detailName'),
  detailContact: document.getElementById('detailContact'),
  detailAddress: document.getElementById('detailAddress'),
  detailOrdersTbody: document.getElementById('detailOrdersTbody'),
};

init();

async function init() {
  els.search.addEventListener('input', renderTable);
  els.logoutBtn.addEventListener('click', handleLogout);
  await loadCustomers();
}

function handleLogout() {
  supabaseClient.auth.signOut().then(() => { window.location.href = 'login.html'; });
}

async function loadCustomers() {
  show(els.loading);
  hide(els.error, els.empty, els.table);

  const { data, error } = await supabaseClient
    .from('store_orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    hide(els.loading);
    els.error.textContent = 'Failed to load customers: ' + error.message;
    show(els.error);
    return;
  }

  allOrders = data || [];
  customers = groupByCustomer(allOrders);
  hide(els.loading);
  renderTable();
}

function groupByCustomer(orders) {
  const map = new Map();

  for (const o of orders) {
    const key = (o.customer_email || '').toLowerCase() || `noemail:${o.customer_name}`;
    if (!map.has(key)) {
      map.set(key, {
        email: o.customer_email,
        name: o.customer_name,
        phone: o.customer_phone,
        address: o.shipping_address,
        orders: [],
        orderCount: 0,
        totalSpent: 0,
        lastOrderAt: o.created_at,
      });
    }
    const c = map.get(key);
    c.orders.push(o);
    c.orderCount += 1;
    if (REVENUE_STATUSES.includes(o.status)) {
      c.totalSpent += Number(o.total_inr);
    }
    if (new Date(o.created_at) > new Date(c.lastOrderAt)) {
      c.lastOrderAt = o.created_at;
      // Keep contact details fresh — use the most recent order's info.
      c.name = o.customer_name;
      c.phone = o.customer_phone;
      c.address = o.shipping_address;
    }
  }

  return Array.from(map.values()).sort((a, b) => new Date(b.lastOrderAt) - new Date(a.lastOrderAt));
}

function renderTable() {
  const q = els.search.value.trim().toLowerCase();

  const filtered = customers.filter(c => {
    if (!q) return true;
    const haystack = `${c.name || ''} ${c.email || ''}`.toLowerCase();
    return haystack.includes(q);
  });

  if (filtered.length === 0) {
    hide(els.table);
    show(els.empty);
    return;
  }
  hide(els.empty);
  show(els.table);

  els.tbody.innerHTML = filtered.map((c, i) => `
    <tr data-key="${i}">
      <td>
        <div class="admin-product-name">${escapeHtml(c.name || '—')}</div>
        <div class="admin-product-slug">${escapeHtml(c.email || '—')}</div>
      </td>
      <td>${escapeHtml(c.phone || '—')}</td>
      <td>${c.orderCount}</td>
      <td>₹${c.totalSpent.toFixed(2)}</td>
      <td>${formatDate(c.lastOrderAt)}</td>
      <td><button class="btn btn-small" data-action="view" data-key="${i}">View</button></td>
    </tr>
  `).join('');

  els.tbody.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => openCustomerDetail(filtered[Number(btn.dataset.key)]));
  });
}

function openCustomerDetail(c) {
  els.detailName.textContent = c.name || 'Customer';
  els.detailContact.textContent = `${c.email || '—'} · ${c.phone || '—'}`;
  els.detailAddress.textContent = formatAddress(c.address);

  els.detailOrdersTbody.innerHTML = c.orders
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(o => `
      <tr>
        <td><span class="admin-order-id">#${o.id.slice(0, 8)}</span></td>
        <td>${formatDate(o.created_at)}</td>
        <td>₹${Number(o.total_inr).toFixed(2)}</td>
        <td><span class="admin-status-badge admin-status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
      </tr>
    `).join('');

  show(els.modal);
  openModalWithBackSupport(closeModal);
}

function closeModal() {
  hide(els.modal);
}

function formatAddress(addr) {
  if (!addr) return '—';
  const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean);
  return parts.join(', ') || '—';
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
