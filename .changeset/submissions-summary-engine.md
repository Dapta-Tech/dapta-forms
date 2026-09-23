---
'@quill/engine': minor
---

`summarizeSubmissions(steps, rows)` builds the submissions Summary: one entry
per answering step, in form order, with how many responses answered it. Choice
and dropdown steps count each option (labels resolved from the stored values,
most chosen first, unchosen options at zero, a multi-select counted per option
so its percentages can add past 100); a slider gets its average and a
distribution (one bar per value, or ten ranges when there are more than ten
values); text, name, email, phone and URL steps list their latest answers with
who answered and when; file and booking steps count how many answered.
`summaryAnswer`, `summaryRespondent`, `summaryAnswerFields` and
`isTextSummaryStep` serve the per-question answer search.
