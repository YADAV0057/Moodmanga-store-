// supabase/functions/verify-payment/index.ts
// Called by the frontend right after Cashfree's checkout redirect/modal closes.
// It does NOT trust the client — it re-checks the order status directly with
// Cashfree's servers before marking anything as paid.
//
// For production you should ALSO set up a Cashfree webhook pointing at a
// separate endpoint, since a user closing the tab mid-payment means this
// function may never get called. Webhooks are the source of truth; this
// function just gives the customer immediate on-screen confirmation.
//
// Requires these Supabase project secrets:
//   CASHFREE_APP_ID
//   CASHFREE_SECRET_KEY
//   CASHFREE_ENV
//   SUPABASE_URL              (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const CASHFREE_APP_ID = Deno.env.get("CASHFREE_APP_ID")!;
const CASHFREE_SECRET_KEY = Deno.env.get("CASHFREE_SECRET_KEY")!;
const CASHFREE_ENV = Deno.env.get("CASHFREE_ENV") ?? "sandbox";
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
    const { cashfree_order_id } = await req.json();
    if (!cashfree_order_id) return json({ ok: false, error: "Missing order id" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Ask Cashfree directly for the current order + payment status. Never
    // trust a status string sent from the browser.
    const cfRes = await fetch(`${CASHFREE_BASE_URL}/orders/${cashfree_order_id}/payments`, {
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
      },
    });

    if (!cfRes.ok) {
      const errText = await cfRes.text();
      throw new Error(`Cashfree order lookup failed: ${errText}`);
    }

    const payments = await cfRes.json(); // array of payment attempts for this order
    const successfulPayment = Array.isArray(payments)
      ? payments.find((p: any) => p.payment_status === "SUCCESS")
      : null;

    if (!successfulPayment) {
      return json({ ok: false, error: "Payment not confirmed yet" });
    }

    // Look up our internal order row
    const { data: orderRow, error: fetchErr } = await supabase
      .from("store_orders")
      .select("id, status")
      .eq("cashfree_order_id", cashfree_order_id)
      .single();

    if (fetchErr || !orderRow) throw new Error("Order not found");

    // Idempotent: if we've already marked this paid, don't decrement stock twice.
    if (orderRow.status !== "paid") {
      const { error: updateErr } = await supabase
        .from("store_orders")
        .update({
          status: "paid",
          cashfree_payment_id: String(successfulPayment.cf_payment_id),
          paid_at: new Date().toISOString(),
        })
        .eq("id", orderRow.id);
      if (updateErr) throw updateErr;

      const { data: orderItems, error: itemsErr } = await supabase
        .from("store_order_items")
        .select("product_id, quantity")
        .eq("order_id", orderRow.id);
      if (itemsErr) throw itemsErr;

      for (const item of orderItems ?? []) {
        await supabase.rpc("decrement_stock", {
          p_product_id: item.product_id,
          p_qty: item.quantity,
        });
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
