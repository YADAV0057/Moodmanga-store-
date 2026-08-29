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

document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
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
      alert("Payment successful! Your order is confirmed.");
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
