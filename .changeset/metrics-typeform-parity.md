---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
---

Correct the funnel metrics and add the Trends series.

Four dashboard metrics were wrong at runtime and are now fixed: Starts derive from
the first-question view (`step_view` idx 0) instead of the cover-only `start`
event, so a form without a cover no longer reports 0 starts and 0% completion;
Views count distinct sessions, so an in-tab refresh no longer inflates them; and
Time to complete is the median of open→complete (anchored on the session's first
`view`) rather than an average of `completed_at − started_at`, which was 0
whenever no partial had been persisted. Each metric now windows by its own
timestamp initially — since revised, see below.

New: the analytics response carries a gap-filled per-day `trends` series holding
every metric per bucket, backing a Trends chart with a metric selector.

Revised: every metric now windows by the session's COHORT ANCHOR (its earliest
`form_event`, falling back to `started_at`) instead of its own per-metric
timestamp. Windowing each metric independently let a session start before a
query range and complete inside it, contributing a submission with no matching
start — the mechanism behind completion rates rendering above 100% and a
session's activity splitting across a UTC-midnight trend boundary. A session now
belongs to exactly one window, in every metric, by construction.

Fixed: the drop-off table could attribute a view to the wrong question on any
form using show/hide/goto conditional logic — the renderer's `step_index` is a
position in that SESSION's visible-step order, which shifts under conditional
logic, but the table mapped it positionally onto the form's authored step order.
`form_event` gains an additive `step_key` column; the renderer now tags every
step event with the step's stable key, and the drop-off table groups by key when
present (falling back to the old positional mapping only for rows recorded
before this migration).

`completionRate` and `timeToComplete` are nullable: null (not 0%/0s) when there
is no denominator or no derivable duration in the window — a fabricated zero
was indistinguishable from a real one.

Breaking: the analytics response field `avgTimeToComplete` is renamed
`timeToComplete` (it is a median, not an average) and both `timeToComplete` and
`completionRate` are now `number | null`. `@quill/db` replaces `eventTypeCounts` /
`submissionAggregates` / `stepViewCounts`'s old `Map<number, number>` with
`uniqueViewCount`, `startCount`, `completedSubmissions`, `partialCount`,
`dailyViewSessions`, `dailyStartSessions`, and a `stepViewCounts` returning
`{ byKey, byIndex }`. `@quill/shared` swaps the analytics range presets
(`rangeLast7`/`rangeLast30`/`rangeLast90` → `rangeToday`/`rangeWeek`/`rangeMonth`/
`rangeYear`) and adds the Trends + landing-row + range-empty strings in both
locales. `formEventSchema` gains an optional `stepKey`.

Additive migrations: `0003_metrics_indexes` indexes the metrics read path
(`submission(form_id, completed_at)`, `form_event(form_id, session_id, type)`);
`0004_form_event_step_key` adds the nullable `step_key` column.
