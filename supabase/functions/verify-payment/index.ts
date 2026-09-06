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
//
// 2026-08-29: after marking an order paid for the first time, fires a
// signed webhook to the standalone affiliate service so it can record a
// conversion + commission, if this order carried an affiliate_ref (set by
// create-order from the mst_aff_ref cookie via track.js/checkout.js).
// Requires three additional secrets:
//   AFFILIATE_WEBHOOK_URL     e.g. https://<affiliate-project>.supabase.co/functions/v1/record-conversion
//   AFFILIATE_WEBHOOK_SECRET  shared HMAC secret for this store (from the affiliate project's stores table)
//   AFFILIATE_STORE_SLUG      e.g. "moodstore"
// The webhook call is best-effort and never blocks or fails payment
// verification — if the affiliate service is down or misconfigured, the
// customer still gets their payment confirmed normally.
//
// 2026-08-30 (Phase 9, affiliate side): now also sends customer_email in
// the webhook payload, so the affiliate service can detect and auto-reject
// self-referrals (an affiliate buying through their own tracked link).
// This store's own data model is unaffected — customer_email already
// lived on store_orders, this just also forwards it downstream. If the
// affiliate service is on an older version that doesn't read this field,
// it's simply ignored there.

import { createClient } from "npm:@supabase/supabase-js@2";

const CASHFREE_APP_ID = Deno.env.get("CASHFREE_APP_ID")!;
const CASHFREE_SECRET_KEY = Deno.env.get("CASHFREE_SECRET_KEY")!;
const CASHFREE_ENV = Deno.env.get("CASHFREE_ENV") ?? "sandbox";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AFFILIATE_WEBHOOK_URL = Deno.env.get("AFFILIATE_WEBHOOK_URL");
const AFFILIATE_WEBHOOK_SECRET = Deno.env.get("AFFILIATE_WEBHOOK_SECRET");
const AFFILIATE_STORE_SLUG = Deno.env.get("AFFILIATE_STORE_SLUG");

const CASHFREE_BASE_URL =
  CASHFREE_ENV === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Fires the conversion webhook to the affiliate service. Never throws —
// any failure here is logged only, and never affects the response sent
// back to the customer's browser.
async function notifyAffiliateService(
  orderId: string,
  orderTotal: number,
  affiliateRef: string,
  customerEmail: string | null,
) {
  if (!AFFILIATE_WEBHOOK_URL || !AFFILIATE_WEBHOOK_SECRET || !AFFILIATE_STORE_SLUG) {
    console.warn("Affiliate webhook secrets not configured; skipping conversion notification.");
    return;
  }
  try {
    const payload = JSON.stringify({
      store_slug: AFFILIATE_STORE_SLUG,
      order_id: orderId,
      order_total: orderTotal,
      affiliate_ref: affiliateRef,
      customer_email: customerEmail,
    });
    const signature = await hmacHex(AFFILIATE_WEBHOOK_SECRET, payload);

    const res = await fetch(AFFILIATE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-signature": signature,
      },
      body: payload,
    });

    if (!res.ok) {
      console.error("Affiliate webhook non-OK response:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Affiliate webhook call failed:", err);
  }
}

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
      .select("id, status, total_inr, affiliate_ref, customer_email")
      .eq("cashfree_order_id", cashfree_order_id)
      .single();

    if (fetchErr || !orderRow) throw new Error("Order not found");

    // Idempotent: if we've already marked this paid, don't decrement stock twice
    // and don't fire the affiliate webhook a second time either.
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

      if (orderRow.affiliate_ref) {
        // Fire-and-forget from the response's perspective, but awaited here
        // so it still completes before the function instance can be frozen.
        await notifyAffiliateService(
          cashfree_order_id,
          Number(orderRow.total_inr),
          orderRow.affiliate_ref,
          orderRow.customer_email ?? null,
        );
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
