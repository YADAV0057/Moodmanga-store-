// supabase/functions/verify-payment/index.ts
// Verifies the Razorpay payment signature server-side (never trust the client) and marks
// the matching store_orders row as 'paid'. Also decrements stock.

import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: "Missing verification fields" }, 400);
    }

    // HMAC-SHA256(order_id + "|" + payment_id, key_secret) must equal razorpay_signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(RAZORPAY_KEY_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${razorpay_order_id}|${razorpay_payment_id}`),
    );
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (expectedSignature !== razorpay_signature) {
      return json({ error: "Invalid payment signature" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: order, error: fetchErr } = await supabase
      .from("store_orders")
      .select("id, status")
      .eq("razorpay_order_id", razorpay_order_id)
      .single();
    if (fetchErr) throw fetchErr;

    if (order.status === "paid") {
      return json({ ok: true, already_processed: true });
    }

    const { error: updateErr } = await supabase
      .from("store_orders")
      .update({
        status: "paid",
        razorpay_payment_id,
        paid_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    if (updateErr) throw updateErr;

    // Decrement stock for each item in this order
    const { data: items, error: itemsErr } = await supabase
      .from("store_order_items")
      .select("product_id, quantity")
      .eq("order_id", order.id);
    if (itemsErr) throw itemsErr;

    for (const item of items ?? []) {
      await supabase.rpc("decrement_stock", {
        p_product_id: item.product_id,
        p_qty: item.quantity,
      });
    }

    return json({ ok: true });
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
