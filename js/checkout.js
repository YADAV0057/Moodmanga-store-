// Requires the Cashfree JS SDK loaded in index.html:
// <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>

// When set (by "Buy Now"), checkout uses this single-item line instead of
// Cart.items, and a successful payment does NOT touch the cart at all —
// whatever was already in the bag stays untouched.
let buyNowItem = null;

function openCheckoutModal(total) {
  document.getElementById("checkoutTotal").textContent = `₹${total.toLocaleString("en-IN")}`;
  toggleCart(false);
  document.getElementById("checkoutModal").classList.add("open");
  resetAddressConfirmation();
}

document.getElementById("checkoutBtn").addEventListener("click", () => {
  if (!Cart.items.length) return;
  buyNowItem = null;
  openCheckoutModal(Cart.total());
});

// Called from main.js's "BUY NOW" button on a product page/modal. `item`
// is a single line shaped like a Cart entry:
// { product_id, name, price, quantity, size, color }.
window.startBuyNow = function (item) {
  buyNowItem = item;
  openCheckoutModal(item.price * item.quantity);
};

document.getElementById("closeCheckout").addEventListener("click", () => {
  document.getElementById("checkoutModal").classList.remove("open");
  buyNowItem = null;
});

// ========== Address Validation & Confirmation ==========
function resetAddressConfirmation() {
  document.getElementById("addressConfirmed").textContent = "";
  document.getElementById("payBtn").disabled = false;
}

document.getElementById("confirmAddressBtn").addEventListener("click", async () => {
  const form = document.getElementById("checkoutForm");
  const name = form.querySelector("input[name='name']").value.trim();
  const phone = form.querySelector("input[name='phone']").value.trim();
  const email = form.querySelector("input[name='email']").value.trim();
  const line1 = form.querySelector("input[name='line1']").value.trim();
  const city = form.querySelector("input[name='city']").value.trim();
  const state = form.querySelector("input[name='state']").value.trim();
  const pincode = form.querySelector("input[name='pincode']").value.trim();

  // Validate required fields
  if (!name || !phone || !email || !line1 || !city || !state || !pincode) {
    alert("Please fill in all address fields before confirming.");
    return;
  }

  // Validate phone format (Indian 10-digit)
  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    alert("Please enter a valid 10-digit Indian phone number (starting with 6-9).");
    return;
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("Please enter a valid email address.");
    return;
  }

  // Validate pincode (6 digits for India)
  const pincodeRegex = /^\d{6}$/;
  if (!pincodeRegex.test(pincode)) {
    alert("Please enter a valid 6-digit pincode.");
    return;
  }

  // Display confirmation
  const confirmBox = document.getElementById("addressConfirmed");
  const addressSummary = `
    <strong>✓ Address Confirmed</strong><br>
    ${name}<br>
    ${phone} · ${email}<br>
    ${line1}<br>
    ${city}, ${state} ${pincode}
  `;
  confirmBox.innerHTML = addressSummary;
  confirmBox.style.display = "block";

  // Allow payment to proceed
  document.getElementById("payBtn").disabled = false;
};

// Auto-format phone number input
document.querySelector("input[name='phone']")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});

// Auto-format pincode input
document.querySelector("input[name='pincode']")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});

document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  // Verify address was confirmed
  const confirmBox = document.getElementById("addressConfirmed");
  if (!confirmBox || !confirmBox.textContent.includes("✓")) {
    alert("Please confirm your address before proceeding to payment.");
    return;
  }

  const payBtn = document.getElementById("payBtn");
  payBtn.disabled = true;
  payBtn.textContent = "PROCESSING…";

  const form = new FormData(e.target);
  const customer = {
    name: form.get("name"),
    email: form.get("email"),
    phone: form.get("phone"),
    address: {
      line1: form.get("line1"),
      city: form.get("city"),
      state: form.get("state"),
      pincode: form.get("pincode"),
    },
  };

  // Buy Now checks out just the one item it was given; a normal checkout
  // still uses whatever's in the bag.
  const items = buyNowItem ? [buyNowItem] : Cart.items;

  try {
    // 1. Ask our edge function to create a Cashfree order (server-side, trusted prices).
    // Size/color are carried along per line so fulfillment knows what to pack —
    // they don't affect the price, which is always re-checked server-side.
    const res = await fetch(CREATE_ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          size: i.size || undefined,
          color: i.color || undefined,
        })),
        customer,
        affiliate_ref: window.getAffiliateRef ? window.getAffiliateRef() : undefined,
      }),
    });
    const orderData = await res.json();
    if (!res.ok) throw new Error(orderData.error || "Could not create order");

    // 2. Open Cashfree's hosted checkout using the payment_session_id
    const cashfree = Cashfree({ mode: orderData.cashfree_env === "production" ? "production" : "sandbox" });

    const result = await cashfree.checkout({
      paymentSessionId: orderData.payment_session_id,
      redirectTarget: "_modal", // opens Cashfree checkout in an in-page modal instead of redirecting away
    });

    if (result.error) {
      // Customer closed the modal or payment failed before completion
      throw new Error(result.error.message || "Payment was not completed");
    }

    // 3. Whether the modal resolved with success or the customer returned from
    // a redirect flow, always verify the real status server-side before
    // treating the order as paid.
    const verifyRes = await fetch(VERIFY_PAYMENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cashfree_order_id: orderData.cashfree_order_id,
      }),
    });
    const verifyData = await verifyRes.json();

    if (verifyData.ok) {
      // Only clear the bag for a real cart checkout — a Buy Now purchase
      // never touched Cart.items, so there's nothing to clear there.
      if (!buyNowItem) {
        Cart.items = [];
        Cart.save();
      }
      buyNowItem = null;
      document.getElementById("checkoutModal").classList.remove("open");
      alert("Payment successful! Your order is confirmed. Order ID: " + orderData.cashfree_order_id);
    } else {
      alert(
        "We couldn't confirm your payment yet. If money was deducted, contact support with this order ID: " +
          orderData.cashfree_order_id,
      );
    }
  } catch (err) {
    alert(err.message);
  } finally {
    payBtn.disabled = false;
    payBtn.textContent = "PAY WITH CASHFREE";
  }
});
