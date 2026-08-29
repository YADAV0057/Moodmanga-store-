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
    document.querySelectorAll("#cartCount").forEach((el) => {
      el.textContent = this.count();
    });
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
    // grid is null on static product/<slug>.html pages (no #productGrid
    // there) — guard so this doesn't throw and silently reject
    // window.productsReady, which would stop initStaticProductPage()
    // from ever running.
    if (grid) grid.innerHTML = `<div class="empty-state">Couldn't load products. ${error.message}</div>`;
    console.error(error);
    return;
  }

  PRODUCTS = data || [];
  await loadRatingsSummary();
  populateFilterOptions();
  renderGrid();
}

function populateFilterOptions() {
  const categorySelect = document.getElementById("categoryFilter");
  const sizeSelect = document.getElementById("sizeFilter");
  // Static product/<slug>.html pages don't render the filter/sort
  // controls, so bail out here — otherwise this throws and the promise
  // from loadProducts() rejects, which silently skips
  // initStaticProductPage() and leaves the pre-JS fallback HTML stuck
  // on screen forever.
  if (!categorySelect || !sizeSelect) return;

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
  // Homepage-only element — static product/<slug>.html pages don't render
  // a grid, so bail out here instead of throwing on grid.innerHTML below.
  // (See populateFilterOptions() above for the same pattern/reasoning.)
  if (!grid) return;
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

// ---------- Filter/search/sort controls ----------
// These controls (and the grid itself) only exist on the homepage —
// the static product/<slug>.html pages don't render them, so every
// lookup here is guarded rather than assumed to exist. Without these
// guards, main.js would throw on the product pages and silently abort
// before ever reaching the code that renders the product detail below.
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

// ---------- Size guide modal ----------
// Also homepage/modal-only — static product pages don't ship a size
// guide modal, so openSizeGuide() no-ops gracefully if it's absent.
document.getElementById("closeSizeGuide")?.addEventListener("click", () => {
  document.getElementById("sizeGuideModal").classList.remove("open");
});
function openSizeGuide(guideType) {
  const modal = document.getElementById("sizeGuideModal");
  if (!modal) return;
  document.querySelectorAll(".size-guide-table").forEach((t) => {
    t.style.display = t.dataset.guide === guideType ? "table" : "none";
  });
  modal.classList.add("open");
}

// ---------- Product modal (gallery, variants, qty, reviews, related) ----------
let modalState = { productId: null, size: "", color: "", qty: 1 };

function buildProductDetailHTML(p, images, rating) {
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
      (p.sizes || []).length
        ? `<div class="variant-row">
             <div class="variant-label">Size <button class="size-guide-link" id="sizeGuideBtn" type="button">Size guide</button></div>
             <div class="size-options">${p.sizes.map((s) => `<button class="size-btn" data-size="${s}">${s}</button>`).join("")}</div>
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

    <button class="btn btn-primary" id="addToCartBtn" ${p.stock_qty === 0 ? "disabled" : ""}>
      ${p.stock_qty === 0 ? "SOLD OUT" : "ADD TO BAG"}
    </button>
    ${
      p.stock_qty === 0
        ? ""
        : `<button class="btn btn-dark" id="buyNowBtn" style="width:100%;margin-top:8px;">BUY NOW</button>`
    }

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

// Renders a product's full interactive detail (gallery, variants, qty,
// add-to-bag, related products, reviews) into any container — the
// in-page modal on the homepage, or the #productDetail slot on a
// static product/<slug>.html page.
function renderProductInto(container, p) {
  modalState = { productId: p.id, size: "", color: "", qty: 1 };
  const images = [p.image_url, ...(p.gallery_urls || [])].filter(Boolean);
  const rating = RATINGS.get(p.id);

  container.innerHTML = buildProductDetailHTML(p, images, rating);

  wireProductModal(p, images);
  renderRelatedProducts(p);
  loadReviews(p.id);
}

async function openProductModal(productKey) {
  // productKey can be either the product's id (used by the in-grid quick
  // view button and related-products strip) or its slug (used by the
  // static product/<slug>.html pages, which don't know the DB id).
  const p = PRODUCTS.find((x) => x.id === productKey || x.slug === productKey);
  if (!p) return;

  const body = document.getElementById("modalBody");
  renderProductInto(body, p);
  document.getElementById("productModal").classList.add("open");
}

function wireProductModal(p, images) {
  const closeModalBtn = document.getElementById("closeModal");
  if (closeModalBtn) {
    closeModalBtn.onclick = () => {
      document.getElementById("productModal")?.classList.remove("open");
    };
  }
  document.querySelectorAll(".gallery-thumbs .thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      document.querySelectorAll(".gallery-thumbs .thumb").forEach((t) => t.classList.remove("active"));
      thumb.classList.add("active");
      document.getElementById("galleryMain").innerHTML = `<img src="${thumb.dataset.src}" alt="${p.name}" />`;
    });
  });

  document.querySelectorAll(".size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".size-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      modalState.size = btn.dataset.size;
    });
  });

  document.querySelectorAll(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".swatch").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      modalState.color = btn.dataset.color;
    });
  });

  const sizeGuideBtn = document.getElementById("sizeGuideBtn");
  if (sizeGuideBtn) sizeGuideBtn.addEventListener("click", () => openSizeGuide(p.size_guide || "tops"));

  const qtyValue = document.getElementById("qtyValue");
  document.getElementById("qtyMinus").addEventListener("click", () => {
    modalState.qty = Math.max(1, modalState.qty - 1);
    qtyValue.textContent = modalState.qty;
  });
  document.getElementById("qtyPlus").addEventListener("click", () => {
    modalState.qty = Math.min(p.stock_qty || 99, modalState.qty + 1);
    qtyValue.textContent = modalState.qty;
  });

  document.getElementById("addToCartBtn")?.addEventListener("click", () => {
    if ((p.sizes || []).length && !modalState.size) {
      alert("Pick a size first.");
      return;
    }
    Cart.add(p, { size: modalState.size, color: modalState.color, qty: modalState.qty });
    // Only the homepage's quick-view uses a modal to close — the static
    // product/<slug>.html page renders this same markup inline with no
    // #productModal, so this must be guarded or it throws there.
    document.getElementById("productModal")?.classList.remove("open");
  });

  document.getElementById("buyNowBtn")?.addEventListener("click", () => {
    if ((p.sizes || []).length && !modalState.size) {
      alert("Pick a size first.");
      return;
    }
    document.getElementById("productModal")?.classList.remove("open");
    // Bypasses Cart entirely — handed straight to checkout.js's
    // startBuyNow(), which opens the same checkout modal/form scoped to
    // just this one line, and never reads or writes Cart.items.
    window.startBuyNow({
      product_id: p.id,
      name: p.name,
      price: Number(p.price_inr),
      quantity: modalState.qty,
      size: modalState.size,
      color: modalState.color,
    });
  });
}

function renderRelatedProducts(p) {
  const related = PRODUCTS.filter(
    (x) => x.id !== p.id && (x.category === p.category || x.mood_tag === p.mood_tag),
  ).slice(0, 4);
  const el = document.getElementById("relatedStrip");
  if (!related.length) {
    el.innerHTML = "";
    return;
  }
  // Real <a> links to product/<slug>.html — works whether this strip is
  // rendered on the homepage (inside the quick-view modal) or on a static
  // product/<slug>.html page. detailEl's data-slug marks "we're on a
  // static product page", where links must be relative to that folder
  // (bare "<slug>.html") instead of the homepage's "product/<slug>.html".
  const onStaticProductPage = !!document.getElementById("productDetail")?.dataset.slug;
  const hrefFor = (r) => (r.slug ? (onStaticProductPage ? `${r.slug}.html` : `product/${r.slug}.html`) : "#");

  el.innerHTML =
    `<div class="variant-label">You may also like</div><div class="related-grid">` +
    related
      .map(
        (r) => `
      <a class="related-card" data-id="${r.id}" href="${hrefFor(r)}">
        <div class="img-wrap">${r.image_url ? `<img src="${r.image_url}" alt="${r.name}" />` : (r.mood_tag || r.category).toUpperCase()}</div>
        <div class="name">${r.name}</div>
        <div class="price">₹${Number(r.price_inr).toLocaleString("en-IN")}</div>
      </a>`,
      )
      .join("") +
    `</div>`;
  el.querySelectorAll(".related-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // Only the homepage has a #productModal to swap content into — on
      // static pages there's nothing to intercept the click for, so let
      // the <a> navigate normally to the related product's real page.
      if (!document.getElementById("productModal")) return;
      e.preventDefault();
      openProductModal(card.dataset.id);
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
  document.getElementById("cartTotal").textContent = `₹${Cart.total().toLocaleString("en-IN")}`;
}

function toggleCart(open) {
  document.getElementById("cartDrawer").classList.toggle("open", open);
  document.getElementById("backdrop").classList.toggle("open", open);
  if (open) renderCartDrawer();
}

document.getElementById("cartToggle")?.addEventListener("click", () => toggleCart(true));
document.getElementById("closeCart")?.addEventListener("click", () => toggleCart(false));
document.getElementById("backdrop")?.addEventListener("click", () => toggleCart(false));

// ---------- Static product page (product/<slug>.html) ----------
// generate-product-pages.mjs writes a fallback (pre-JS) view into
// #productDetail with a data-slug attribute. Once products are loaded,
// swap that fallback for the same interactive gallery/size/qty/reviews
// experience used in the homepage's quick-view modal, rendered inline.
function initStaticProductPage() {
  const detailEl = document.getElementById("productDetail");
  if (!detailEl) return;
  const slug = detailEl.dataset.slug;
  const p = PRODUCTS.find((x) => x.slug === slug);
  if (!p) return;
  renderProductInto(detailEl, p);
}

// Expose the load promise so static product/<slug>.html pages can wait
// for PRODUCTS to be populated before calling openProductModal — avoids
// a race where the page's auto-open script fires before data arrives.
window.productsReady = loadProducts();

window.productsReady.then(() => {
  initStaticProductPage();

  const params = new URLSearchParams(window.location.search);
  const productKey = params.get("product");
  if (productKey) openProductModal(productKey);
});
