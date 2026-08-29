// ---------- Cart state (persisted in localStorage) ----------
// Each cart line is keyed by product + chosen size + chosen color, so
// "Tee, size M, Indigo" and "Tee, size L, Indigo" are separate lines.
const Cart = {
  key: "mm_cart_v2",
  items: [], // { product_id, name, price, quantity, size, color }

  lineKey(productId, size, color) {
    return `${productId}|${size || ""}|${color || ""}`;
  },
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
  add(product, { size = "", color = "", qty = 1 } = {}) {
    const lk = this.lineKey(product.id, size, color);
    const existing = this.items.find((i) => this.lineKey(i.product_id, i.size, i.color) === lk);
    if (existing) {
      existing.quantity += qty;
    } else {
      this.items.push({
        product_id: product.id,
        name: product.name,
        price: Number(product.price_inr),
        quantity: qty,
        size,
        color,
      });
    }
    this.save();
  },
  updateQty(productId, size, color, delta) {
    const lk = this.lineKey(productId, size, color);
    const item = this.items.find((i) => this.lineKey(i.product_id, i.size, i.color) === lk);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      this.items = this.items.filter((i) => this.lineKey(i.product_id, i.size, i.color) !== lk);
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
    const el = document.getElementById("cartCount");
    if (el) el.textContent = this.count();
  },
};

Cart.load();
Cart.renderBadge();

// ---------- Wishlist state (persisted in localStorage) ----------
const Wishlist = {
  key: "mm_wishlist_v1",
  ids: [],
  load() {
    try {
      this.ids = JSON.parse(localStorage.getItem(this.key)) || [];
    } catch {
      this.ids = [];
    }
  },
  save() {
    localStorage.setItem(this.key, JSON.stringify(this.ids));
    this.renderBadge();
  },
  has(id) {
    return this.ids.includes(id);
  },
  toggle(id) {
    this.ids = this.has(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id];
    this.save();
  },
  renderBadge() {
    const el = document.getElementById("wishlistCount");
    if (el) el.textContent = this.ids.length;
  },
};

Wishlist.load();
Wishlist.renderBadge();

let showWishlistOnly = false;

// ---------- Product state ----------
let PRODUCTS = [];
const RATINGS = new Map(); // product_id -> { avg, count }

const FILTERS = { search: "", category: "all", size: "all", sort: "newest" };

function starString(avg) {
  const rounded = Math.round(avg);
  return "★".repeat(rounded) + "☆".repeat(5 - rounded);
}

async function loadRatingsSummary() {
  const { data, error } = await supabaseClient.from("store_reviews").select("product_id, rating").eq("is_approved", true);
  if (error) {
    console.error(error);
    return;
  }
  const sums = new Map();
  (data || []).forEach((r) => {
    const cur = sums.get(r.product_id) || { total: 0, count: 0 };
    cur.total += r.rating;
    cur.count += 1;
    sums.set(r.product_id, cur);
  });
  sums.forEach((v, k) => RATINGS.set(k, { avg: v.total / v.count, count: v.count }));
}

async function loadProducts() {
  const grid = document.getElementById("productGrid");
  const { data, error } = await supabaseClient
    .from("store_products")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (grid) grid.innerHTML = `<div class="empty-state">Couldn't load products. ${error.message}</div>`;
    console.error(error);
    return;
  }

  PRODUCTS = data || [];
  await loadRatingsSummary();
  if (grid) {
    populateFilterOptions();
    renderGrid();
  }
}

function populateFilterOptions() {
  const categorySelect = document.getElementById("categoryFilter");
  const sizeSelect = document.getElementById("sizeFilter");

  const categories = [...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))].sort();
  categorySelect.innerHTML =
    `<option value="all">All categories</option>` +
    categories.map((c) => `<option value="${c}">${c[0].toUpperCase()}${c.slice(1)}</option>`).join("");

  const sizes = [...new Set(PRODUCTS.flatMap((p) => p.sizes || []))];
  sizeSelect.innerHTML =
    `<option value="all">All sizes</option>` + sizes.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function getFilteredProducts() {
  let list = PRODUCTS.filter((p) => {
    if (showWishlistOnly && !Wishlist.has(p.id)) return false;
    if (FILTERS.category !== "all" && p.category !== FILTERS.category) return false;
    if (FILTERS.size !== "all" && !(p.sizes || []).includes(FILTERS.size)) return false;
    if (FILTERS.search) {
      const haystack = `${p.name} ${p.description || ""} ${p.mood_tag || ""} ${p.category}`.toLowerCase();
      if (!haystack.includes(FILTERS.search.toLowerCase())) return false;
    }
    return true;
  });

  if (FILTERS.sort === "price-asc") list = [...list].sort((a, b) => a.price_inr - b.price_inr);
  else if (FILTERS.sort === "price-desc") list = [...list].sort((a, b) => b.price_inr - a.price_inr);
  else if (FILTERS.sort === "rating-desc")
    list = [...list].sort((a, b) => (RATINGS.get(b.id)?.avg || 0) - (RATINGS.get(a.id)?.avg || 0));
  // "newest" keeps the query's created_at desc order

  return list;
}

function productCardHTML(p) {
  const rating = RATINGS.get(p.id);
  // Cards are real links to the crawlable static page (product/<slug>.html)
  // so search engines and shared links land on a real URL. The modal is
  // still used for the fast in-store "Quick view" flow via the button below.
  const href = p.slug ? `product/${p.slug}.html` : "#";
  return `
    <a class="product-card" data-id="${p.id}" data-slug="${p.slug || ""}" href="${href}">
      <button class="heart-btn ${Wishlist.has(p.id) ? "active" : ""}" data-wishlist-id="${p.id}" title="Save for later">♥</button>
      ${p.stock_qty <= 5 && p.stock_qty > 0 ? '<div class="badge">LOW STOCK</div>' : ""}
      ${p.stock_qty === 0 ? '<div class="badge">SOLD OUT</div>' : ""}
      <div class="img-wrap">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" />` : (p.mood_tag || p.category).toUpperCase()}
      </div>
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="price">₹${Number(p.price_inr).toLocaleString("en-IN")}</div>
        ${rating ? `<div class="stars" title="${rating.avg.toFixed(1)} / 5">${starString(rating.avg)} <span class="stars-count">(${rating.count})</span></div>` : ""}
        <button class="quick-view-btn" type="button" data-quickview-id="${p.id}">Quick view</button>
      </div>
    </a>
  `;
}

function renderGrid() {
  const grid = document.getElementById("productGrid");
  const list = getFilteredProducts();

  if (!PRODUCTS.length) {
    grid.innerHTML = `<div class="empty-state">No products yet — check back soon.</div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">Nothing matches those filters — try clearing one.</div>`;
    return;
  }

  grid.innerHTML = list.map(productCardHTML).join("");

  // Cards are <a> tags now (real navigation to product/<slug>.html), so
  // the heart button and quick-view button must stop the click from
  // bubbling into the link's default navigation.
  grid.querySelectorAll(".heart-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Wishlist.toggle(btn.dataset.wishlistId);
      renderGrid();
    });
  });
  grid.querySelectorAll(".quick-view-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openProductModal(btn.dataset.quickviewId);
    });
  });
}

// ---------- Filter/search/sort controls (only present on the store grid page) ----------
document.getElementById("searchInput")?.addEventListener("input", (e) => {
  FILTERS.search = e.target.value;
  renderGrid();
});
document.getElementById("categoryFilter")?.addEventListener("change", (e) => {
  FILTERS.category = e.target.value;
  renderGrid();
});
document.getElementById("sizeFilter")?.addEventListener("change", (e) => {
  FILTERS.size = e.target.value;
  renderGrid();
});
document.getElementById("sortSelect")?.addEventListener("change", (e) => {
  FILTERS.sort = e.target.value;
  renderGrid();
});
document.getElementById("wishlistToggle")?.addEventListener("click", () => {
  showWishlistOnly = !showWishlistOnly;
  document.getElementById("wishlistToggle").classList.toggle("active", showWishlistOnly);
  renderGrid();
});

// ---------- Size guide modal (optional — only wired if present on the page) ----------
document.getElementById("closeSizeGuide")?.addEventListener("click", () => {
  document.getElementById("sizeGuideModal").classList.remove("open");
});
function openSizeGuide(guideType) {
  const sizeGuideModal = document.getElementById("sizeGuideModal");
  if (!sizeGuideModal) return; // page doesn't include the size guide markup
  document.querySelectorAll(".size-guide-table").forEach((t) => {
    t.style.display = t.dataset.guide === guideType ? "table" : "none";
  });
  sizeGuideModal.classList.add("open");
}

// ---------- Product detail (gallery, variants, qty, reviews, related) ----------
// This markup and its wiring are shared between two surfaces:
//   1. openProductModal()   — popup modal used by "Quick view" on the grid page
//   2. renderProductDetail() — rendered inline as the main content of a
//      standalone product/<slug>.html page, so there is exactly ONE place
//      to actually choose a size and add to bag (no dead-end static page).
let modalState = { productId: null, size: "", color: "", qty: 1 };

function buildProductDetailHTML(p, { includeSizeGuide = true } = {}) {
  const images = [p.image_url, ...(p.gallery_urls || [])].filter(Boolean);
  const rating = RATINGS.get(p.id);

  // Per-size stock, e.g. { S: 4, M: 0, L: 6 }. A missing key or a
  // non-numeric value is treated as "stock unknown" (still selectable).
  const sizeStock = p.size_stock || {};
  const hasSizes = (p.sizes || []).length > 0;
  const allSizesSoldOut = hasSizes && p.sizes.every((s) => sizeStock[s] === 0);
  const outOfStock = p.stock_qty === 0 || allSizesSoldOut;

  return `
    <div class="gallery">
      <div class="img-wrap gallery-main" id="galleryMain">
        ${images[0] ? `<img src="${images[0]}" alt="${p.name}" />` : (p.mood_tag || p.category).toUpperCase()}
      </div>
      ${
        images.length > 1
          ? `<div class="gallery-thumbs">${images
              .map((src, i) => `<button class="thumb ${i === 0 ? "active" : ""}" data-src="${src}"><img src="${src}" alt="" /></button>`)
              .join("")}</div>`
          : ""
      }
    </div>
    <h2>${p.name}</h2>
    <div class="price">₹${Number(p.price_inr).toLocaleString("en-IN")}</div>
    ${
      rating
        ? `<div class="stars" title="${rating.avg.toFixed(1)} / 5">${starString(rating.avg)} <span class="stars-count">${rating.avg.toFixed(1)} (${rating.count} review${rating.count === 1 ? "" : "s"})</span></div>`
        : `<div class="stars stars-empty">No reviews yet</div>`
    }
    <div class="desc">${p.description || ""}</div>

    ${
      hasSizes
        ? `<div class="variant-row">
             <div class="variant-label">Size ${includeSizeGuide ? `<button class="size-guide-link" id="sizeGuideBtn" type="button">Size guide</button>` : ""}</div>
             <div class="size-options">${p.sizes
               .map((s) => {
                 const stock = sizeStock[s];
                 const soldOut = stock === 0;
                 const lowStock = typeof stock === "number" && stock > 0 && stock <= 2;
                 const title = soldOut ? "Out of stock" : lowStock ? `Only ${stock} left` : "";
                 return `<button
                   class="size-btn${soldOut ? " sold-out" : ""}${lowStock ? " low-stock" : ""}"
                   data-size="${s}"
                   ${soldOut ? "disabled" : ""}
                   ${title ? `title="${title}"` : ""}
                   style="${soldOut ? "text-decoration:line-through;opacity:.4;cursor:not-allowed;" : ""}"
                 >${s}</button>`;
               })
               .join("")}</div>
             ${allSizesSoldOut ? `<div class="size-note" style="color:#9c3d3d;font-size:.85rem;margin-top:4px;">All sizes are currently out of stock.</div>` : p.sizes.some((s) => sizeStock[s] === 0) ? `<div class="size-note" style="color:#7a7168;font-size:.8rem;margin-top:4px;">Crossed-out sizes are out of stock.</div>` : ""}
           </div>`
        : ""
    }
    ${
      (p.colors || []).length
        ? `<div class="variant-row">
             <div class="variant-label">Color</div>
             <div class="color-options">${p.colors
               .map((c) => `<button class="swatch" data-color="${c.name}" style="background:${c.hex}" title="${c.name}"></button>`)
               .join("")}</div>
           </div>`
        : ""
    }

    <div class="variant-row">
      <div class="variant-label">Quantity</div>
      <div class="qty-stepper">
        <button type="button" id="qtyMinus">−</button>
        <span id="qtyValue">1</span>
        <button type="button" id="qtyPlus">+</button>
      </div>
    </div>

    <button class="btn btn-primary" id="addToCartBtn" ${outOfStock ? "disabled" : ""}>
      ${outOfStock ? "SOLD OUT" : "ADD TO BAG"}
    </button>
    <div class="add-to-cart-confirm" id="addToCartConfirm" style="display:none;color:#2f6b2f;font-size:.9rem;margin-top:8px;">Added to your bag ✓</div>

    <div class="related-strip" id="relatedStrip"></div>

    <div class="reviews-section">
      <h3>Reviews</h3>
      <div id="reviewsList" class="reviews-list"><div class="empty-state">Loading reviews…</div></div>
      <form class="review-form" id="reviewForm">
        <div class="variant-label">Leave a review</div>
        <input type="text" name="customer_name" placeholder="Your name" required maxlength="80" />
        <select name="rating" required>
          <option value="">Rating</option>
          <option value="5">★★★★★ Excellent</option>
          <option value="4">★★★★☆ Good</option>
          <option value="3">★★★☆☆ Okay</option>
          <option value="2">★★☆☆☆ Not great</option>
          <option value="1">★☆☆☆☆ Poor</option>
        </select>
        <textarea name="comment" placeholder="What did you think of the fit and fabric?" maxlength="1500" rows="3"></textarea>
        <button type="submit" class="btn btn-dark">SUBMIT REVIEW</button>
      </form>
    </div>
  `;
}

async function openProductModal(productKey) {
  // productKey can be either the product's id (used by the in-grid quick
  // view button and related-products strip) or its slug.
  const p = PRODUCTS.find((x) => x.id === productKey || x.slug === productKey);
  if (!p) return;
  modalState = { productId: p.id, size: "", color: "", qty: 1 };

  const body = document.getElementById("modalBody");
  if (!body) return; // this page doesn't have the popup modal at all
  body.innerHTML = buildProductDetailHTML(p);

  document.getElementById("productModal").classList.add("open");
  wireProductDetail(p, body, { isModal: true });
  renderRelatedProducts(p, { navigate: false });
  loadReviews(p.id);
}

// Renders the full interactive product experience (gallery, size picker,
// qty, add-to-bag, reviews) directly into the page — used by standalone
// product/<slug>.html pages so there is exactly one place to order,
// instead of a dead-end static page pointing at a separate popup.
async function renderProductDetail(productKey, containerEl) {
  const p = PRODUCTS.find((x) => x.id === productKey || x.slug === productKey);
  if (!p) {
    containerEl.innerHTML = `<div class="empty-state">Sorry, we couldn't find that product. <a href="../index.html">Browse the store</a></div>`;
    return;
  }
  modalState = { productId: p.id, size: "", color: "", qty: 1 };
  containerEl.innerHTML = buildProductDetailHTML(p, { includeSizeGuide: false });
  wireProductDetail(p, containerEl, { isModal: false });
  renderRelatedProducts(p, { navigate: true });
  loadReviews(p.id);
}

function wireProductDetail(p, containerEl, { isModal } = { isModal: true }) {
  if (isModal) {
    document.getElementById("closeModal")?.addEventListener("click", () => {
      document.getElementById("productModal").classList.remove("open");
    });
  }

  containerEl.querySelectorAll(".gallery-thumbs .thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      containerEl.querySelectorAll(".gallery-thumbs .thumb").forEach((t) => t.classList.remove("active"));
      thumb.classList.add("active");
      containerEl.querySelector("#galleryMain").innerHTML = `<img src="${thumb.dataset.src}" alt="${p.name}" />`;
    });
  });

  containerEl.querySelectorAll(".size-btn").forEach((btn) => {
    if (btn.disabled) return; // sold-out sizes aren't selectable
    btn.addEventListener("click", () => {
      containerEl.querySelectorAll(".size-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      modalState.size = btn.dataset.size;

      // Cap the current quantity to what's actually in stock for this size.
      const stockForSize = (p.size_stock || {})[btn.dataset.size];
      const maxQty = typeof stockForSize === "number" ? stockForSize : p.stock_qty || 99;
      modalState.qty = Math.min(modalState.qty, Math.max(1, maxQty));
      const qtyValueEl = containerEl.querySelector("#qtyValue");
      if (qtyValueEl) qtyValueEl.textContent = modalState.qty;
    });
  });

  containerEl.querySelectorAll(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      containerEl.querySelectorAll(".swatch").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      modalState.color = btn.dataset.color;
    });
  });

  const sizeGuideBtn = containerEl.querySelector("#sizeGuideBtn");
  if (sizeGuideBtn) sizeGuideBtn.addEventListener("click", () => openSizeGuide(p.size_guide || "tops"));

  const qtyValue = containerEl.querySelector("#qtyValue");
  containerEl.querySelector("#qtyMinus")?.addEventListener("click", () => {
    modalState.qty = Math.max(1, modalState.qty - 1);
    qtyValue.textContent = modalState.qty;
  });
  containerEl.querySelector("#qtyPlus")?.addEventListener("click", () => {
    const stockForSize = (p.size_stock || {})[modalState.size];
    const maxQty = typeof stockForSize === "number" ? stockForSize : p.stock_qty || 99;
    modalState.qty = Math.min(maxQty || 1, modalState.qty + 1);
    qtyValue.textContent = modalState.qty;
  });

  containerEl.querySelector("#addToCartBtn")?.addEventListener("click", () => {
    if ((p.sizes || []).length && !modalState.size) {
      alert("Pick a size first.");
      return;
    }
    Cart.add(p, { size: modalState.size, color: modalState.color, qty: modalState.qty });

    if (isModal) {
      document.getElementById("productModal").classList.remove("open");
    } else {
      // No modal to close on a standalone product page — show inline
      // confirmation and pop the cart drawer open instead.
      const confirmEl = containerEl.querySelector("#addToCartConfirm");
      if (confirmEl) {
        confirmEl.style.display = "block";
        setTimeout(() => (confirmEl.style.display = "none"), 3000);
      }
      toggleCart(true);
    }
  });
}

function renderRelatedProducts(p, { navigate = false } = {}) {
  const related = PRODUCTS.filter(
    (x) => x.id !== p.id && (x.category === p.category || x.mood_tag === p.mood_tag),
  ).slice(0, 4);
  const el = document.getElementById("relatedStrip");
  if (!el) return;
  if (!related.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<div class="variant-label">You may also like</div><div class="related-grid">` +
    related
      .map(
        (r) => `
      <div class="related-card" data-id="${r.id}" data-slug="${r.slug || ""}">
        <div class="img-wrap">${r.image_url ? `<img src="${r.image_url}" alt="${r.name}" />` : (r.mood_tag || r.category).toUpperCase()}</div>
        <div class="name">${r.name}</div>
        <div class="price">₹${Number(r.price_inr).toLocaleString("en-IN")}</div>
      </div>`,
      )
      .join("") +
    `</div>`;
  el.querySelectorAll(".related-card").forEach((card) => {
    card.addEventListener("click", () => {
      // On a standalone product page, navigate to the related product's
      // own crawlable page instead of stacking a popup on top of it.
      if (navigate && card.dataset.slug) {
        window.location.href = `../product/${card.dataset.slug}.html`;
      } else {
        openProductModal(card.dataset.id);
      }
    });
  });
}

// ---------- Reviews ----------
async function loadReviews(productId) {
  const listEl = document.getElementById("reviewsList");
  const { data, error } = await supabaseClient
    .from("store_reviews")
    .select("customer_name, rating, comment, created_at")
    .eq("product_id", productId)
    .eq("is_approved", true)
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<div class="empty-state">Couldn't load reviews.</div>`;
    console.error(error);
    return;
  }
  if (!data.length) {
    listEl.innerHTML = `<div class="empty-state">No reviews yet — be the first.</div>`;
    return;
  }
  listEl.innerHTML = data
    .map(
      (r) => `
    <div class="review">
      <div class="review-head"><span class="stars">${starString(r.rating)}</span><span class="review-name">${r.customer_name}</span></div>
      ${r.comment ? `<div class="review-comment">${r.comment}</div>` : ""}
    </div>`,
    )
    .join("");
}

// Delegated on `document` (not the modal) so this works whether the review
// form is rendered inside the popup modal or inline on a standalone
// product page.
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "reviewForm") return;
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "SUBMITTING…";

  const fd = new FormData(form);
  const { error } = await supabaseClient.from("store_reviews").insert({
    product_id: modalState.productId,
    customer_name: fd.get("customer_name"),
    rating: Number(fd.get("rating")),
    comment: fd.get("comment") || null,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "SUBMIT REVIEW";

  if (error) {
    alert("Couldn't submit your review: " + error.message);
    return;
  }
  form.reset();
  await loadRatingsSummary();
  loadReviews(modalState.productId);
});

// ---------- Cart drawer ----------
function renderCartDrawer() {
  const itemsEl = document.getElementById("cartItems");
  if (!itemsEl) return;
  if (!Cart.items.length) {
    itemsEl.innerHTML = `<div class="empty-state">Your bag is empty.</div>`;
  } else {
    itemsEl.innerHTML = Cart.items
      .map((i) => {
        const variantLabel = [i.size, i.color].filter(Boolean).join(" / ");
        return `
      <div class="cart-item">
        <div>
          <div>${i.name}${variantLabel ? `<span class="cart-item-variant"> — ${variantLabel}</span>` : ""}</div>
          <div class="qty-controls">
            <button data-id="${i.product_id}" data-size="${i.size}" data-color="${i.color}" data-delta="-1">−</button>
            <span>${i.quantity}</span>
            <button data-id="${i.product_id}" data-size="${i.size}" data-color="${i.color}" data-delta="1">+</button>
          </div>
        </div>
        <div>₹${(i.price * i.quantity).toLocaleString("en-IN")}</div>
      </div>
    `;
      })
      .join("");

    itemsEl.querySelectorAll("button[data-delta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Cart.updateQty(btn.dataset.id, btn.dataset.size, btn.dataset.color, Number(btn.dataset.delta));
        renderCartDrawer();
      });
    });
  }
  const totalEl = document.getElementById("cartTotal");
  if (totalEl) totalEl.textContent = `₹${Cart.total().toLocaleString("en-IN")}`;
}

function toggleCart(open) {
  const drawer = document.getElementById("cartDrawer");
  const backdrop = document.getElementById("backdrop");
  if (!drawer) return;
  drawer.classList.toggle("open", open);
  backdrop?.classList.toggle("open", open);
  if (open) renderCartDrawer();
}

document.getElementById("cartToggle")?.addEventListener("click", () => toggleCart(true));
document.getElementById("closeCart")?.addEventListener("click", () => toggleCart(false));
document.getElementById("backdrop")?.addEventListener("click", () => toggleCart(false));

// Expose the load promise so standalone product/<slug>.html pages can wait
// for PRODUCTS to be populated before rendering — avoids a race where the
// page's render call fires before data arrives.
window.productsReady = loadProducts();

window.productsReady.then(() => {
  // Standalone product page: render the full interactive product view
  // (gallery, sizes, qty, add-to-bag, reviews) directly into the page —
  // this is the ONE place to order, not a redirect to a popup elsewhere.
  const detailEl = document.getElementById("productDetail");
  if (detailEl && detailEl.dataset.slug) {
    renderProductDetail(detailEl.dataset.slug, detailEl);
    return;
  }

  // Grid page: allow deep-linking a quick-view modal via ?product=slug.
  const params = new URLSearchParams(window.location.search);
  const productKey = params.get("product");
  if (productKey) openProductModal(productKey);
});


