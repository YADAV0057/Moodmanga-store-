document.getElementById("checkoutBtn").addEventListener("click", () => {
  if (!Cart.items.length) return;
  document.getElementById("checkoutTotal").textContent = `₹${Cart.total().toLocaleString("en-IN")}`;
  toggleCart(false);
  document.getElementById("checkoutModal").classList.add("open");
});

document.getElementById("closeCheckout").addEventListener("click", () => {
  document.getElementById("checkoutModal").classList.remove("open");
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

  try {
    // 1. Ask our edge function to create a Razorpay order (server-side, trusted prices)
    const res = await fetch(CREATE_ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: Cart.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        customer,
      }),
    });
    const orderData = await res.json();
    if (!res.ok) throw new Error(orderData.error || "Could not create order");

    // 2. Open Razorpay's hosted checkout
    const rzp = new Razorpay({
      key: orderData.razorpay_key_id,
      amount: orderData.amount,
      currency: orderData.currency,
      name: "MoodManga Store",
      description: "Order payment",
      order_id: orderData.razorpay_order_id,
      prefill: { name: customer.name, email: customer.email, contact: customer.phone },
      theme: { color: "#5b4b8a" },
      handler: async function (response) {
        // 3. Verify the payment server-side before treating the order as paid
        const verifyRes = await fetch(VERIFY_PAYMENT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        const verifyData = await verifyRes.json();
        if (verifyData.ok) {
          Cart.items = [];
          Cart.save();
          document.getElementById("checkoutModal").classList.remove("open");
          alert("Payment successful! Your order is confirmed.");
        } else {
          alert("Payment could not be verified. Please contact support with your payment ID: " + response.razorpay_payment_id);
        }
      },
      modal: {
        ondismiss: function () {
          payBtn.disabled = false;
          payBtn.textContent = "PAY WITH RAZORPAY";
        },
      },
    });
    rzp.open();
  } catch (err) {
    alert(err.message);
    payBtn.disabled = false;
    payBtn.textContent = "PAY WITH RAZORPAY";
  }
});
