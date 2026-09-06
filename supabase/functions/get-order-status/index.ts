// supabase/functions/get-order-status/index.ts
// Public lookup used by order-status.html right after checkout, and by
// return-request.html to validate an order before submitting a return.
//
// Looked up by cashfree_order_id, which is a long random string
// (mm_<timestamp>_<random>) — unguessable in practice, same trust model as
// most guest-checkout order-tracking pages. Returns only display-safe
// fields: no phone number or shipping address, since this endpoint has no
// auth and the order id alone is enough to call it.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const cashfree_order_id =
      url.searchParams.get("order_id") ??
      (req.method === "POST" ? (await req.json())?.cashfree_order_id : null);

    if (!cashfree_order_id) return json({ error: "Missing order_id" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: order, error } = await supabase
      .from("store_orders")
      .select(
        "id, cashfree_order_id, status, customer_name, subtotal_inr, shipping_inr, discount_inr, coupon_code, total_inr, created_at, paid_at, tracking_number, tracking_carrier",
      )
      .eq("cashfree_order_id", cashfree_order_id)
      .maybeSingle();

    if (error) throw error;
    if (!order) return json({ error: "Order not found" }, 404);

    const { data: items, error: itemsErr } = await supabase
      .from("store_order_items")
      .select("product_name, unit_price_inr, quantity, line_total_inr, variant_size, variant_color")
      .eq("order_id", order.id);

    if (itemsErr) throw itemsErr;

    // Return eligibility, so order-status.html can show/hide the
    // "Request a return" link without a second round trip.
    const { data: settings } = await supabase
      .from("store_settings")
      .select("return_window_days")
      .eq("id", true)
      .maybeSingle();

    const returnWindowDays = settings?.return_window_days ?? 7;
    let returnEligible = false;
    if (order.status === "paid" && order.paid_at) {
      const daysSincePaid = (Date.now() - new Date(order.paid_at).getTime()) / 86400000;
      returnEligible = daysSincePaid <= returnWindowDays;
    }

    const { data: existingReturn } = await supabase
      .from("store_return_requests")
      .select("status")
      .eq("order_id", order.id)
      .maybeSingle();

    return json({
      order: { ...order, id: undefined }, // internal uuid not needed by the client
      items,
      return_eligible: returnEligible && !existingReturn,
      return_window_days: returnWindowDays,
      existing_return_status: existingReturn?.status ?? null,
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
