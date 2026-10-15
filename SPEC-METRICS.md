# SPEC: Dashboard metrics (Typeform parity)

> Status: **product decisions closed**, ready to implement.
> Scope: validate and fix the metrics of the dForms Results screen
> against Typeform (Views, Starts, Submissions, Completion rate, Time to complete)
> + Trends + date range filter. **Device filter: out of scope.**
>
> Backed by two audits (code + live runtime with Playwright against the
> isolated :3400 instance). Every defect below was reproduced with real
> numbers.

---

## 0. Product decisions (LOCKED)

| # | Topic | Decision |
|---|------|----------|
| 1 | **Start** | A "start" = **the session began answering**: it clicked the cover CTA (`start`) or completed at least one question (`step_complete`). Works with and without a cover. It is the denominator of Completion rate. (Until PR #40 it was "the first question was viewed", `step_view` with `step_index=0`; without a cover that gave Starts ≈ Views. See `startCount` in `packages/db/src/analytics.ts`). |
| 2 | **Completion rate** | `submissions / starts` (with the new Start). |
| 3 | **Submissions** | Only **complete** ones (`completed_at` not null). Partials remain a separate metric (`partialSubmits`). |
| 4 | **Time to complete** | **Median** of `completed_at − open`, where `open` = `created_at` of that session's `view` event (fallback `started_at`). Not the average. |
| 5 | **Views** | **Unique per session**: `COUNT(DISTINCT session_id)` of `view` events. |
| 6 | **Date window** | Each metric is filtered by **its own timestamp**: views by the time of the view, starts by the time of the `step_view idx0`, submissions/time by `completed_at`. |
| 7 | **Timezone** | **Account-level**. Phase 1: boundaries in **UTC** (server-authoritative, zero config). Phase 2: `account.timezone` field (additive migration, default UTC) configurable by the admin. |
| 8 | **Presets** | **Typeform + Custom**: All time / Today / Last week / Last month / Last year / Custom. |
| 9 | **Trends** | Time series per metric (chart). **Phase 2**, after the P0s. |

Exact semantic definitions (so they are not reinterpreted):
- **Today** = the full current day in the account's zone (Phase 1: UTC).
- **Last week / month / year** = **rolling window** (last 7 / 30 / 365 days), NOT calendar week/month. (Typeform is ambiguous; we chose rolling for simplicity and consistency; document it in the UI.)
- **open** (for Time) = the session's first `view` event. If there is no `view` (lost event), fallback to `submission.started_at`.

---

## 1. Current state (ground truth with file:line)

### Capture (client → `form_event`)
- `apps/web/app/[accountCode]/[handle]/[slug]/form-renderer.tsx`
  - `:146` `useState<Phase>(cover ? 'cover' : 'steps')`: without a cover it starts at `steps`.
  - `:222` `track('view')` on mount.
  - `:232` `track('step_view', index)` when `phase==='steps' && step`, deduplicated by `${phase}:${index}` (`lastStepViewKey`). **Emits `step_view idx0` for every session that sees the 1st question, with or without a cover.**
  - `:427` `track('start')`: ONLY from the cover CTA.
  - `sessionId` = `useSessionId('quill-form-<acct>-<slug>')` (sessionStorage; the same id survives a refresh in the same tab).
- Persistence: `recordFormEvent` `packages/db/src/forms.ts` → table `form_event (id, form_id, session_id, type, step_index, created_at)`. Types: `view, start, step_view, step_complete, partial_submit, submit`.
- `submission (…, started_at, completed_at, partial_at)` via `upsertSubmission` `forms.ts:444-504`. `started_at = now` on the **first persisted write** (not on open).

### Aggregation (server)
- `packages/db/src/analytics.ts`:
  - `andRange(col, range)` `:25`: builds `AND col >= from AND col <= to`.
  - `eventTypeCounts` `:35`: `SELECT type, COUNT(*) GROUP BY type`, range by `created_at`. **`COUNT(*)`, not distinct.**
  - `stepViewCounts` `:51`: `COUNT(*)` of `step_view` by `step_index`, range by `created_at`.
  - `submissionAggregates` `:84`: `SUM(CASE completed_at…)`, `SUM(CASE partial…)`, `AVG(CASE completed_at THEN completed_at-started_at)`. **Range by `started_at`. Average, not median. started_at≈open is false.**
- `apps/api/src/analytics.service.ts`:
  - `pct1(n,d)` `:25`: `d<=0 → 0`.
  - `funnel()` `:42`: `views=counts.view`, `starts=counts.start`, `submissions=agg.completed`, `completionRate=pct1(submissions, starts)`, `avgTimeToComplete=round(agg.avgCompletionMs/1000)`.
  - Drop-off: `rowViews[0]=views` (raw), the cover row uses `config.cover?.headline || 'Cover'` `:74`.
- `apps/api/src/analytics.controller.ts`:
  - `:48` `@Get('forms/:id/analytics')`, `@Query('from'|'to')` → `parseBound(from,false)/parseBound(to,true)` → `funnel(accountId, id, {from,to})`. Account scope via a prior `getFormById`.
- `apps/api/src/query-params.ts:10` `parseBound`: epoch-ms passthrough or `YYYY-MM-DD` with **`setUTCHours` (UTC-only)**.
- Response schema: `packages/types/src/index.ts:731` `analyticsResponseSchema`: scalars + `dropoff[]` + `range`. **No trends.**

### UI
- `apps/web/app/admin/forms/[id]/analytics/page.tsx`:
  - `resolveRange` `:18`: presets `7/30/90` (rolling, `Date.now()-days*DAY_MS`), custom UTC.
  - `cards` `:109-116`: 6 cards (Views, Starts, Submissions, Completion rate, Avg time, Partial submits).
  - Drop-off table `:131`. **No chart, no metric selector.**
- `apps/web/app/admin/forms/[id]/analytics/analytics-filter.tsx`: presets `7/30/90/all/custom` to the URL.
- i18n: `packages/shared/src/i18n/index.ts` block `admin.analytics` (`metricViews`, `rangeLast7`, … ~`:646-660` en; mirror in es).

### Storage (verdict)
- **A single OLTP DB** (Postgres prod / SQLite dev). Metrics tables: `form_event`, `submission`. **There is no separate metrics DB, and NONE is needed.**
- Indexes: `form_event_form_idx (form_id, created_at)`; `submission_form_session_uq (form_id, session_id)`. **There is no index on `completed_at`.**
- Retention: **none** (`form_event` grows without limit).

---

## 2. Target behavior per metric (before → after)

All SQL must remain **portable** (COUNT / SUM(CASE) / AVG(CASE) / DISTINCT; **no** window fns, `FILTER`, `percentile_cont`, `date_trunc`, `strftime`). See invariant #1 and the header of `analytics.ts`.

### Views (#5, #6)
- Before: `counts.view` = `COUNT(*)` of `view`, range by `created_at`.
- After: `COUNT(DISTINCT session_id)` of `view`, range by `created_at`.
- Effect: a refresh in the same tab no longer inflates (same `session_id`). It also fixes the drop-off cover row (it uses the same unique count).

### Starts (#1, #6)
- Before: `counts.start` (only emitted with a cover) → 0 without a cover.
- After: `COUNT(DISTINCT session_id)` of `form_event WHERE type='step_view' AND step_index=0`, range by `created_at`.
- Effect: works with and without a cover. The legacy `start` event is left intact (not deleted; it simply stops being the source of the metric).

### Completion rate (#2)
- `pct1(submissions, starts)`: no formula change. It fixes itself once `starts` is fixed.

### Submissions (#3)
- `agg.completed`: no change (it already counts only non-null `completed_at`). The window moves to `completed_at` (see #6).

### Time to complete (#4, #6)
- Before: `round(AVG(completed_at - started_at)/1000)`, range by `started_at`. → 0 or undercount.
- After: app-side **median** of `completed_at − open` (seconds), over complete submissions whose `completed_at` falls in the range.
  - `open` = `MIN(created_at)` of `form_event WHERE type='view' AND session_id = s.session_id` (fallback `s.started_at` if null or if `open > completed_at`).
  - The query returns the list of durations (ms); the median is computed in JS (`analytics.service.ts`), rounded to seconds.
- Perf note: correlated subquery or JOIN+GROUP BY; acceptable at current volume, optimizable with a rollup (Phase 2).

### Date window per metric (#6)
- `views` / `starts` (`step_view idx0`): range by `form_event.created_at` (events already work this way).
- `submissions` / `partialSubmits` / `time`: range by `completed_at` (submissions) and `partial_at` (partials) instead of `started_at`.
- Requires splitting the filter of `submissionAggregates` (today it uses `started_at` for everything).

### Timezone (#7) + Presets (#8)
- Phase 1 (now): presets are computed **client-side to `from/to` epoch-ms** in UTC. Replace `resolveRange`/`AnalyticsFilter` with the Typeform set. `parseBound` stays UTC. Everyone sees the same numbers (server-authoritative in UTC).
- Phase 2: `account.timezone` (additive migration, default `'UTC'`); day/preset boundaries are computed in that zone. The account configures it in Settings.

### Trends (#9): Phase 2
- New **portable** query bucketed by day: group by `created_at / 86400000` (int-divide to epoch day) or group app-side; **never** `date_trunc`/`strftime`.
- Returns series per metric (views, starts, submissions, completionRate, time) per day within the range.
- New shape in `analyticsResponseSchema` (additive, field `trends?`) or a separate endpoint `GET /v1/forms/:id/analytics/trends`.
- UI: chart component (area/line) + metric selector dropdown. **Requires choosing a charting library** (none installed). Options: hand-written SVG (no dep, full control) vs. a lightweight lib. Decision when Phase 2 arrives.

---

## 3. Implementation plan by phases

### PHASE P0: metrics that give false data today (server-only, zero schema)
Goal: correct Starts, Views, Completion rate and Time to complete. Without touching the renderer or the DB schema.

**Files:**
1. `packages/db/src/analytics.ts`
   - `eventTypeCounts`: for `view` use `COUNT(DISTINCT session_id)`. (Or a new fn `uniqueViewCount`.)
   - New fn `startsCount(db, formId, range)` = `COUNT(DISTINCT session_id) WHERE type='step_view' AND step_index=0`, range by `created_at`.
   - Rewrite `submissionAggregates`:
     - `completed`/`partial` → range by `completed_at` / `partial_at` respectively (not `started_at`).
     - Remove `avg_ms`; add fn `completionDurations(db, formId, range)` that returns `number[]` (ms of `completed_at − open` per complete session in range-by-`completed_at`).
2. `apps/api/src/analytics.service.ts`
   - `starts = await startsCount(...)`.
   - `views = uniqueViewCount(...)`.
   - `avgTimeToComplete` → `medianSeconds = median(completionDurations)` (helper `median(nums:number[]):number`).
   - `completionRate = pct1(submissions, starts)` (no change).
   - Drop-off cover row: use the unique views count; and if there is no cover, do not label it "Cover" (use the 1st question or a neutral label); see P3.
3. `packages/types/src/index.ts`
   - No shape change in P0 (the existing fields already work). Update the doc comments of `starts`/`avgTimeToComplete`/`views` to reflect the new semantics.
4. **Tests** (`packages/db` + `apps/api`):
   - Unit: `startsCount` counts distinct by `step_view idx0`, with/without cover.
   - Unit: `uniqueViewCount` dedups per session.
   - Unit: `median` (even/odd/empty).
   - Unit: `completionDurations` uses the view's `open`, fallback `started_at`.
   - e2e (isolated :3400): repeat the audit scenarios and **assert the corrected numbers** (form without cover → starts≥1, completionRate>0; time > 0 and ≈ wall-clock; refresh does not inflate views).

P0 acceptance criterion: the 4 broken scenarios from the empirical audit now give correct numbers.

### PHASE P1: window by own timestamp + Typeform presets (UI) + index
**Files:**
1. `packages/db/src/analytics.ts`: make sure each aggregate filters by its own timestamp (#6). The new index requires a migration (below).
2. `packages/db/migrations/{postgres,sqlite}/000X_submission_completed_idx.sql`: `CREATE INDEX submission_form_completed_idx ON submission (form_id, completed_at)` (additive). Declare it as well in `schema.pg.ts` + `schema.sqlite.ts` (and while at it declare `form_event_form_idx`, currently underdocumented).
3. `apps/web/.../analytics/analytics-filter.tsx` + `page.tsx` (`resolveRange`): presets `all / today / week / month / year / custom`; client-side computation to `from/to` UTC (Phase 1 of #7).
4. `packages/shared/src/i18n/index.ts`: new preset keys (`rangeToday`, `rangeWeek`, `rangeMonth`, `rangeYear`) in **en + es**; deprecate/remove `rangeLast7/30/90` if no longer used.

### PHASE P2: account timezone + Trends
1. `account.timezone` (additive migration default `'UTC'` in pg+sqlite; `schema.*`; zod in types). Config UI in Settings. Presets/boundaries computed in that zone.
2. Trends: portable bucketed query + additive shape + endpoint + chart component + metric selector + i18n. Choose a charting library.
3. (Hygiene) Env-gated retention of `form_event` (`DELETE WHERE created_at < cutoff` or nightly rollup).

### PHASE P3: cosmetic
- Remove the literal "Cover" label on the top drop-off row when the form has no cover.

---

## 4. Invariant compliance (checklist)

- **#1 dual-dialect + additive:** all SQL portable; the only schema change (index, `account.timezone`) is additive and goes in pg+sqlite + a numbered migration in both. No drops/renames.
- **#2 pure engine:** `@quill/engine` is not touched.
- **#3 account-scope:** reads stay behind `getFormById(accountId,…)`; no cross-account query is introduced.
- **#4 config v1:** `formConfigSchema` does not change (the metrics changes live in `form_event`/`submission`/analytics, not in the form config).
- **#8 i18n en+es:** every new label (presets, trends) goes in both catalogs (the compiler enforces parity).
- **App-side median:** justified by the ban on window fns/percentile in portable SQL.

---

## 4b. Decisions the adversarial QA uncovered

Three findings from the adversarial QA. D1 and D3 were **resolved in code**
(2026-07-23); D2 is **deliberately deferred** (explicit decision by the
user: the real clock from when the form opens until it is submitted, regardless
of distraction, is the correct behavior; it does not need to change).

### D1: Funnel window semantics (revises decision #6): RESOLVED
Decision #6 ("each metric by its own timestamp") was correct metric
by metric, but numerator and denominator described **different populations**:
a session that started before the window and finished inside it contributed a
submission without its start. QA rendered **200% and 300%** completion rates and
funnels that **grow downward**, reachable with the out-of-the-box "Today" preset
because any session that crossed UTC midnight was split across two
windows.

*Fix applied:* all metrics now window by the session's **cohort
anchor**, its first `form_event` (or `started_at` if it has
none), so a session belongs to exactly one window, in every
metric, by construction. Trends buckets use the same anchor day, so
a session that crosses UTC midnight is no longer split. The clamp to 100% is
kept as a defense: a completed session whose start beacon was lost
(a legitimate case, not a window case) can still push the raw ratio
above 100%. See `packages/db/src/analytics.ts` (`cohortSessionIds`,
`submissionAnchor`) + tests in `analytics.service.spec.ts`.

### D2: "Time to complete" anchor (revises decision #4): DEFERRED
Decision #4 set `open` = first `view` event. QA measured that this
**over-reports 17x** when the respondent revisits the tab, and **16.6x** on
forms with a cover (it counts the dwell on the cover). **User decision
(2026-07-23): not a priority; the real clock from when the form opens until the
respondent answers is the correct number, regardless of whether they got distracted.** It does not change.
If revisited later, the alternative is to anchor on `step_view idx 0`.

### D3: Drop-off attributes views to the wrong question (PREEXISTING bug): RESOLVED
The renderer emitted `step_view` with the index over the **visible** steps
(`runtimeSteps(config, answers)`), but the service mapped `rowViews[i]` over
`config.steps` (**authored** order). In a form with `showWhen`/`hideWhen`/
`goto`, a question nobody saw appeared with views and drop-off, and the real
one with zero; monotonic and never negative, so no consistency
heuristic detected it.

*Fix applied:* additive migration `0004_form_event_step_key` (nullable
column `step_key` on `form_event`, both dialects). The renderer now sends
the step's **key** alongside the index in every `track()`; the service groups
the drop-off by key (`stepViewCounts.byKey`) when it exists, with fallback to
the old position (`byIndex`) only for rows recorded before this
migration (documented limitation, not a regression). See
`packages/db/src/analytics.ts`, `apps/web/.../form-renderer.tsx`, tests
`V5-D3` in `analytics.service.spec.ts`.

## 4c. Multi-question screens (#200)

An author can group consecutive questions into a single screen of the slides
layout (`screenGroup` on each step). The metrics **do not change formula** and
the API, the types and the SQL know nothing about screens: the renderer keeps
sending events **per question** (option E1).

| Moment | Events |
|---|---|
| A screen is shown | one `step_view` per visible question, with its runtime index and its key. A question that appears live because of the answer to another one on the same screen sends its own when it appears. Once per visit |
| The screen is submitted (valid) | `start` if there is no cover and it has not fired yet; one `step_complete` per visible question, `message` included; `partial_submit` and the partial save if the threshold is on the screen |
| End | `submit`, unchanged |

Effect on each metric:

- **Views, Submissions, Time to complete, bookings, partials:** none.
- **Starts:** same definition (decision #1). In a form without a cover whose
  first screen has several questions, someone who answers 2 of 3 and leaves does **not**
  count as a Start, because they did not submit the screen; before grouping it would have
  counted. This is expected: Start = got past the first screen.
- **Drop-off (viewed mode):** the questions of a screen share their
  views, so the drop appears on the row of the **last** question of the
  screen. It is honest but coarse, like Typeform, which only measures per page.
  Annotating the screen in the table is left as a follow-up.
- **Single page (vertical):** ignores screens; nothing changes.

See `advance` and the `step_view` effect in
`apps/web/app/[accountCode]/[handle]/[slug]/form-renderer.tsx`, and the test
"screens (#200)" in `apps/api/src/analytics.service.spec.ts`.

## 5. Risks / notes

- **Time perf (correlated subquery for `open`):** acceptable at lead-gen volume; a daily rollup (Phase 2) makes it cheap. An index `form_event (form_id, session_id, type)` would help if needed (additive).
- **Fire-and-forget top-of-funnel events** (`void callAction(() => recordEvent(...))`): a `view`/`step_view` can be lost to network/adblock, undercounting the top. Out of scope for these fixes; consider beacon/retry if the undercount matters.
- **"Last week/month/year" semantics, rolling vs calendar:** we chose rolling; if the user expects calendar, it is a `resolveRange` change (client-side).
- **`account.timezone` (Phase 2):** until it exists, everything is UTC, documented as intentional behavior.
