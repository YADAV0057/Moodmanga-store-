// supabase/functions/create-order/index.ts
// Creates a Razorpay order + a matching store_orders row (status: 'created').
// Requires these Supabase project secrets (set via `supabase secrets set` or dashboard):
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
//   SUPABASE_URL              (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { items, customer } = body as {
      items: { product_id: string; quantity: number }[];
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
      };
    });

    const shipping = subtotal >= 999 ? 0 : 79; // flat shipping rule, adjust as needed
    const total = subtotal + shipping;

    // Create the Razorpay order (amount is in paise)
    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`),
      },
      body: JSON.stringify({
        amount: Math.round(total * 100),
        currency: "INR",
        receipt: `mm_${Date.now()}`,
      }),
    });

    if (!razorpayRes.ok) {
      const errText = await razorpayRes.text();
      throw new Error(`Razorpay order creation failed: ${errText}`);
    }
    const razorpayOrder = await razorpayRes.json();

    // Persist the order in 'created' state
    const { data: orderRow, error: orderErr } = await supabase
      .from("store_orders")
      .insert({
        razorpay_order_id: razorpayOrder.id,
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
      razorpay_order_id: razorpayOrder.id,
      razorpay_key_id: RAZORPAY_KEY_ID,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
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
