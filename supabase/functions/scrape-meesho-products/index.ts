// supabase/functions/scrape-meesho-products/index.ts
//
// Admin-only. Takes a list of Meesho product URLs, fetches each page's HTML
// server-side (avoids the CORS block a browser fetch would hit), and pulls
// out product details. Does NOT write anything to the database — the admin
// panel reviews the returned preview and uploads separately via the normal
// store_products insert/upsert (same RLS-protected path products.js uses).
//
// Requires these Supabase project secrets (auto-provided by the platform):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// Deploy with:
//   supabase functions deploy scrape-meesho-products

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // --- Auth check: must be a logged-in admin ---------------------------
    // Forward the caller's own JWT so RLS applies exactly as it would from
    // the browser (same check auth-guard.js does client-side).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) return json({ error: "Admin access required" }, 403);

    // --- Parse request body -----------------------------------------------
    const { urls } = await req.json();
    if (!Array.isArray(urls) || urls.length === 0) {
      return json({ error: "Provide a non-empty 'urls' array" }, 400);
    }
    if (urls.length > 25) {
      return json({ error: "Max 25 URLs per scan — split into batches" }, 400);
    }

    // --- Scrape each URL ----------------------------------------------------
    const products = await Promise.all(urls.map((url: string) => scrapeOne(url)));

    return json({ products });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 500);
  }
});

async function scrapeOne(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    const html = await res.text();

    const nextData = extractNextData(html);
    const og = extractOgTags(html);

    const productNode = nextData ? findProductNode(nextData) : null;

    const name =
      productNode?.name ||
      productNode?.product_name ||
      productNode?.title ||
      og.title ||
      "Untitled product";

    const priceRaw =
      productNode?.price ??
      productNode?.min_product_price ??
      productNode?.selling_price ??
      og.price ??
      null;

    const mrpRaw =
      productNode?.mrp ?? productNode?.max_product_price ?? productNode?.strike_price ?? null;

    const images: string[] =
      productNode?.images ||
      productNode?.product_images ||
      productNode?.gallery ||
      (og.image ? [og.image] : []);

    const sizes: string[] = Array.isArray(productNode?.sizes)
      ? productNode.sizes
          .map((s: unknown) =>
            typeof s === "string" ? s : (s as any)?.name || (s as any)?.label
          )
          .filter(Boolean)
      : [];

    const nameStr = String(name).trim();

    return {
      source_url: url,
      name: nameStr,
      slug: slugify(nameStr),
      description: (productNode?.description || og.description || "").trim(),
      price_inr: priceRaw ? Number(priceRaw) : null,
      compare_at_price_inr: mrpRaw ? Number(mrpRaw) : null,
      image_url: Array.isArray(images) ? images[0] || null : og.image,
      gallery_urls: Array.isArray(images) ? images.slice(0, 8) : [],
      sizes,
      colors: [] as string[],
      category: "Clothing",
      mood_tag: null as string | null,
      stock_qty: 10,
      is_active: true,
      size_guide: "tops",
      _needs_review: !priceRaw || !nameStr || images.length === 0,
    };
  } catch (err) {
    return {
      source_url: url,
      name: null,
      error: (err as Error).message,
      _needs_review: true,
    };
  }
}

function extractNextData(html: string): any | null {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractOgTags(html: string) {
  const get = (prop: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1] : null;
  };
  return {
    title: get("og:title"),
    description: get("og:description"),
    image: get("og:image"),
    price: get("product:price:amount"),
  };
}

// Meesho's internal data shape shifts between deploys, so we search loosely
// through the Next.js data tree for an object that looks product-shaped
// rather than relying on one fixed exact path.
function findProductNode(root: any): any | null {
  const seen = new Set<any>();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const looksLikeProduct =
      (node.name || node.product_name || node.title) &&
      (node.price || node.min_product_price || node.selling_price);
    if (looksLikeProduct) return node;
    for (const key of Object.keys(node)) {
      if (node[key] && typeof node[key] === "object") stack.push(node[key]);
    }
  }
  return null;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
        }
