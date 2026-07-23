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
timestamp — submissions and timing by `completed_at`, partials by `partial_at`.

New: the analytics response carries a gap-filled per-day `trends` series holding
every metric per bucket, backing a Trends chart with a metric selector.

Breaking: the analytics response field `avgTimeToComplete` is renamed
`timeToComplete` (it is a median, not an average). `@quill/db` replaces
`eventTypeCounts` / `submissionAggregates` with `uniqueViewCount`, `startCount`,
`completedSubmissions`, `partialCount`, `dailyViewSessions` and
`dailyStartSessions`. `@quill/shared` swaps the analytics range presets
(`rangeLast7`/`rangeLast30`/`rangeLast90` → `rangeToday`/`rangeWeek`/`rangeMonth`/
`rangeYear`) and adds the Trends + landing-row strings in both locales.

Additive migration `0003_metrics_indexes` indexes the metrics read path
(`submission(form_id, completed_at)`, `form_event(form_id, session_id, type)`).
