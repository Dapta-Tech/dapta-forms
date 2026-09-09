/**
 * Dapta Forms embed helper — auto-resizes embedded form iframes and carries
 * their end-of-form redirect up to the host page.
 *
 * Drop next to any iframe carrying the `data-dapta-forms` attribute:
 *
 *   <iframe data-dapta-forms src="https://your-host/acct/handle/slug?embed=1"
 *           title="My form" loading="lazy"
 *           style="width:100%;border:0;min-height:480px;"></iframe>
 *   <script src="https://your-host/embed.js" async></script>
 *
 * Two messages cross the boundary, both matched to a frame by `event.source`
 * and never by URL, so several forms can share one page and a message can only
 * ever act on the frame it came from:
 *
 *   dapta-forms:resize   {height}  — the embedded page (opened with ?embed=1)
 *     posts its content height whenever it changes; this script sets the
 *     matching iframe's height so the form never shows an inner scrollbar.
 *     Only a number crosses — no answers, no identifiers.
 *
 *   dapta-forms:redirect {url}     — the form finished and its configured
 *     destination has to be opened at the TOP level, not inside the frame.
 *     Checkout pages (Stripe Payment Links above all) refuse to run framed by
 *     another site and hang on their own skeleton, so a form that redirects to
 *     one submits into nothing unless the host page navigates itself. The URL
 *     is the form's published `redirectUrl` — a static string, never built from
 *     what the visitor typed. It is allowlisted to http(s) before use, exactly
 *     as the renderer does before assigning `window.location`. This script
 *     replies `dapta-forms:redirect-ack` so the frame knows not to navigate
 *     the top as well: two navigations of one document race, and WebKit
 *     resolves that race by cancelling both.
 *
 * Anything that is not one of those two messages, in that shape, is ignored.
 *
 * WHY THE REDIRECT HANDLER EXISTS: a plain cross-origin iframe can navigate
 * its own top, so most embeds never need this message. An iframe given a
 * `sandbox` attribute that omits `allow-top-navigation` cannot — the browser
 * refuses it with nothing but a console warning, and the visitor is stranded
 * on a form that went nowhere. This script runs in the host page, outside that
 * sandbox, so it can still navigate. Keep it on the page.
 */
(function () {
  'use strict';

  var MAX_HEIGHT = 20000; // sanity cap — a runaway report can't blow up the host page
  var HTTP_ONLY = /^https?:\/\//i; // same allowlist the renderer applies
  var leaving = false; // one redirect per page — a second message is a no-op

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
