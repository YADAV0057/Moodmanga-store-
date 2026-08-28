// Public config — the anon key is safe to expose in frontend code by design.
// Never put the Supabase SERVICE ROLE key or Razorpay SECRET key here.

const SUPABASE_URL = "https://uvperhzhnosjtkwxxnte.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2cGVyaHpobm9zanRrd3h4bnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjQ2NzMsImV4cCI6MjA5OTQ0MDY3M30.oq8MY6Z6QrdWAL8djO0TtuUbDQbKLng6AC7kZRAB2zk "; // from Supabase project settings > API

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Edge function endpoints
const CREATE_ORDER_URL = `${SUPABASE_URL}/functions/v1/create-order`;
const VERIFY_PAYMENT_URL = `${SUPABASE_URL}/functions/v1/verify-payment`;
