// Include this on every admin page AFTER admin-config.js and BEFORE any
// page-specific script. It blocks rendering until we've confirmed the
// visitor is (a) logged in and (b) present in admin_users.
//
// Usage in <head> or right after <body>:
//   <script src="js/admin-config.js"></script>
//   <script src="js/auth-guard.js"></script>

(async function guard() {
  const { data: { session } } = await supabaseClient.auth.getSession(); 

  if (!session) {
    window.location.href = "login.html";
    return;
  }

  // Confirm this logged-in user is actually an admin. RLS also enforces this
  // on every query, but checking here lets us bounce non-admins immediately
  // with a clear message instead of them seeing a half-broken empty dashboard.
  const { data: adminRow, error } = await supabaseClient
    .from("admin_users")
    .select("user_id, name")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !adminRow) {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html?error=not_admin";
    return;
  }

  // Expose current admin info to page scripts
  window.currentAdmin = { id: session.user.id, email: session.user.email, name: adminRow.name };

  // Wire up logout buttons if the page has one
  document.addEventListener("DOMContentLoaded", () => {
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await supabaseClient.auth.signOut();
        window.location.href = "login.html";
      });
    }
    const nameEl = document.getElementById("adminName");
    if (nameEl) nameEl.textContent = adminRow.name || session.user.email;
  });
})();
