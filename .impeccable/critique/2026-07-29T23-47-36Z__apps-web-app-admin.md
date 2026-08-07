---
target: Dapta Forms admin platform (overall design)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-07-29T23-47-36Z
slug: apps-web-app-admin
---
Method: dual-agent (A: design review · B: detector + measured browser evidence)

Scope: 11 admin routes × 2 themes (dark/light) × 2 viewports (1440×900, 390×844) = 44 page runs, plus a public-page cross-check. Mode: **Operate**.

## Design Health Score — 24/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Every selected state is a sub-1.2:1 wash. Active sidebar nav `#e9edf1` on `#ffffff` = **1.18:1** light; active builder tab **1.14:1** dark. "Where am I" is the weakest signal in the app. |
| 2 | Match System / Real World | 3 | Drop-off table prints `−5 (100%)` — a negative count with a positive percentage. No mental model of drop-off is negative. |
| 3 | User Control and Freedom | 3 | Risk model inverted: deleting one draft form opens a confirm dialog; "Apply to selected" writes the brand kit to **live published forms** with no confirm. |
| 4 | Consistency and Standards | 2 | Declared system ≠ built system. `text-faint`: **0 uses** vs 389 `text-muted-foreground`. `--radius-monitor: 16px` documented for cards, admin cards use 10px. 23 type combos, 6 radii, 3 off-scale spacing families. |
| 5 | Error Prevention | 2 | In light mode lime is **1.27:1** on page / **1.37:1** on card. Selection and primacy stop being perceivable — including which date range is active. |
| 6 | Recognition Rather Than Recall | 1 | At 1440px the builder shows **12 unlabeled icons at once**. Mode-tab labels gated at 1536px while the four *secondary* actions keep theirs. Priority inverted at the most common laptop width. |
| 7 | Flexibility and Efficiency | 2 | Forms list has no search, sort, filter, bulk action, submission count or status. No screen compares two forms. No surfaced shortcuts. |
| 8 | Aesthetic and Minimalist Design | 3 | Real restraint — 0 shadows, 0 gradients, one hairline, one accent, **0 true detector findings**. Docked for the 546×44 indigo button and two routes that are ~690px of void around one card. |
| 9 | Error Recovery | 3 | Toasts carry real messages; save-status dot explains *why* a save failed. **0 console errors across 43 of 44 runs.** Docked for unframed empty states. |
| 10 | Help and Documentation | 3 | Good sub-copy under nearly every heading. Docked for **13 ⓘ affordances at ~12px** on one panel — help at that density is noise. |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment: ~25% authored for a forms product, 75% category-interchangeable. The palette is a brand decision; the composition underneath it is still the stock dashboard template.**

Three things are genuinely authored and could not be lifted into another product: the **question spine** (numbered rows, per-type icons, "Partial submit point" promoted to a first-class row *inside* the sequence), the **live canvas with Desktop/Mobile**, and the **per-question drop-off table keyed to real question text**.

Structural sameness is measurable: `/admin/submissions` and `/admin/analytics` are byte-identical in every captured metric — 69 visible elements, 13 interactive, same `maxW=1520 padX=32 padY=40`, one card, one lime link. Two of seven top-level destinations are the same screen with a different `<h1>`.

**Biggest missed chance:** the funnel is this product's identity and it is drawn twice as two unrelated widgets — a vertical numbered spine in the builder, a generic 3-column table in analytics. Those should be one object.

**Second: the two-voice type system is declared and then not used for the thing it exists for.** `lib/fonts.ts` states Martian Mono carries "metric values". Measured mono elements: `form-analytics: 0`, `edit: 0`, `home: 1` (a URL). All 19 `font-mono` call sites are URLs, slugs, `{{tokens}}`, hex — **not one is a number.** Settings is the only page doing it right (16 mono elements) and it proves the idea works.

**Deterministic scan:** `detect.mjs` over `apps/web/app/admin` + `apps/web/components` → exit 2, **1 finding, and it is a false positive**: `broken-image` matched the literal string `<img>` inside the JSDoc prose at `components/ui/provider-logo.tsx:4`. That file renders inline `<svg>` and ships no `<img>`. Net **0 true deterministic findings** — the code is clean by the mechanical rules; every real problem below is a measurement or a judgment, not a lint.

**Visual overlays:** not attempted — Assessment B gathered measured computed-style evidence across 44 runs instead, which is stronger than an overlay for the contrast/geometry questions asked here. No user-visible overlay exists.

**Two more false positives worth recording** so they are not re-litigated: the two `1.00:1` contrast pairs on `/edit` are `_components/token-textarea.tsx:408` deliberately painting `color: transparent` over an `aria-hidden` mirror layer that carries the visible glyphs (which measure 15.7:1 and 19.08:1). And the black "N" disc bottom-left of every screenshot is `<nextjs-portal>`, the dev indicator, not product UI.

## Overall Impression

The token layer is professional and the dark theme is genuinely well-built — text contrast runs 5.9:1 to 16.6:1 with **zero pairs within 0.7 of threshold**, and the accessibility semantics under the shell (global focus ring, `sr-only` labels surviving rail collapse, a fully-specified modal drawer with `inert` + focus move + scroll lock, `aria-current` on tabs, `prefers-reduced-motion`) are better than most shipped apps.

What's wrong is that **the system is declared at four steps and used at two.** The four-tone text ladder runs on two tones. The four-surface ladder separates at 1.03–1.08:1. The 11-step type scale has nothing in regular use between 18px and 14px. The light theme is that same compression applied to three near-identical whites, and there the accent stops existing.

**Single biggest opportunity:** the light theme needs its own accent fill and heavier hairlines, or it should not ship. Right now Publish is invisible in it.

## What's Working

1. **The restraint is real and rare.** Zero shadows, zero gradients, one hairline used 52× on the editor, one accent. Dark-theme text contrast: `#e8edf2` on `#101418` = 15.7:1, `#93a1ae` = 7.0:1, lime = 13.5:1, Lime Ink on lime = 14.2:1. Composing the accent from `--acc-h/s/l` and pinning the whole radius ladder rather than one step is correct systems thinking.
2. **Focus is present on every single stop.** 108 measured focus stops across 4 routes, both themes: **0 elements with no visible indicator.** Tab order linear and matching visual order. The problem is the ring's *colour* in light mode, never its absence.
3. **The question spine is the best-designed object in the product.** Numbered rows, per-type icons, a "Contact" sub-chip on the email step, "Partial submit point" as a distinct dashed row in sequence. It communicates the form's shape at a glance. Build outward from this.

## Priority Issues

### [P0] Publish is clipped off-screen on mobile with no way to scroll to it
`apps/web/app/admin/forms/[id]/edit/form-editor.tsx:501,503`

The editor header measures `scrollWidth 425 / clientWidth 390` with `overflow-x: visible`, inside a `div.flex.h-[100dvh].overflow-hidden` shell. Publish sits at `x=348 → 425`:

| viewport | px past the right edge | % of button hidden |
|---|---|---|
| 360px | 65 | **83%** |
| 390px | 35 | **45%** |
| 414px | 11 | 14% |

The document does not scroll (`scrollWidth === clientWidth` on all 44 runs), and no ancestor scrolls, so the hidden portion is unreachable. The button reads "Pub".

**Why it matters:** the one action that makes an author's work public is physically unreachable on a phone. Same failure at 200% desktop zoom (SC 1.4.10).

**Fix:** `overflow-x: auto` on the header **plus** collapse Copy link / Embed / Open form into one "Share ▾" below `lg` so the bar's intrinsic width fits 390px. Hiding labels at each breakpoint has run out of room — three of those five actions are the same job ("get the link").

**Suggested command:** `/impeccable adapt`

### [P0] The lime accent does not exist in light mode
`packages/shared/src/tokens.css` — `--primary` is unchanged across themes

| pair | ratio | needs |
|---|---|---|
| lime fill vs page `#f4f6f8` | **1.27:1** | 3:1 (WCAG 1.4.11) |
| lime fill vs card `#ffffff` | **1.37:1** | 3:1 |
| focus ring `rgba(167,188,26,.5)` flattened vs page | **1.39:1** | 3:1 |
| focus ring vs card | **1.44:1** | 3:1 |
| active nav chip `#e9edf1` vs `#ffffff` | **1.18:1** | 3:1 |

That fill is Publish, Save brand kit, Create form, Connect, Continue **and the selected date-range pill**. B measured **13 distinct light-theme focus stops below 3:1** across 4 routes; dark theme had **0 of 108**.

**Why it matters:** in light mode primacy and selection both stop being perceivable. `tokens.css:54-62` already solved exactly this for `text-primary` by adding `--primary-ink` at 26% lightness — the same reasoning was never applied to the fill or the ring.

**Fix:** add `--primary-fill` for light at ~42–46% lightness with `--primary-foreground: #fff` (clears 3:1 as a shape, 4.5:1 for its label); point the ring at it too; lift light `--border` from `.14` to ~`.22` alpha and light `--muted` from `#e9edf1` to ~`#dfe4ea`.

**Suggested command:** `/impeccable colorize`

### [P1] Hierarchy: the stat value ties the page title, and the scale has no mid-range
`apps/web/app/admin/page.tsx:52` (`text-3xl font-semibold`) vs `:87` (same)

Four elements on `/admin` render at `30px/600` — the `<h1>` *and* all three stat values. App-wide: **23 size/weight/family combinations, 11 distinct sizes** (10/11/12/13/14/15/16/18/23/28/30). Ratios go 30→18 = 1.67×, then 18→14→12→11→10 = 1.29/1.17/1.09/1.10.

Four steps crammed inside 10–14px where they're indistinguishable; **nothing in regular use between 18px and 14px**, where the eye needs resolution. Plus: 28px and 30px are two display steps 2px apart; 11px carries **three different line-heights** (16.5px ×36, 17.875px ×1, 13.75px ×1); 13px and 23px each appear once.

**Why it matters:** this is the root cause of "title, then grey flatland" on every page.

**Fix:** collapse to six steps — 30 / 20 / 16 / 14 / 12 / 10 — and make the middle real: section heads 20px, card heads 16px (currently absent), body 14px. Drop stat values to 24px so the `<h1>` wins, **and set every number in Martian Mono with `tabular-nums`** — that one change makes the type system's premise visible and fixes the specificity gap at the same time.

**Suggested command:** `/impeccable typeset`

### [P1] The declared four-step ladders are two-step ladders
`packages/shared/src/tokens.css` + `apps/web/app/globals.css`

- `--faint` / `text-faint`: **0 call sites** against 389 `text-muted-foreground`. The four-tone text ladder built to fix a two-tone scale is still two-tone — metadata, labels and body all land on `#93a1ae`.
- Editor surface census: `#0a0c0e`×27, `#101418`×9, `#0d1013`×1, `#161c22`×1. Adjacent surfaces separate at **1.06:1 / 1.08:1 / 1.03:1**.
- **Every border pair in the app is under 3:1, both themes** — 1.27–1.33:1. In the subset that matters most, the border is the *sole* boundary of a form control: the three Settings inputs and three textareas have `background === container background` (`#101418` on `#101418` dark, `#ffffff` on `#ffffff` light), so a 1.31/1.33:1 hairline is the only edge. That is a WCAG 1.4.11 hit, not a taste call.
- Light `--faint` on `--muted` = **3.84:1** — ships failing AA before anyone uses it.

**Fix:** push the quietest tier (`Updated 7/29/2026`, `#1`–`#5`, ⓘ hints, timestamps) to `text-faint`; raise light `--faint` to ~`#5d6a76`; lift borders as in P0; give inputs a surface one step off their container.

**Suggested command:** `/impeccable layout`

### [P1] The builder's primary IA is five 32×24 unlabeled icons with a 1.14:1 active state
`apps/web/app/admin/forms/[id]/edit/form-editor.tsx:545-560`

Build / Logic / Connect / Results / Design are 12px icons in 32×24 boxes; labels `sr-only` until 1536px; active state `bg-muted` = **1.14:1** dark, 1.18:1 light. Meanwhile Preview / Copy link / Embed / Open form keep text labels at 1440px. Builder touch targets: **88 of 126 interactive elements under 44×44 (70%)** on desktop, 78 (62%) on mobile — smallest are 12 ⓘ buttons at **14×14** and 4 delete buttons at **12×24** whose colour is `text-muted-foreground/0` (alpha 0 until hover).

**Fix:** move labels to `lg`, merge the three link actions into "Share ▾" to pay for the space, raise tabs to 32–36px, and mark active with a 2px lime underline (a 14:1 signal) instead of a 1.14:1 wash.

**Suggested command:** `/impeccable layout`

### [P2] Spacing has no grid, and one off-scale value carries 98 elements
Nine distinct gap values on one screen — 8px(158), 12px(99), 4px(84), **6px(66)**, 16px(26), **2px(16)**, **10px(16)**, 24px(10), 20px(4). Padding adds **10px on 98 elements** (the sidebar nav row) — the single most-used off-scale value in the app. Margins add authored 1.5px (×14) and 2px (×6).

6px vs 8px cannot be read as "different group", so proximity stops carrying grouping at all. Radius has the same problem in miniature: 6 distinct values where 10px carries **640 of 972** corners, 20px appears on exactly 4, and a stray 4px ×52 sits outside the pinned 6/10/12/16/20 ladder.

**Fix:** commit to 4/8/12/16/24 and retire 2, 6, 10, 20. Normalize the 4px bar pills to `rounded-sm`; promote admin cards to `rounded-xl` so `--radius-monitor` means something.

**Suggested command:** `/impeccable layout`

### [P2] `--primary-foreground` is a constant, so a configured accent can ship a failing label
`packages/shared/src/tokens.css:52` + `packages/shared/src/branding.ts`

The seeded demo form sets `primaryColor: '#6366f1'` (`packages/db/src/demo-form.ts:35`). Lime Ink `#0c0e07` on that indigo = **4.35:1**, failing AA for its 14px/600 label — measured identically in the builder preview and on the real public page, both themes.

`onAccent()` picks the better of two fixed inks (near-black vs near-white). For a mid-luminance accent like `#6366f1` **neither clears 4.5:1**, so "better of two" returns a failing pair and reports nothing. The editor has the machinery to catch this (`accentLabelContrast`, `suggestReadable`) — it just isn't consulted for the label, only the fill.

**Fix:** have `onAccent` walk the chosen ink away from the accent until it clears 4.5:1 (the `nudgeUntilReadable` already in that file), rather than choosing between two constants. And change the demo form's accent — a brand-new form's default reading as "unstyled Tailwind indigo" is its own problem: the largest saturated object on the builder screen is a 546×44 `#6366f1` button while the product's own accent is a 78×36 lime Publish.

**Suggested command:** `/impeccable colorize`

## Persona Red Flags

**Alex (power user)** — the dashboard/admin power case:
- **Forms list is a file browser, not a scoreboard.** Each 78px row carries name, `Updated 7/29/2026`, slug and **seven action controls** — but no submission count, no draft/published status, no completion rate, no last-response time, no search, sort, filter or bulk select. At 40 forms this is an unusable flat scroll, and the lime `Edit` pill repeated 40× turns the accent into wallpaper.
- **`/admin/analytics` is a picker, not analytics** — measured byte-identical to `/admin/submissions`. There is no screen where Alex compares two forms.
- **Mode switching costs a hunt every time** — 5 icons at 12px, labels hidden below 1536px, and no `role="tablist"` (the page's only `radiogroup` is "List/Cards"), so no arrow-key traversal.
- **The unpublished-changes badge collapses to a 6px lime dot below 1536px** (`publish-button.tsx:66-72`) — on a 1440 laptop the only sign your work isn't live is 6px.
- **Three duplicate "Analytics" entry points** landing on two different screens. No ⌘K, no shortcut hint in any `title`.

**Sam (accessibility)**:
- **Three separate selected-state failures in light mode** — active nav 1.18:1, active builder tab 1.18:1, active date pill 1.27:1. All need 3:1. Selection is conveyed by a difference Sam cannot resolve.
- **13 light-theme focus stops below 3:1**, because `ui/*` primitives resolve their ring to `--primary` while plain links resolve to `currentColor` (which passes at 4.8–17.6:1). Two focus systems, one of them invisible in light.
- **88 sub-44px targets on the desktop builder (70%)**; 24 on Settings; `h9 w9` = 36×36 is the app-wide icon-button size and appears on every route. Settings toggles are **38×22**.
- **Publish clipped at 390px** is also a reflow failure at 320px and at 200% zoom.
- **The whole app is one plane for a low-vision user** — adjacent surfaces at 1.03–1.08:1 behind 1.27–1.33:1 hairlines. Light mode collapses completely: four builder panels, no visible boundaries.
- Light `--faint` on `--muted` = 3.84:1 and light `--destructive` on `--muted` = 4.30:1 both fail AA as shipped.
- **Credit:** the global focus ring, `sr-only` collapsed-nav labels, `aria-current` on tabs and the fully-specified modal drawer are better than most apps ship.

## Minor Observations

- `<h1>` reads "Welcome, you@daptatech.com" — `displayName.split(' ')[0]` on an email returns the whole address at 30px/600, wrapping to two lines at 390px (`admin/page.tsx:52-54`). The email then repeats twice more on the same screen and twice on Settings.
- Mobile home truncates the shareable URL to `localhost:331…` — 14 characters of the one string the page exists to hand you.
- Three stat cards consume **430px of vertical space at 390px** to show `1 / 0 / 0%`.
- The spine header reads `6` while rendering **7** rows (Partial submit point isn't counted). Row heights ragged: 51 / 55 / 44px.
- Brand kit: three colour pickers labelled only **"Custom"** with identical grey checkerboard swatches — Background / Text / Accent exist solely as `aria-label`. "Save brand kit" is an **orphaned primary outside any card**, with a second, disabled lime primary below it. Layout is backwards for the task: fields get 663px, the **Preview** gets a 200px card above ~900px of void.
- Integrations: HubSpot shows "Already working, using the server's token" and its button still reads **Connect in full lime**, visually identical to Calendly's genuinely-unconnected Connect. Two opposite states, one treatment, two competing primaries on a page whose whole job is "which of these is set up".
- `/login` `<h1>` is 20px while every admin `<h1>` is 30px. `/admin/forms/<id>/submissions` has the app's only 500-weight heading.
- Content ends around y≈690 on a 900px viewport for Home, Forms, Submissions, Analytics and Integrations — five of eleven routes are mostly void at the default laptop height.
- One recurring `pageerror` on `/admin/forms/<id>/integrations` (which 302s to `/edit?tab=connect`): `Failed to execute 'measure' on 'Performance': '<U+200B>IntegrationsPage' cannot have a negative time stamp` — Next dev-mode instrumentation, not app code, but it only fires on the redirecting route.

## Questions to Consider

1. **If Martian Mono never sets a number, what is it for?** The system's whole claim to a second voice is "one talks, one measures" — right now it measures slugs. Put every score, point value, response count and rate in it and the type system becomes visible, or drop the second face and stop paying for the concept.
2. **Why is the funnel drawn twice, in two unrelated shapes?** If analytics *were* the spine with a drop-off bleed on each row, this product would have a signature object no competitor could copy — and you'd delete a widget instead of designing one.
3. **Should the light theme exist at all?** A four-step ladder compressed into three near-identical whites at 1.06–1.18:1, with the accent at 1.27:1. Either commit to it as its own system — real elevation, darker accent fill, heavier hairlines — or ship dark-only like the marketing site and stop maintaining a mode where Publish is invisible.
4. **Why is deleting one draft form guarded by a dialog while writing a brand kit onto every live published form is one click?** That inversion says the risk model was inherited from component defaults rather than reasoned about. What else is guarded by whichever pattern the component library happened to ship?
