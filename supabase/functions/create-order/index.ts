// supabase/functions/create-order/index.ts
// Creates a Cashfree order + a matching store_orders row (status: 'created').
// Requires these Supabase project secrets (set via `supabase secrets set` or dashboard):
//   CASHFREE_APP_ID
//   CASHFREE_SECRET_KEY
//   CASHFREE_ENV               ("sandbox" or "production")
//   SUPABASE_URL              (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const CASHFREE_APP_ID = Deno.env.get("CASHFREE_APP_ID")!;
const CASHFREE_SECRET_KEY = Deno.env.get("CASHFREE_SECRET_KEY")!;
const CASHFREE_ENV = Deno.env.get("CASHFREE_ENV") ?? "sandbox"; // "sandbox" | "production"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CASHFREE_BASE_URL =
  CASHFREE_ENV === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { items, customer } = body as {
      // size/color are customer-chosen variant info, just carried through to
      // the order record for fulfillment — they don't affect price or stock,
      // since stock is tracked per-product, not per-variant.
      items: { product_id: string; quantity: number; size?: string; color?: string }[];
      customer: {
        name: string;
        email: string;
        phone: string;
        address: Record<string, string>;
      };
    };

    if (!items?.length) {
      return json({ error: "Cart is empty" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Re-fetch real prices server-side. Never trust prices sent from the client.
    const productIds = items.map((i) => i.product_id);
    const { data: products, error: prodErr } = await supabase
      .from("store_products")
      .select("id, name, price_inr, stock_qty, is_active")
      .in("id", productIds);

    if (prodErr) throw prodErr;

    let subtotal = 0;
    const orderItems = items.map((item) => {
      const product = products!.find((p) => p.id === item.product_id);
      if (!product || !product.is_active) {
        throw new Error(`Product ${item.product_id} is not available`);
      }
      if (product.stock_qty < item.quantity) {
        throw new Error(`Not enough stock for ${product.name}`);
      }
      const lineTotal = Number(product.price_inr) * item.quantity;
      subtotal += lineTotal;
      return {
        product_id: product.id,
        product_name: product.name,
        unit_price_inr: product.price_inr,
        quantity: item.quantity,
        line_total_inr: lineTotal,
        variant_size: item.size ?? null,
        variant_color: item.color ?? null,
      };
    });

    const shipping = subtotal >= 999 ? 0 : 79; // flat shipping rule, adjust as needed
    const total = subtotal + shipping;

    // Cashfree requires a unique order_id per order, unlike Razorpay which generates one for you.
    const cfOrderId = `mm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create the Cashfree order
    const cfRes = await fetch(`${CASHFREE_BASE_URL}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
      },
      body: JSON.stringify({
        order_id: cfOrderId,
        order_amount: total,
        order_currency: "INR",
        customer_details: {
          customer_id: customer.email.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50),
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone,
        },
        order_meta: {
          // return_url is used for redirect-based checkout; {order_id} is substituted by Cashfree
          return_url: `${req.headers.get("origin") ?? ""}/order-status.html?order_id={order_id}`,
        },
      }),
    });

    if (!cfRes.ok) {
      const errText = await cfRes.text();
      throw new Error(`Cashfree order creation failed: ${errText}`);
    }
    const cfOrder = await cfRes.json();

    // Persist the order in 'created' state
    const { data: orderRow, error: orderErr } = await supabase
      .from("store_orders")
      .insert({
        cashfree_order_id: cfOrder.order_id,
        status: "created",
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        shipping_address: customer.address,
        subtotal_inr: subtotal,
        shipping_inr: shipping,
        total_inr: total,
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    const itemsToInsert = orderItems.map((i) => ({ ...i, order_id: orderRow.id }));
    const { error: itemsErr } = await supabase.from("store_order_items").insert(itemsToInsert);
    if (itemsErr) throw itemsErr;

    return json({
      cashfree_order_id: cfOrder.order_id,
      payment_session_id: cfOrder.payment_session_id,
      cashfree_env: CASHFREE_ENV,
      internal_order_id: orderRow.id,
    });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
