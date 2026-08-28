// Public config — the anon key is safe to expose in frontend code by design.
// Never put the Supabase SERVICE ROLE key here.
// This is the SAME Supabase project as the storefront — admin access is
// controlled by RLS policies (see supabase/admin_schema.sql), not by a
// separate project or key.

const SUPABASE_URL = "https://uvperhzhnosjtkwxxnte.supabase.co";
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY"; // same key as the storefront's config.js

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
