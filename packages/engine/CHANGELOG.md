# @quill/engine

## 0.1.0

### Minor Changes

- 310f098: Give the question panel a hierarchy, and surface the URL prefill nobody could
  find.

  The panel was seventeen sections in one flat scroll, all weighted the same, so
  the two controls an author touches constantly sat beside the one that renames an
  answer key and cascades through every condition, goto, variant and CRM mapping.
  Conditional visibility, dynamic question, behaviour flags, the field key and
  per-question scoring now live in a collapsed **Advanced settings** group.

  **Skip-logic stays out of it.** Forward rules (`goto`) are the reason someone
  picks this over a plain form builder; burying them would hide the product's own
  argument. Show/hide conditions moved in, per the same judgement applied the other
  way: they are declarative and rarely revisited once set.

  **The badges are load-bearing, not decoration.** A collapsed group that hid a
  question being conditional, terminal or hidden would be strictly worse than the
  flat list it replaces — the author would see a clean question and have no idea it
  behaves differently. The header names what is configured inside, in the same
  vocabulary the left spine already uses, and the group opens on its own when
  anything is set.

  **URL prefill existed and was invisible.** `capturePrefill` already seeds any
  declared field key from the query string, visible questions included — the
  runtime has done this all along. What never existed was any way to learn that the
  parameter _is_ the field key. The new row states it and shows a copyable example
  built from the question's own type and options, so a choice question does not
  demonstrate itself with an email address. A `name` step shows both of its
  subfield parameters, because showing one would be wrong. A key beginning `utm_`
  gets a warning instead of an example: those are captured separately as campaign
  data, so prefill silently does nothing for them.

  **New: a default answer.** `defaultValue` on a step, seeded by `captureDefaults`
  in both renderers with the precedence `default < URL < what the person types`. A
  campaign link carrying `?email=` has to beat a default the author set months
  earlier, or the link would quietly do nothing. `name` and `scheduler` steps take
  none — one writes two subfields, the other's answer is a booking.

  The per-question HubSpot mapping leaves the panel. The Connect tab already
  carries the full mapping with auto-map, custom rows and value maps; two places to
  set the same thing is how they drift apart.

- bb7077e: An authorable promo banner, a reveal screen with a look, and client logos that
  can leave the cover.

  `cover.bannerColor`, `cover.bannerTextColor` and `cover.bannerSize` give the
  promo strip a fill, a text colour and one of three heights. Absent on any axis
  keeps the derived tint and padding the stylesheet has always applied.

  `formRevealSchema` gains a presentation: `loader` picks the animation
  (`spinner` — the default and the existing look — `bar`, `versus`, or `none`),
  `loaderSize` and `textSize` scale the mark and the copy across four steps,
  `accentBackground` floods the screen with the form's accent, and
  `versusYouLabel` / `versusMatchLabel` / `versusStatusLabel` name the two sides
  of the `versus` layout and the live status under the match. The new pure helper
  `resolveRevealPresentation` owns the defaults so the builder canvas and the
  public renderer cannot disagree about them. The `md` mark is pinned to the size
  this screen has always drawn, so an unconfigured reveal — and every form's
  submitting screen, which shares the same spinner — is unchanged.

  `cover.clientLogosScope` chooses where the "trusted by" marquee renders: the
  cover (absent — every existing config, and the only place it has ever shown),
  the reveal interstitial, or both. Resolved by the new pure helper
  `showClientLogosOn`, which keeps the existing `showClientLogos` master switch
  deciding first.

  **Behaviour change:** the one-page (`vertical`) layout now honours
  `cover.showClientLogos`. It previously ignored the toggle entirely, so a stored
  config with `layout: 'vertical'` and `showClientLogos: false` was still showing
  its marquee; after this it is hidden, as the slides layout already did.

  `@quill/shared` also exports `blendHex`, the TS twin of CSS `color-mix`, so the
  editor can run a contrast readout against a surface the stylesheet derives
  rather than stores.

- 310f098: Two new cover toggles, and an editor topbar that stops overflowing.

  `cover.bannerScope` chooses where the promo banner renders — every screen (the
  default, and what every existing config keeps doing) or the cover alone.
  `cover.showClientLogos` switches the "trusted by" marquee off without deleting
  the logos; only an explicit `false` hides it, so existing configs still show
  theirs. Both are additive optional fields, resolved by the new pure helpers
  `showBanner` and `showClientLogos`.

  The editor topbar no longer wraps its controls onto a second line or pushes
  Publish off-screen: the form-name input is now the bar's only elastic child,
  and the tab labels, link labels and publish pill each reveal at the width where
  they actually fit rather than all at once.

- e877d55: Feedback round (V2): graceful variable interpolation (sweeps orphaned
  punctuation when a `[field]` resolves empty); country-code phone input
  (bundled ISO 3166-1 data + E.164 value + subscriber-digit validation);
  branded admin dropdown combobox; account-level integration connect flow with
  AES-256-GCM encrypted-at-rest token storage (`account_integration` table,
  migration 0004, per-account token resolution with env fallback); Typeform-style
  per-form HubSpot mapping with smart auto-map; editable notification email
  templates (subject/body with `{{token}}` interpolation, escaped); webhook
  per-event triggers (`events: partial|complete`); soft banner styling; HubSpot
  booking-embed fallback.
- 59f1bbf: Feedback round (V3): authored step order is now authoritative at runtime —
  `runtimeSteps` no longer partitions steps into qualification-first /
  lead-capture-last, so the public form renders questions exactly as ordered
  in the editor (`flowGroup` continues to drive scoring exclusion only).
  Per-form email template overrides: `notification_setting` gains a nullable
  `form_id` (migration 0005, partial unique indexes on both dialects), repo
  helpers accept a form scope, and resolution merges form → account → stock
  per field. Shared i18n grows catalogs for the editor Connect tab (tracking
  pixels UI), guided HubSpot mapping copy, branded confirm dialogs, the @
  token picker, per-form email overrides, and localized name-step placeholder
  defaults (EN + ES).
- 310f098: A real design system for a form, replacing a single accent color.

  `branding` gains fifteen optional axes — `background`, `foreground`,
  `backgroundStyle`/`backgroundImage`/`backgroundOverlay`, `fontFamily` +
  `customFont`, `radius`, `buttonStyle`, `buttonFullWidth`, `progressStyle`,
  `logoSize`, `logoPosition`, `contentAlign`, `contentWidth`, `transition` — plus
  `themePreset` (editor bookkeeping) and `ogImage`. Every one is optional and
  resolves, when absent, to the look the renderer already had: `resolveDesign`
  keeps that mapping in one frozen table (`LEGACY_FORM_DESIGN`) so no published
  form changes appearance, pinned by tests.

  `resolveDesign` and `designAttributes` (`@quill/engine/form-design`) are the
  single answer to "what does this form look like", shared by the public renderer,
  the live preview and the builder canvas. Two axes are cross-validated rather
  than trusted: an `image` background with no usable URL falls back to `solid`,
  and a `custom` typeface with an incomplete source falls back to the brand face,
  so a combination that renders as a blank page cannot be reached even from a
  hand-edited config.

  **Colors are rendered exactly as chosen — nothing is corrected.** `formThemeVars`
  paints the author's color everywhere, because a silently substituted color reads
  as a bug: you set lime, the page shows olive, and nothing you click explains it.
  Legibility is handled where the author can act on it, in the editor: risky pairs
  are measured and warned about, with `suggestReadable` offering a readable
  alternative in one click, and the decision stays theirs. The only derived value
  left is the label ON a solid accent, since nobody picks the color of button text.

  Nor is any text accent-coloured. Three rules used to be — the cover eyebrow, the
  slider's value, and the dot after the form name — which meant a bright or pale
  brand color silently erased whatever it was applied to. The accent is now only
  ever a fill or a border, so the whole class of problem is gone rather than warned
  about.

  **Bug fixed in `@quill/shared`'s color math:** `clampAccent` took no background
  and always lightened toward white, which was correct only because the public
  form was always dark. On a light ground it pushed a pale color further into
  unreadable and then reported it as safe. The corrected walk (ground-aware
  direction) now lives in one place and backs both `clampAccent` and
  `suggestReadable`. `accentWasAdjusted` is removed — the render path it served no
  longer exists.

  New: `suggestReadable`, `contrastRatio`, `contrastGrade`, `isLightColor`,
  `readableOn`, `resolveThemeMode`, and `formThemeVars`, which derives the
  supporting tokens (card, muted, border) by mixing the author's ground toward
  their text — so an arbitrary background gets a coherent palette instead of a
  fixed light or dark one.

  Setting a background LOCKS the form's theme: it stops following the visitor's
  light/dark preference. A page cannot honour both an author's chosen palette and
  an OS setting without one of them being wrong, and the author is the one who saw
  the result.

- 310f098: Say why a HubSpot sync cannot work, and let an author test a webhook without
  waiting for a respondent.

  **A form with no email address silently never syncs.** HubSpot's upsert is keyed
  on email — it matches a contact by address and creates one when there is none —
  so a submission that carries no address arrives with nothing to identify. That
  delivery resolves as a permanent no-op: no error, no retry, no contact, and
  nothing an author would ever look at. The editor now says so while the form is
  being built, before any lead is lost. New pure helper `emailSourceFor(config)`
  returns where an address could come from: an `email` question (a hidden one
  counts — it still captures `?email=`), else a scheduler, since Calendly collects
  the invitee's address at booking. A question wins over a scheduler because it
  does not depend on anyone booking.

  The Connect tab also explains what the sync actually does. "Map a question to a
  property" never told anyone the contact is matched by email and created when
  absent, which is the single rule that decides whether a lead lands.

  **Webhook test delivery.** A new admin-only endpoint posts one sample body to the
  form's configured webhook — the real payload shape with sample answers built
  from the form's own steps, signed the same way, carrying `test: true` and a
  `test-submission` id so a receiver cannot mistake it for a lead. It runs through
  the real `WebhookDestination`, which is the point: an endpoint that makes the
  SERVER fetch a URL the USER supplied is the textbook internal-network probe, and
  reusing the adapter means the SSRF guard cannot be forgotten. Private, reserved
  and cloud-metadata addresses are refused with no request leaving the process.
  Loopback is permitted only when the stored hostname is literally `localhost` —
  the same carve-out the URL validator makes for a local catcher — so an https
  host that merely resolves to 127.0.0.1 stays blocked.

  New `admin.integrations` strings in EN and ES for the email gate, the sync
  explanation, and the test button.

- de8df64: Add `config.logicLayout` — builder-only node positions for the Logic canvas,
  keyed by step key.

  Additive and optional, so every existing config keeps parsing and every
  published form renders identically. The engine and both renderers ignore it
  entirely: nothing about how a form RUNS may depend on where its author dragged a
  box. An absent entry is the normal case — the canvas lays itself out from step
  order, and a stored position is only ever an override of that.

  Because the key is a step key it is a POINTER, and both places that move
  pointers now move it too: `renameStepKey` carries a position across a rename,
  and `normalizeConfig` remaps it through the same rename map as `goto[].target`
  and prunes entries whose step is gone. Without that a rename or a delete would
  leave a node pinned to coordinates its step no longer occupies — the exact kind
  of stale lie the canvas exists to remove. Coordinates are validated `.finite()`
  so a NaN can never reach the config and fail the whole form's autosave.

- 0124b1c: Map a booking's own fields from the question panel. A scheduler step answers with
  a booking — the meeting time under its own key, the invitee's name and phone under
  theirs — but the builder offered one unlabelled "Map to" picker that bound only
  the first of those and never said which. `bookingFieldsFor` names the whole set so
  the question panel and the Connect screen read one list.
- 310f098: Choice questions can now render their options as a card grid, on purpose.

  The grid already existed but was reachable only through `showIcons`, a flag no
  editor control ever set — so in practice only the seeded demo form had it. It is
  now `optionLayout: 'list' | 'cards'`, chosen from a "Show options as" toggle on
  the question. `showIcons` is deprecated and still read as the fallback by the new
  `resolveOptionLayout`, so a config saved before this keeps its grid.

  Each option's `icon` may be an emoji or an image URL, and the two are rendered
  differently rather than identically: `isImageIcon` tells them apart, a glyph
  centres in a circle, and an image gets a rectangle it letterboxes into with
  `object-fit: contain` — so a wide logo is no longer cropped to its middle by a
  circular mask. A broken image URL falls back to the glyph treatment instead of a
  torn-image box. The icon cap grew from 64 to 512 characters to fit a real CDN
  URL, and any icon that looks like an image must also pass `isSafeImageUrl`.

  Uploading an image is not part of this — icons are an emoji or a URL, matching
  how the form logo and client logos already work.

- 310f098: Finishes the option-card work: a real icon picker, centred cards, a canvas that
  matches the chosen layout, and logos confined to cards.

  The Icon field was a raw text box, which told an author nothing about emoji or
  initials being valid — so it only ever received URLs. It is now a picker with a
  tab per kind: an emoji library (a curated local set, no new dependency), one or
  two letters, and an image URL.

  `resolveOptionIcon` becomes the single answer to "what do I draw for this
  option", shared by the public renderer, the builder canvas and the live preview
  so the three cannot disagree. It also enforces that images are card-only: in a
  list an image URL degrades to the label's initials rather than rendering as a
  sliver, which means an already-saved list+URL config can't show the broken
  combination either. The editor matches by dropping the Image tab under List.

  Cards are laid out with wrapping centred flex instead of a fixed three-track
  grid, which had stranded a single card in the left third and pinned two cards to
  the left edge. Any count now centres, and the per-row count adapts to the width.

  `optionInitials` supplies the fallback glyph: up to two letters from the first
  two words ("HubSpot Sales" → "HS", "Hubspot" → "H").

- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
- 91847eb: Give a form two independently editable logos. `resolveFormLogos` resolves the
  form's own logo (`branding.logo`) and the cover screen's (`cover.logo`) as
  separate axes, where `null` means "show none" and an absent value inherits — so
  clearing a logo removes it instead of falling through to the other surface's,
  and a logo snapshotted from a workspace brand kit is finally visible and
  editable from the Design tab. Configs written before this render unchanged.
- d1e9944: Retune the platform's default look, and make the light theme a real one.

  **Tokens.** The accent now has three jobs and three values instead of one:
  `--primary` is the FILL, `--primary-ink` the LETTERS, `--primary-edge` the LINES.
  That third one is what the light theme was missing — the raw lime measures 1.27:1
  on paper, so every border, focus ring and selected outline drawn with it was an
  indicator nobody could see. `formThemeVars` now emits `--pf-primary-edge` for an
  authored form too, clamped only when the author's colour would have been
  invisible: a colour that already reads is passed through untouched, exactly like
  `--pf-primary` itself.

  `--faint` gains a real value on dark (it measured 4.28:1 on `--muted`, under AA
  for the 10px it carries) and `--brand-ink` / `--brand-ink-foreground` arrive as
  the one pair in the file that does NOT flip with the theme — a ground for fixed
  colour third-party artwork, which cannot follow a scheme it does not know about.

  The dark block is now `:root, [data-theme='dark']` rather than `:root` alone. One
  declaration, no second copy, and it makes the palette re-establishable on a
  SUBTREE: that is what lets a public form pin itself to the product default inside
  an admin document that chose light.

  **Engine.** `DEFAULT_FORM_FONT` moves to Figtree, and `FORM_FONTS` swaps `visby`
  for `figtree`. The retired value never left an unpushed branch, so no stored
  config references it. The list may only ever hold freely-redistributable faces —
  `next/font` bakes every curated face into the build and therefore into the
  repository, so a licensed commercial face cannot be a member of this union no
  matter how well it reads.

  **Db.** The seeded demo form's accent stops being stock Tailwind indigo. Its job
  is to show that a form carries its OWNER's brand, and the colour nobody picked
  made the largest saturated object on the builder screen look like an unstyled
  default sitting next to our own Publish.

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- d85aeb5: A `url` question type: a single-line input that only accepts a web address.

  It sits in the builder's Text group ("Website"), between long text and the
  slider. It is not a contact field: `LEAD_CAPTURE_TYPES` and `isContactType` are
  unchanged, it lands in the qualification flow group, and it does not score.

  Validation is a pure regex, no `new URL`, so the engine stays free of platform
  APIs and both apps agree on the verdict. `acme.com`, `www.acme.com/x?y=1`,
  `https://acme.com:8443/p` and `http://x.io` pass; `acme`, `ftp://acme.com`,
  `javascript:alert(1)`, `https://` and `acme .com` are rejected with the new
  `url` validation code (`renderer.errors.url` in the catalog, en + es). Empty is
  still the required check's job, as for every other type.

  The stored value always carries a scheme. `normalizeUrl(raw)` trims and prepends
  `https://` when no `http(s)://` prefix is present (idempotent), and
  `canonicalizeAnswer(step, value)` applies it to `url` answers that pass the
  validator (a typo like `acme` stays as typed, so the error is about what was
  written) and is the identity for everything else. The public renderers call it at their commit
  points, right before `validateAnswerCode`, so the Enter path and the button path
  hand the same shape to the engine, the partial save and the CRM, and a HubSpot
  `website` property receives a full URL. `createEmptyStep('url')` seeds the
  placeholder `https://` to hint at that shape.

- 310f098: Forms can now render as a single vertical page, not only as slides.

  `config.layout: 'slides' | 'vertical'` (additive — absent means `'slides'`, so
  every published form renders exactly as before; `resolveFormLayout` is the one
  place that default lives). The vertical renderer walks the same pure engine
  (`runtimeSteps` recomputed on every answer), so skip-logic, goto jumps, dynamic
  question variants and branch closing all apply live on the one page.

  Layout-specific behavior: the cover renders as a hero header (no Start gate,
  its CTA text is unused), reveal steps never play mid-page (one reveal plays
  after Submit, before the result), a terminal step with an answer hides
  everything after it instead of auto-submitting, schedulers embed inline and
  lazy-mount near the viewport, and validation is inline on blur plus a
  submit-time sweep that scrolls to the first invalid question.

  Funnel events keep their metric semantics across layouts: `step_view` fires
  when a question enters the viewport (index 0 on load matches a cover-less
  slides form, so Starts stays comparable), `step_complete` when a question first
  holds a valid answer, `partial_submit` when the threshold answer becomes valid.

  The builder follows: a layout picker in the create dialog and the Design tab,
  the canvas drops the per-step progress bar and Next button on vertical, the
  cover CTA field is replaced by a note, the reveal switch explains where it
  actually plays, and the Design-tab preview sketches the one-page shape.

### Patch Changes

- d58e464: Scoring rejects an array answer where the form asks for one choice.

  A choice step that is not multi-select used to score every element of an array
  answer, and a repeated token was counted once per occurrence, so a crafted or
  replayed answer could inflate the total and land the respondent in a higher
  outcome bucket. `validateAnswer` now refuses an array on a single-choice step
  and refuses repeated tokens on any choice step, and `optionPoints` returns zero
  for that shape and dedupes tokens before summing. Stored configs are untouched;
  a recomputed score for an affected submission can move down.

- 505df64: `resolveEnding`: the redirect delay now inherits from the form-level ending only
  when the redirect URL itself was inherited. An outcome that brings its own URL
  with no delay of its own resolves to 0 (redirect immediately) — which is what
  the outcomes dialog has always displayed for an untouched field. Previously the
  form-level delay leaked under an outcome-level URL, so the public form held the
  thank-you screen that the editor said it would skip; a delay orphaned by a
  cleared form-level URL leaked the same way.
- cf9eb95: Let an outcome carry the range it covers, instead of implying it.

  An outcome stored only where it STARTED. Its end was read off whichever
  neighbour started next, so a range was never something an author typed — it was
  something they inferred, from a badge on the far side of the row they were
  editing, showing a number derived from a different row. Widening a range meant
  changing someone else's threshold, and two ranges could quietly claim the same
  score, leaving one of them dead with nothing on screen saying so.

  `formOutcomeSchema` gains an optional integer `maxScore`: the inclusive upper
  bound. Absent means the range runs open-ended upwards, which is exactly how
  every stored range behaved before the field existed. `resolveOutcome` reads the
  STORED bound and never a derived one, so a config carrying no `maxScore` at all
  resolves to the same outcome it always did — pinned by a test, because that is
  the whole back-compat claim. The top range is meant to stay unbounded: something
  has to catch a score above every ceiling.

  Adds three pure helpers to `@quill/engine`, so the several screens that draw a
  range stop each deriving it for themselves:

  - `outcomeRanges` — the span each outcome covers, filling in the implicit end
    for configs written before `maxScore`. Order-independent: the implicit end is
    the smallest start above this one, not "the next array element".
  - `overlappingOutcomes` — indexes whose span collides with an earlier one. Never
    a legitimate state: only one outcome can win a score, so the other is dead.
    Ranges with no explicit bounds tile by construction, so no already-stored form
    starts reporting one.
  - `outcomeGaps` — scores between the ranges that match nothing. A real choice
    (those respondents see the form's own ending), so it is reported and not
    refused. It invents no floor below the lowest range; scores go negative and the
    bottom of the scale is not this function's to guess.
