// Public config — the anon key is safe to expose in frontend code by design.
// Never put the Supabase SERVICE ROLE key or Razorpay SECRET key here.

const SUPABASE_URL = "https://uvperhzhnosjtkwxxnte.supabase.co";
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY"; // from Supabase project settings > API

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Edge function endpoints
const CREATE_ORDER_URL = `${SUPABASE_URL}/functions/v1/create-order`;
const VERIFY_PAYMENT_URL = `${SUPABASE_URL}/functions/v1/verify-payment`;
