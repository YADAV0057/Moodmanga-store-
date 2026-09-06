// supabase/functions/create-order/index.ts
// Creates a Cashfree order + a matching store_orders row (status: 'created').
// Requires these Supabase project secrets (set via `supabase secrets set` or dashboard):
//   CASHFREE_APP_ID
//   CASHFREE_SECRET_KEY
//   CASHFREE_ENV               ("sandbox" or "production")
//   SUPABASE_URL              (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//
// 2026-08-29: added optional coupon_code support (store_coupons table,
// e.g. WELCOME20 — 20% off, capped at the first 500 uses). Redemption is
// claimed with an atomic UPDATE ... WHERE uses_count = <value just read>
// (optimistic lock) AND uses_count < max_uses, so two concurrent checkouts
// racing for the last available use can't both win it — whichever
// request's UPDATE actually matches a row wins the slot; the loser's
// UPDATE affects zero rows and is treated as "coupon no longer
// available", no error surfaced, order just proceeds at full price.
// Never trust a discount amount sent from the client — it's always
// recomputed here from the coupon row.
//
// 2026-08-29: added optional affiliate_ref passthrough — the ref code
// read from the mst_aff_ref cookie by track.js/checkout.js on the
// storefront, if any. Stored as-is on the order (not validated here —
// validation/commission calculation happens on the affiliate service side
// when verify-payment fires the conversion webhook after payment succeeds).
// This function does not call the affiliate service at all.

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
    const { items, customer, coupon_code, affiliate_ref } = body as {
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
      coupon_code?: string;
      affiliate_ref?: string;
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

    // --- Coupon redemption (optional) ---
    let discount = 0;
    let appliedCouponCode: string | null = null;
    const normalizedCode = coupon_code?.trim().toUpperCase();

    if (normalizedCode) {
      const { data: couponRow, error: readErr } = await supabase
        .from("store_coupons")
        .select("id, discount_type, discount_value, min_order_inr, max_uses, uses_count, active, expires_at")
        .eq("code", normalizedCode)
        .maybeSingle();

      if (readErr) throw readErr;

      const now = new Date();
      const eligible =
        couponRow &&
        couponRow.active &&
        (!couponRow.expires_at || new Date(couponRow.expires_at) > now) &&
        (couponRow.max_uses == null || couponRow.uses_count < couponRow.max_uses) &&
        subtotal >= Number(couponRow.min_order_inr || 0);

      if (eligible) {
        // Atomic claim: the WHERE clause re-checks uses_count against both
        // the value we just read (optimistic lock) and max_uses, in the
        // same statement as the increment — so this can't overshoot
        // max_uses under concurrent requests.
        const { data: updated, error: updateErr } = await supabase
          .from("store_coupons")
          .update({ uses_count: couponRow!.uses_count + 1 })
          .eq("id", couponRow!.id)
          .eq("uses_count", couponRow!.uses_count)
          .lt("uses_count", couponRow!.max_uses ?? Number.MAX_SAFE_INTEGER)
          .select()
          .maybeSingle();

        if (updateErr) throw updateErr;

        if (updated) {
          appliedCouponCode = normalizedCode;
          discount =
            couponRow!.discount_type === "percent"
              ? Math.round((subtotal * Number(couponRow!.discount_value)) / 100)
              : Math.min(Number(couponRow!.discount_value), subtotal);
        }
        // If updated is null, someone else claimed the last slot between our
        // read and write — fall through with discount = 0, no error thrown,
        // customer just checks out at full price.
      }
    }

    const shipping = subtotal >= 999 ? 0 : 79; // flat shipping rule, adjust as needed
    const total = Math.max(subtotal + shipping - discount, 0);

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
        coupon_code: appliedCouponCode,
        discount_inr: discount,
        affiliate_ref: typeof affiliate_ref === "string" && affiliate_ref.trim() ? affiliate_ref.trim() : null,
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
      subtotal_inr: subtotal,
      shipping_inr: shipping,
      discount_inr: discount,
      total_inr: total,
      coupon_applied: appliedCouponCode,
      coupon_rejected: !!(normalizedCode && !appliedCouponCode),
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
