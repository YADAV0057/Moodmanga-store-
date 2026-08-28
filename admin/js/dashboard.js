// admin/js/dashboard.js
// Revenue summary, low-stock alerts, recent orders.
// Relies on supabaseClient (admin-config.js) and a session guaranteed by auth-guard.js.

const LOW_STOCK_THRESHOLD = 5;
// Orders counted as "revenue" — i.e. payment has actually gone through.
const REVENUE_STATUSES = ['paid', 'processing', 'shipped', 'delivered'];
// Orders that still need admin action to move forward.
const PENDING_STATUSES = ['paid', 'processing'];

const els = {
  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorState'),
  body: document.getElementById('dashboardBody'),
  logoutBtn: document.getElementById('logoutBtn'),

  statRevenue: document.getElementById('statRevenue'),
  statOrderCount: document.getElementById('statOrderCount'),
  statPending: document.getElementById('statPending'),
  statLowStock: document.getElementById('statLowStock'),
  lowStockCard: document.getElementById('lowStockCard'),

  recentOrdersEmpty: document.getElementById('recentOrdersEmpty'),
  recentOrdersTable: document.getElementById('recentOrdersTable'),
  recentOrdersTbody: document.getElementById('recentOrdersTbody'),

  lowStockEmpty: document.getElementById('lowStockEmpty'),
  lowStockTable: document.getElementById('lowStockTable'),
  lowStockTbody: document.getElementById('lowStockTbody'),
};

init();

async function init() {
  els.logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });

  await loadDashboard();
}

async function loadDashboard() {
  show(els.loading);
  hide(els.error, els.body);

  try {
    const [ordersRes, productsRes] = await Promise.all([
      supabaseClient.from('store_orders').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('store_products').select('*').eq('is_active', true),
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (productsRes.error) throw productsRes.error;

    renderStats(ordersRes.data || [], productsRes.data || []);
    renderRecentOrders((ordersRes.data || []).slice(0, 5));
    renderLowStock((productsRes.data || []).filter(p => p.stock_qty <= LOW_STOCK_THRESHOLD));

    hide(els.loading);
    show(els.body);
  } catch (err) {
    hide(els.loading);
    els.error.textContent = 'Failed to load dashboard: ' + err.message;
    show(els.error);
  }
}

function renderStats(orders, activeProducts) {
  const revenue = orders
    .filter(o => REVENUE_STATUSES.includes(o.status))
    .reduce((sum, o) => sum + Number(o.total_inr), 0);

  const pendingCount = orders.filter(o => PENDING_STATUSES.includes(o.status)).length;
  const lowStockCount = activeProducts.filter(p => p.stock_qty <= LOW_STOCK_THRESHOLD).length;

  els.statRevenue.textContent = `₹${revenue.toFixed(2)}`;
  els.statOrderCount.textContent = orders.length;
  els.statPending.textContent = pendingCount;
  els.statLowStock.textContent = lowStockCount;
  els.lowStockCard.classList.toggle('admin-stat-card-warning', lowStockCount > 0);
}

function renderRecentOrders(orders) {
  if (orders.length === 0) {
    hide(els.recentOrdersTable);
    show(els.recentOrdersEmpty);
    return;
  }
  hide(els.recentOrdersEmpty);
  show(els.recentOrdersTable);

  els.recentOrdersTbody.innerHTML = orders.map(o => `
    <tr>
      <td><span class="admin-order-id">#${o.id.slice(0, 8)}</span></td>
      <td>${escapeHtml(o.customer_name)}</td>
      <td>${formatDate(o.created_at)}</td>
      <td>₹${Number(o.total_inr).toFixed(2)}</td>
      <td><span class="admin-status-badge admin-status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
    </tr>
  `).join('');
}

function renderLowStock(products) {
  if (products.length === 0) {
    hide(els.lowStockTable);
    show(els.lowStockEmpty);
    return;
  }
  hide(els.lowStockEmpty);
  show(els.lowStockTable);

  els.lowStockTbody.innerHTML = products
    .sort((a, b) => a.stock_qty - b.stock_qty)
    .map(p => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td class="${p.stock_qty === 0 ? 'admin-stock-zero' : 'admin-stock-low'}">${p.stock_qty}</td>
      </tr>
    `).join('');
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
