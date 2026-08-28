
// Public config — the anon key is safe to expose in frontend code by design.
// Never put the Supabase SERVICE ROLE key here.
// This is the SAME Supabase project as the storefront — admin access is
// controlled by RLS policies (see supabase/admin_schema.sql), not by a
// separate project or key.

const SUPABASE_URL = "https://uvperhzhnosjtkwxxnte.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2cGVyaHpobm9zanRrd3h4bnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjQ2NzMsImV4cCI6MjA5OTQ0MDY3M30.oq8MY6Z6QrdWAL8djO0TtuUbDQbKLng6AC7kZRAB2zk "; // same key as the storefront's config.js

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
