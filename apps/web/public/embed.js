/**
 * Dapta Forms embed helper — auto-resizes embedded form iframes.
 *
 * Drop next to any iframe carrying the `data-dapta-forms` attribute:
 *
 *   <iframe data-dapta-forms src="https://your-host/acct/handle/slug?embed=1"
 *           title="My form" loading="lazy"
 *           style="width:100%;border:0;min-height:480px;"></iframe>
 *   <script src="https://your-host/embed.js" async></script>
 *
 * The embedded page (opened with ?embed=1) posts its content height whenever
 * it changes; this script sets the matching iframe's height so the form never
 * shows an inner scrollbar. Frames are matched by `event.source`, never by
 * URL, so several forms can share one page and a message can only ever size
 * the frame it came from. Only a number crosses the boundary — no answers, no
 * identifiers — and the listener ignores anything that isn't that message.
 */
(function () {
  'use strict';

  var MAX_HEIGHT = 20000; // sanity cap — a runaway report can't blow up the host page

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'dapta-forms:resize' || typeof data.height !== 'number') return;
    if (!isFinite(data.height) || data.height <= 0) return;

    var frames = document.querySelectorAll('iframe[data-dapta-forms]');
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      try {
        if (event.source === frame.contentWindow) {
          frame.style.height = Math.min(Math.ceil(data.height), MAX_HEIGHT) + 'px';
        }
      } catch (_) {
        /* cross-origin contentWindow access can throw — skip that frame */
      }
    }
  });
})();
