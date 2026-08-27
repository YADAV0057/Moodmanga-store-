// ---------- Cart state (persisted in localStorage) ----------
const Cart = {
  key: "mm_cart_v1",
  items: [], // { product_id, name, price, quantity }

  load() {
    try {
      this.items = JSON.parse(localStorage.getItem(this.key)) || [];
    } catch {
      this.items = [];
    }
  },
  save() {
    localStorage.setItem(this.key, JSON.stringify(this.items));
    this.renderBadge();
  },
  add(product) {
    const existing = this.items.find((i) => i.product_id === product.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      this.items.push({
        product_id: product.id,
        name: product.name,
        price: Number(product.price_inr),
        quantity: 1,
      });
    }
    this.save();
  },
  updateQty(productId, delta) {
    const item = this.items.find((i) => i.product_id === productId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      this.items = this.items.filter((i) => i.product_id !== productId);
    }
    this.save();
  },
  total() {
    return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  },
  count() {
    return this.items.reduce((sum, i) => sum + i.quantity, 0);
  },
  renderBadge() {
    document.getElementById("cartCount").textContent = this.count();
  },
};

Cart.load();
Cart.renderBadge();

// ---------- Product loading ----------
let PRODUCTS = [];

async function loadProducts() {
  const grid = document.getElementById("productGrid");
  const { data, error } = await supabaseClient
    .from("store_products")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    grid.innerHTML = `<div class="empty-state">Couldn't load products. ${error.message}</div>`;
    console.error(error);
    return;
  }

  PRODUCTS = data;

  if (!data.length) {
    grid.innerHTML = `<div class="empty-state">No products yet — check back soon.</div>`;
    return;
  }

  grid.innerHTML = data
    .map(
      (p) => `
    <div class="product-card" data-id="${p.id}">
      ${p.stock_qty <= 5 && p.stock_qty > 0 ? '<div class="badge">LOW STOCK</div>' : ""}
      ${p.stock_qty === 0 ? '<div class="badge">SOLD OUT</div>' : ""}
      <div class="img-wrap">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" />` : (p.mood_tag || p.category).toUpperCase()}
      </div>
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="price">₹${Number(p.price_inr).toLocaleString("en-IN")}</div>
      </div>
    </div>
  `,
    )
    .join("");

  grid.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", () => openProductModal(card.dataset.id));
  });
}

function openProductModal(productId) {
  const p = PRODUCTS.find((x) => x.id === productId);
  if (!p) return;
  const body = document.getElementById("modalBody");
  body.innerHTML = `
    <div class="img-wrap">${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" />` : (p.mood_tag || p.category).toUpperCase()}</div>
    <h2>${p.name}</h2>
    <div class="price">₹${Number(p.price_inr).toLocaleString("en-IN")}</div>
    <div class="desc">${p.description || ""}</div>
    <button class="btn btn-primary" id="addToCartBtn" ${p.stock_qty === 0 ? "disabled" : ""}>
      ${p.stock_qty === 0 ? "SOLD OUT" : "ADD TO CART"}
    </button>
  `;
  document.getElementById("productModal").classList.add("open");
  document.getElementById("addToCartBtn")?.addEventListener("click", () => {
    Cart.add(p);
    document.getElementById("productModal").classList.remove("open");
  });
}

document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("productModal").classList.remove("open");
});

// ---------- Cart drawer ----------
function renderCartDrawer() {
  const itemsEl = document.getElementById("cartItems");
  if (!Cart.items.length) {
    itemsEl.innerHTML = `<div class="empty-state">Your cart is empty.</div>`;
  } else {
    itemsEl.innerHTML = Cart.items
      .map(
        (i) => `
      <div class="cart-item">
        <div>
          <div>${i.name}</div>
          <div class="qty-controls">
            <button data-id="${i.product_id}" data-delta="-1">−</button>
            <span>${i.quantity}</span>
            <button data-id="${i.product_id}" data-delta="1">+</button>
          </div>
        </div>
        <div>₹${(i.price * i.quantity).toLocaleString("en-IN")}</div>
      </div>
    `,
      )
      .join("");

    itemsEl.querySelectorAll("button[data-delta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Cart.updateQty(btn.dataset.id, Number(btn.dataset.delta));
        renderCartDrawer();
      });
    });
  }
  document.getElementById("cartTotal").textContent = `₹${Cart.total().toLocaleString("en-IN")}`;
}

function toggleCart(open) {
  document.getElementById("cartDrawer").classList.toggle("open", open);
  document.getElementById("backdrop").classList.toggle("open", open);
  if (open) renderCartDrawer();
}

document.getElementById("cartToggle").addEventListener("click", () => toggleCart(true));
document.getElementById("closeCart").addEventListener("click", () => toggleCart(false));
document.getElementById("backdrop").addEventListener("click", () => toggleCart(false));

loadProducts();
