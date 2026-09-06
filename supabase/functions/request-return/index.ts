// supabase/functions/request-return/index.ts
// Public endpoint backing return-request.html. Validates everything
// server-side before inserting — never trusts the client's word on
// whether an order is eligible.
//
// Checks, in order:
//   1. Order exists (by cashfree_order_id)
//   2. The email provided matches the order's customer_email
//      (case-insensitive) — stops strangers filing returns on orders
//      that aren't theirs.
//   3. Order status is 'paid', 'shipped', or 'delivered' (can't return
//      something that was never paid for or was cancelled/refunded already)
//   4. Within the store's return window (store_settings.return_window_days,
//      default 7), measured from paid_at.
//   5. No existing return request for this order (unique constraint is the
//      final backstop; checked here first for a clean error message).
//
// Requires:
//   SUPABASE_URL              (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RETURNABLE_STATUSES = ["paid", "shipped", "delivered"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { cashfree_order_id, email, reason, note } = body as {
      cashfree_order_id?: string;
      email?: string;
      reason?: string;
      note?: string;
    };

    if (!cashfree_order_id || !email || !reason) {
      return json({ error: "Missing order id, email, or reason" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: order, error: orderErr } = await supabase
      .from("store_orders")
      .select("id, status, customer_email, paid_at")
      .eq("cashfree_order_id", cashfree_order_id)
      .maybeSingle();

    if (orderErr) throw orderErr;
    if (!order) return json({ error: "We couldn't find an order with that ID." }, 404);

    if (order.customer_email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return json({ error: "That email doesn't match the order on file." }, 403);
    }

    if (!RETURNABLE_STATUSES.includes(order.status)) {
      return json({ error: `This order (status: ${order.status}) isn't eligible for a return.` }, 400);
    }

    const { data: settings } = await supabase
      .from("store_settings")
      .select("return_window_days")
      .eq("id", true)
      .maybeSingle();
    const returnWindowDays = settings?.return_window_days ?? 7;

    if (order.paid_at) {
      const daysSincePaid = (Date.now() - new Date(order.paid_at).getTime()) / 86400000;
      if (daysSincePaid > returnWindowDays) {
        return json(
          { error: `The ${returnWindowDays}-day return window for this order has passed.` },
          400,
        );
      }
    }

    const { data: existing } = await supabase
      .from("store_return_requests")
      .select("id, status")
      .eq("order_id", order.id)
      .maybeSingle();

    if (existing) {
      return json(
        { error: `A return was already requested for this order (status: ${existing.status}).` },
        409,
      );
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("store_return_requests")
      .insert({
        order_id: order.id,
        cashfree_order_id,
        customer_email: email.trim(),
        reason: reason.trim(),
        note: note?.trim() || null,
      })
      .select("id, status, created_at")
      .single();

    if (insertErr) {
      // Unique violation = a request already exists (race with another tab).
      if ((insertErr as any).code === "23505") {
        return json({ error: "A return was already requested for this order." }, 409);
      }
      throw insertErr;
    }

    return json({ ok: true, return_request: inserted });
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
