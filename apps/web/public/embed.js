/**
 * Dapta Forms embed helper: auto-resizes embedded form iframes, carries their
 * end-of-form redirect up to the host page, and tells a form which page it is
 * answered on.
 *
 * Drop next to any iframe carrying the `data-dapta-forms` attribute:
 *
 *   <iframe data-dapta-forms src="https://your-host/acct/handle/slug?embed=1"
 *           title="My form" loading="lazy"
 *           style="width:100%;border:0;min-height:480px;"></iframe>
 *   <script src="https://your-host/embed.js" async></script>
 *
 * Four messages cross the boundary, all matched to a frame by `event.source`
 * and never by URL, so several forms can share one page and a message can only
 * ever act on the frame it came from:
 *
 *   dapta-forms:resize   {height}: the embedded page (opened with ?embed=1)
 *     posts its content height whenever it changes; this script sets the
 *     matching iframe's height so the form never shows an inner scrollbar.
 *     Only a number crosses: no answers, no identifiers.
 *
 *   dapta-forms:redirect {url}: the form finished and its configured
 *     destination has to be opened at the TOP level, not inside the frame.
 *     Checkout pages (Stripe Payment Links above all) refuse to run framed by
 *     another site and hang on their own skeleton, so a form that redirects to
 *     one submits into nothing unless the host page navigates itself. The URL
 *     is the form's published `redirectUrl`, a static string, never built from
 *     what the visitor typed. It is allowlisted to http(s) before use, exactly
 *     as the renderer does before assigning `window.location`. This script
 *     replies `dapta-forms:redirect-ack` so the frame knows not to navigate
 *     the top as well: two navigations of one document race, and WebKit
 *     resolves that race by cancelling both.
 *
 *   dapta-forms:scroll-into-view: the form swapped its whole screen (the
 *     ending, the submitting screen) and the new screen starts at the top of
 *     the frame. On a long one-page form the visitor is scrolled to the button
 *     they just pressed, far below it, and would be left looking at an empty
 *     block. This script scrolls the frame's top into view, and ONLY when that
 *     top is out of the viewport: someone already looking at it is not moved.
 *     Smooth unless the visitor asked for reduced motion. The form never sends
 *     it for the screen it loads with, so loading a page never scrolls it.
 *
 *   dapta-forms:context-request {id, v: 1}: the form is about to save its
 *     answers and asks which page it is on. This script answers
 *     `dapta-forms:context {id, v: 1, pageUri, pageName, pageId?,
 *     hsPortalId?, hutk?}`: this page's URL and title, its HubSpot page and
 *     portal ids when it runs HubSpot, and HubSpot's visitor cookie
 *     (`hubspotutk`), which is what lets HubSpot join the new contact to the
 *     visits it made before converting. The iframe cannot read any of it: it
 *     lives on another origin. The answer goes ONLY to one of our frames, and
 *     only while that frame still shows the origin of its own `src`, so a frame
 *     that navigated elsewhere is never handed the cookie. The cookie is left
 *     out when the visitor opted out of HubSpot tracking (`__hs_opt_out=yes`,
 *     or a `__hs_do_not_track` cookie) and when it is not HubSpot shaped. This
 *     script reads cookies and never writes one. Put
 *     `data-dapta-forms-context="off"` on an iframe to keep all of it from
 *     that form: the answer is then `{id, v: 1, off: true}` and nothing else.
 *
 * Anything that is not one of those messages, in that shape, is ignored. A
 * copy of this script cached from before a message existed simply ignores it.
 *
 * WHY THE REDIRECT HANDLER EXISTS: a plain cross-origin iframe can navigate
 * its own top, so most embeds never need this message. An iframe given a
 * `sandbox` attribute that omits `allow-top-navigation` cannot: the browser
 * refuses it with nothing but a console warning, and the visitor is stranded
 * on a form that went nowhere. This script runs in the host page, outside that
 * sandbox, so it can still navigate. Keep it on the page.
 */
(function () {
  'use strict';

  var MAX_HEIGHT = 20000; // sanity cap — a runaway report can't blow up the host page
  var HTTP_ONLY = /^https?:\/\//i; // same allowlist the renderer applies
  var leaving = false; // one redirect per page — a second message is a no-op

  var HUTK = /^[0-9a-f]{32}$/i; // HubSpot's visitor cookie: 32 hex characters
  var DIGITS = /^\d{1,20}$/; // a HubSpot page or portal id

  /** True when `source` is the contentWindow of one of OUR embedded frames. */
  function isOurFrame(source) {
    var frames = document.querySelectorAll('iframe[data-dapta-forms]');
    for (var i = 0; i < frames.length; i++) {
      try {
        if (source === frames[i].contentWindow) return frames[i];
      } catch (_) {
        /* cross-origin contentWindow access can throw — skip that frame */
      }
    }
    return null;
  }

  /** The origin of a frame's `src`, or null when it has none worth answering. */
  function srcOrigin(frame) {
    // No src (a srcdoc frame, say) is no form of ours: it would resolve to this page.
    if (!frame.src) return null;
    try {
      var origin = new URL(frame.src, window.location.href).origin;
      return origin && origin !== 'null' ? origin : null;
    } catch (_) {
      return null;
    }
  }

  /** One cookie of this page, or null. Read only: this script never writes one. */
  function readCookie(name) {
    var parts = String(document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      var key = (eq < 0 ? parts[i] : parts[i].slice(0, eq)).replace(/^\s+|\s+$/g, '');
      if (key === name) return eq < 0 ? '' : parts[i].slice(eq + 1).replace(/^\s+|\s+$/g, '');
    }
    return null;
  }

  /** The HubSpot portal whose tracking code runs on this page, or null. */
  function hubspotPortal() {
    var vars = window.hsVars;
    if (vars && vars.portal_id != null && DIGITS.test(String(vars.portal_id))) return String(vars.portal_id);
    var loader = document.getElementById('hs-script-loader');
    var match = loader && loader.src ? /\/(\d{1,20})\.js(?:[?#]|$)/.exec(loader.src) : null;
    return match ? match[1] : null;
  }

  /** This page, as it is right now, for the frame that asked. */
  function pageContext(id) {
    var reply = {
      type: 'dapta-forms:context',
      id: id,
      v: 1,
      pageUri: String(window.location.href),
      pageName: String(document.title || ''),
    };
    var vars = window.hsVars;
    if (vars && vars.page_id != null && DIGITS.test(String(vars.page_id))) reply.pageId = String(vars.page_id);
    var portal = hubspotPortal();
    if (portal) reply.hsPortalId = portal;
    var optedOut = readCookie('__hs_opt_out') === 'yes' || readCookie('__hs_do_not_track') !== null;
    var hutk = readCookie('hubspotutk');
    if (!optedOut && hutk && HUTK.test(hutk)) reply.hutk = hutk;
    return reply;
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data) return;

    if (data.type === 'dapta-forms:resize') {
      if (typeof data.height !== 'number') return;
      if (!isFinite(data.height) || data.height <= 0) return;
      var frame = isOurFrame(event.source);
      if (!frame) return;
      frame.style.height = Math.min(Math.ceil(data.height), MAX_HEIGHT) + 'px';
      return;
    }

    if (data.type === 'dapta-forms:scroll-into-view') {
      var target = isOurFrame(event.source);
      if (!target) return;
      var top = target.getBoundingClientRect().top;
      var viewport = window.innerHeight || document.documentElement.clientHeight;
      if (top >= 0 && top < viewport) return; // its top is already on screen
      var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      try {
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      } catch (_) {
        target.scrollIntoView(true); // browsers without the options object
      }
      return;
    }

    if (data.type === 'dapta-forms:context-request') {
      if (data.v !== 1 || typeof data.id !== 'string' || !data.id || data.id.length > 64) return;
      var asking = isOurFrame(event.source);
      if (!asking) return;
      var origin = srcOrigin(asking);
      // The frame must still show what its own src loaded: one that navigated
      // elsewhere is not our form any more, and gets nothing.
      if (!origin || event.origin !== origin) return;
      var off = asking.getAttribute('data-dapta-forms-context') === 'off';
      try {
        var reply = off ? { type: 'dapta-forms:context', id: data.id, v: 1, off: true } : pageContext(data.id);
        event.source.postMessage(reply, origin);
      } catch (_) {
        /* the frame is gone; it saves without the page */
      }
      return;
    }

    if (data.type === 'dapta-forms:redirect') {
      if (leaving) return;
      if (typeof data.url !== 'string' || !HTTP_ONLY.test(data.url.trim())) return;
      if (!isOurFrame(event.source)) return;
      leaving = true;
      // Answer BEFORE navigating. The frame falls back to navigating the top
      // itself when no answer arrives, and two navigations of one top-level
      // document race — WebKit cancels both and the visitor goes nowhere.
      try {
        event.source.postMessage({ type: 'dapta-forms:redirect-ack' }, '*');
      } catch (_) {
        /* the frame is gone; nothing left to tell */
      }
      window.location.href = data.url.trim();
    }
  });
})();
