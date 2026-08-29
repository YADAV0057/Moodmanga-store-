// track.js — Mood Store affiliate click tracking
// Add this script tag to index.html and every /product/<slug>.html page:
//   <script src="js/track.js?v=1"></script>   (or ../js/track.js on product pages)
//
// What it does:
// 1. Reads ?ref=CODE from the URL, if present.
// 2. Stores it in a 30-day first-party cookie so checkout.js can read it
//    later, even if the shopper browses for days before buying.
// 3. Fires a one-way, non-blocking beacon to the affiliate service to log
//    the click. Never throws, never blocks the page, never breaks the
//    storefront if the affiliate service is slow/down.
//
// Nothing here talks to the affiliate service's database directly — it
// only calls the public track-click endpoint, which validates the ref
// code server-side before recording anything.

(function () {
  var STORE_SLUG = "moodstore";
  var TRACK_ENDPOINT = "https://yrrficomytctlpypdkpy.supabase.co/functions/v1/track-click";
  var COOKIE_NAME = "mst_aff_ref";
  var COOKIE_DAYS = 30;

  function getParam(name) {
    var match = new RegExp("[?&]" + name + "=([^&]+)").exec(location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/; SameSite=Lax";
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  }

  try {
    var ref = getParam("ref");

    if (ref) {
      // Last-click attribution: a newer ref link overwrites an older one.
      setCookie(COOKIE_NAME, ref, COOKIE_DAYS);

      var payload = JSON.stringify({
        ref_code: ref,
        store_slug: STORE_SLUG,
        landing_url: location.href,
        referrer: document.referrer || null,
      });

      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(TRACK_ENDPOINT, blob);
      } else {
        fetch(TRACK_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    }
  } catch (e) {
    // Tracking must never break the storefront.
  }

  // Exposed so checkout.js can attach the affiliate ref to the order at
  // checkout time (wired in a later phase).
  window.getAffiliateRef = function () {
    return getCookie(COOKIE_NAME);
  };
})();
