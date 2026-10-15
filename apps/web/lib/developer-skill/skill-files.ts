import { formConfigJsonSchema } from './config-schema';
import { LEAD_CONFIG, LEAD_CONFIG_EDITED, QUIZ_CONFIG, SCORE_GATE_CONFIG } from './examples';

/**
 * The dForms API skill, as the files of the zip a member downloads from the
 * Developers page. English only: it is read by a model, not shown in the UI.
 *
 * The two addresses are injected per request, from the environment the member
 * is signed in to. Nothing here names a real host: the repository is public and
 * the publish gate refuses one, and a hardcoded host would hand every self-host
 * and every environment the same wrong address.
 *
 * Written against the API v1 contract: key auth, `issues[]` errors, the strict
 * rules for keys, `publicUrl`/`editorUrl` and revert.
 */
export interface SkillUrls {
  /** The API base URL a customer calls, no trailing slash. */
  apiUrl: string;
  /** The dashboard's public origin, no trailing slash. */
  appUrl: string;
}

export interface SkillFile {
  path: string;
  content: string;
}

/** The folder the zip unpacks to; also the skill's `name`. */
export const SKILL_DIR = 'dforms-api';

/** The archive's file name; `INSTALL.md` refers to it by this name. */
export const SKILL_ZIP_NAME = `${SKILL_DIR}-skill.zip`;

const json = (value: unknown): string => JSON.stringify(value, null, 2);

function skillMd({ apiUrl, appUrl }: SkillUrls): string {
  return `---
name: dforms-api
description: Create, edit, publish and revert dForms forms (quizzes, lead forms, surveys) and read their responses, analytics and CSV exports through the dForms REST API with an API key. Use it whenever the user asks to build or change a dForms form, publish or roll one back, or pull a form's responses or metrics.
---

# dForms API

- API base URL: \`${apiUrl}\`
- dForms dashboard: ${appUrl}
- API keys: ${appUrl}/admin/developers/keys
- API docs, every route with an example (for a person to read): ${appUrl}/admin/developers/docs

Every path below is relative to the API base URL.

## Authentication

Send the key on every request:

~~~
Authorization: Bearer $DFORMS_API_KEY
~~~

- Read the key from the \`DFORMS_API_KEY\` environment variable. If it is not set, ask the user to create a key in dForms (MCP, then API keys) and set it. Never print the key, never write it to a file, never commit it.
- The key belongs to one workspace and acts as the person who created it. Never send an \`x-quill-workspace\` header.
- Check the key first with \`GET /v1/me\`. A 401 \`INVALID_API_KEY\` means the key is wrong, revoked, or its owner left the workspace: ask the user for a new one.

## Rules

1. **Never retry a \`POST /v1/forms\` blindly.** It is not idempotent. If it failed, timed out or you are not sure it went through, call \`GET /v1/forms\` first and look for the form by name. Only create it again if it is not there.
2. **Always send the whole \`steps\` array.** \`PUT /v1/forms/{id}\` replaces the whole config. Read the form first, change what you need on a copy of its config, and send the full config back with \`expectedUpdatedAt\` set to the form's \`updatedAt\`. A config without \`steps\` is refused (\`STEPS_REQUIRED\`); a partial list deletes the steps you left out.
3. **Only use fields from \`reference/form-config.schema.json\`.** Fields the dForms editor cannot show are refused with \`UNSUPPORTED_FIELD\`.
   - The defaults the editor writes itself are accepted, so a form you read saves back unchanged: the \`flowGroup\` derived from the step type, \`buttonText\` \`"Continue"\` on a message step, \`reveal.enabled\` \`true\` on a reveal step and \`scheduler.prefill\` \`true\` on a scheduler step. Leave them out on new steps; any other value is refused.
   - A form may also carry a \`sliderUnitLabel\` or \`branding.clientLogos\` it got from a template or the brand kit. Send them back exactly as you read them; never add or change them.
   - Every step needs a non-empty \`question\` (\`EMPTY_QUESTION\`), except \`reveal\`, \`message\` and \`scheduler\` steps: a reveal has its own headline, a message its body text (\`helper\`), and a scheduler shows the booking page.
   - An older form may carry a legacy field (\`reveal\` or \`revealAfterStep\` on the config, \`triggersReveal\` on a step). If a \`PUT\` is refused with \`UNSUPPORTED_FIELD\` on a field you did not add, tell the user which one and ask before removing it.
4. **Hand the user the \`publicUrl\` exactly as the API returns it.** Never build a form link yourself. Use \`editorUrl\` when the user wants to open the form in the editor.
5. **On a 429, wait.** Sleep the number of seconds in the \`Retry-After\` header (also \`retryAfterSec\` in the body), then continue. The limit is 120 requests per minute per key.
6. **Fix every issue at once.** A 400 lists all problems in \`issues[]\`. Each \`path\` is the field's dot path inside the request body, so it starts with the body's own key: \`config.steps.2.flowGroup\` on \`POST /v1/forms\` and \`PUT /v1/forms/{id}\`, \`destinations.0.settings.timeoutMs\` on \`PUT /v1/forms/{id}/destinations\`. Correct all of them before sending again.
7. **Respect other people's edits.** A 409 \`STALE\` means someone saved the form since you read it. Take the form from \`current\` in the error body, apply your change again on top of it, and retry with its \`updatedAt\`. Never drop their changes.
8. **Destinations have their own route.** Webhooks and HubSpot are set with \`PUT /v1/forms/{id}/destinations\`. \`PUT /v1/forms/{id}\` ignores \`destinations\` inside the config: they are not saved, and the live ones stay as they are.

## Step types

Pick the \`type\` that matches what the step asks. \`name\`, \`email\` and \`phone\` are the contact fields: dForms names each response after its first answered \`name\` step (else \`email\`, else \`phone\`), so a name asked with \`text\` leaves every response without a name.

| \`type\` | Use it for |
|---|---|
| \`name\` | The person's name. Always this type when the form asks for a name, never \`text\`. It collects first and last name by default. |
| \`email\` | An email address. |
| \`phone\` | A phone number. |
| \`multiple_choice\` | Pick from a few options shown at once. Options score with \`points\`. |
| \`dropdown\` | Pick from a long list. Options score with \`points\`. |
| \`slider\` | A number on a range. Scores with \`sliderScoring\`. |
| \`text\`, \`textarea\` | Any other written answer, short or long. |
| \`url\`, \`file\` | A web address, an upload. |
| \`message\`, \`reveal\`, \`scheduler\` | An info screen, a result screen, a booking page. They ask nothing. |

## Order, logic and placeholders

- **Order:** steps show in the order of \`steps\`, a step that \`hidden\`, \`showWhen\` or \`hideWhen\` hides is skipped, and the outcome comes last (its \`message\`, or its \`redirectUrl\`).
- **Show or hide a step** with \`showWhen\` or \`hideWhen\`: \`{ "field", "op", ... }\`. \`field\` is an earlier step's \`key\`, or \`@score\`.
  - \`op\` \`in\` (the default) with \`values\`: the answer is one of those option values.
  - \`eq\`, \`gt\` or \`lt\` with \`value\`, or \`between\` with \`min\` and \`max\` (inclusive): a number, from a slider or from \`@score\`.
- **\`@score\`** is the running score: the points of the steps shown before this one, without counting the step itself. Only \`gt\`, \`lt\`, \`eq\` and \`between\` apply to it. Put a step gated by score after the last scored question, or the questions after it never count toward the gate. See \`recipes/gate-a-step-by-score.md\`.
- **Placeholders:** \`[step_key]\` inserts an answer into a step's \`question\` and \`helper\`, an outcome's \`label\` and \`message\`, the \`ending\` texts, a reveal step's texts and a \`redirectUrl\` (percent-encoded there). A question can only use answers from steps before it.
  - When the form runs embedded (in an iframe or with \`?embed=1\`), a \`redirectUrl\` never carries answers: every query parameter with a placeholder is dropped and the rest of the URL is kept. Placeholders reach the redirect only on the form's own page.
  - A \`name\` step stores \`firstname\` and \`lastname\`, never \`name\`. It exposes \`[firstname]\`, \`[lastname]\` and \`[name]\`, the full name. If a step's own \`key\` is \`name\` and it is not a \`name\` step, \`[name]\` is that step's answer.
  - A placeholder with no answer disappears with the comma or space that joined it: \`"Thanks, [name]!"\` reads \`"Thanks!"\`.
- **Notification emails** use \`{{token}}\` markers instead: \`{{formName}}\`, \`{{respondentName}}\` (the full name), \`{{respondentEmail}}\`, \`{{score}}\`, \`{{outcomeLabel}}\`, \`{{formLink}}\` and \`{{answers}}\`.

## Form lifecycle

1. **Create:** \`POST /v1/forms\` with \`{ "name", "config" }\`. The config is live at once: the form answers at its \`publicUrl\` right away.
2. **Edit:** \`PUT /v1/forms/{id}\` with \`{ "config", "expectedUpdatedAt" }\` saves a draft (\`draftConfig\`). The public form does not change yet. When the form already has a draft, start from \`draftConfig\`, not \`config\`.
3. **Publish:** \`POST /v1/forms/{id}/publish\` with \`{ "expectedUpdatedAt" }\` makes the draft live.
4. **Revert:** \`POST /v1/forms/{id}/revert\`, with no body, puts the previously published version back live and answers 200 with the form. Calling it again undoes the revert. Every form carries \`previousPublishedAt\`: when the version a revert would bring back went live (epoch ms), or \`null\` when there is nothing to go back to, in which case the revert answers 409 \`NOTHING_TO_REVERT\`.

Tell the user what you changed, and give them the \`publicUrl\` and the \`editorUrl\`.

## Responses and analytics

- A form's responses: \`GET /v1/forms/{id}/submissions\` (there is no \`/responses\` route). Filters and sorting are in \`recipes/responses-with-filters.md\`.
- Its funnel (views, starts, completions, drop-off per step): \`GET /v1/forms/{id}/analytics\`. See \`recipes/analytics-and-csv.md\`.
- Every other route is in \`reference/endpoints.md\`. Read it before guessing a path.

## Files in this skill

- \`reference/endpoints.md\`: every route a key can call, with parameters.
- \`reference/errors.md\`: the error format and every error code.
- \`reference/form-config.schema.json\`: JSON Schema of the form \`config\`. Validate against it before you send.
- \`recipes/quiz-with-scoring.md\`: a scored quiz with result ranges.
- \`recipes/gate-a-step-by-score.md\`: show a step, such as a booking page, only above a score.
- \`recipes/edit-a-step.md\`: change one question without losing the rest.
- \`recipes/publish-and-revert.md\`: publish a draft and roll it back.
- \`recipes/responses-with-filters.md\`: read responses with filters and pagination.
- \`recipes/analytics-and-csv.md\`: funnel metrics and the CSV export.
`;
}

function endpointsMd({ apiUrl }: SkillUrls): string {
  return `# Endpoints

Base URL: \`${apiUrl}\`. Every request carries \`Authorization: Bearer $DFORMS_API_KEY\`. Bodies are JSON (\`Content-Type: application/json\`). Times are epoch milliseconds.

## Identity

| Method | Path | What it does |
|---|---|---|
| GET | \`/v1/me\` | The member and workspace the key acts as: \`accountId\`, \`accountCode\`, \`memberId\`, \`email\`, \`role\`, \`timezone\`. |

## Forms

| Method | Path | What it does |
|---|---|---|
| GET | \`/v1/forms\` | List the workspace's forms, most recently updated first: \`id\`, \`name\`, \`slug\`, \`hasDraft\`, \`folderId\`, \`createdAt\`, \`updatedAt\`, \`publicUrl\`, \`editorUrl\`. |
| GET | \`/v1/forms/{id}\` | One form: \`config\` (live), \`draftConfig\` (pending edits or null), \`publishedAt\`, \`previousPublishedAt\` (when the version a revert brings back went live, or null), \`updatedAt\`, \`publicUrl\`, \`editorUrl\`. |
| POST | \`/v1/forms\` | Create. Body \`{ "name", "slug"?, "config"?, "folderId"? }\`. 201 with the form. The config is live at once. |
| PUT | \`/v1/forms/{id}\` | Edit. Body \`{ "name"?, "config"?, "expectedUpdatedAt"? }\`. \`config\` replaces the whole draft and must carry \`steps\`. It ignores \`destinations\` inside the config: use the destinations route. |
| POST | \`/v1/forms/{id}/publish\` | Publish the draft. Body \`{ "expectedUpdatedAt"? }\`. No draft: returns the form unchanged. |
| POST | \`/v1/forms/{id}/revert\` | Put the previously published version back live. No body; 200 with the form. 409 \`NOTHING_TO_REVERT\` when there is none (\`previousPublishedAt\` is null). The pending draft and the destinations are left as they are. |
| PUT | \`/v1/forms/{id}/slug\` | Change the public URL segment. Body \`{ "slug" }\`. The old slug keeps redirecting. 409 \`SLUG_TAKEN\` or \`SLUG_INVALID\`. |
| POST | \`/v1/forms/{id}/duplicate\` | Copy a form. 201 with the copy. |
| DELETE | \`/v1/forms/{id}\` | Delete a form. 204. Ask the user before you do this. |

## Folders

| Method | Path | What it does |
|---|---|---|
| GET | \`/v1/folders\` | List folders. |
| POST | \`/v1/folders\` | Create. Body \`{ "name" }\`. 409 \`NAME_TAKEN\`. |
| PATCH | \`/v1/folders/{id}\` | Rename. Body \`{ "name" }\`. |
| DELETE | \`/v1/folders/{id}\` | Delete a folder. Its forms are kept, unfiled. |
| PATCH | \`/v1/forms/{id}/folder\` | File a form. Body \`{ "folderId" }\`, \`null\` to unfile. |

## Destinations

| Method | Path | What it does |
|---|---|---|
| PUT | \`/v1/forms/{id}/destinations\` | Replace the form's destinations. Body \`{ "destinations": [...] }\`, each one a \`webhook\` or \`hubspot\` destination as in the schema. Takes effect at once, no publish needed. |
| POST | \`/v1/forms/{id}/destinations/webhook/ping\` | Send a test event to a webhook. Needs an owner or admin key. |

## Responses

| Method | Path | What it does |
|---|---|---|
| GET | \`/v1/forms/{id}/submissions\` | A page of responses: \`{ items, total, limit, offset }\`. Filters below. |
| GET | \`/v1/forms/{id}/submissions/{submissionId}\` | One response with all its answers. |
| GET | \`/v1/forms/{id}/submissions/{submissionId}/files/{stepKey}\` | Short-lived download links for an uploaded file. |
| GET | \`/v1/forms/{id}/submissions.csv\` | The CSV export. Same filters, plus \`ids=a,b,c\`. |
| GET | \`/v1/forms/{id}/deliveries\` | Failed deliveries to destinations. \`status=done,failed\` and \`kind=\` widen it. |
| DELETE | \`/v1/submissions/{id}\` | Delete one response. 204. Ask the user first. |
| POST | \`/v1/forms/{id}/submissions/bulk-delete\` | Delete several. Body \`{ "ids": [...] }\`. Ask the user first. |

Filters for the list, the CSV and the summary, all optional query parameters:

| Parameter | Meaning |
|---|---|
| \`status\` | \`all\` (default), \`completed\` or \`partial\`. |
| \`from\`, \`to\` | Start time window: epoch ms, or \`YYYY-MM-DD\` for a whole day in the workspace's time zone. |
| \`scoreMin\`, \`scoreMax\` | Score bounds, inclusive. Ignored when the form does not score. |
| \`answers\` | JSON object of choice answers, \`{"step_key": ["value", ...]}\`. URL-encode it. |
| \`search\` | Free text searched in written answers. |
| \`sort\` | \`newest\` (default), \`oldest\`, \`score_desc\` or \`score_asc\`. |
| \`limit\`, \`offset\` | Pagination for the list (\`limit\` up to 200). |

Each item has \`id\`, \`data\` (answers keyed by step key), \`score\`, \`startedAt\`, \`completedAt\` (null for a partial) and \`partialAt\`.

## Analytics

| Method | Path | What it does |
|---|---|---|
| GET | \`/v1/forms/{id}/analytics\` | Funnel: \`views\`, \`starts\`, \`submissions\`, \`completionRate\`, \`timeToComplete\`, \`partialSubmits\`, \`bookings\`, \`dropoff[]\` per step and \`trends[]\` per day. Query \`from\`, \`to\`, \`tz\`. |
| GET | \`/v1/forms/{id}/summary\` | One card per question: option counts, averages, latest text answers. Takes the response filters. |
| GET | \`/v1/forms/{id}/submissions-facets\` | Totals and each choice option's count, before any filter. |
| GET | \`/v1/forms/{id}/summary/{stepKey}/answers\` | Search one text question's answers. Query \`q\`, \`limit\` (up to 50), \`offset\`. |

## Workspace settings a key can use

Everything here except reading the brand kit and the integrations needs a key whose owner is an owner or admin of the workspace; a member's key gets 403 \`FORBIDDEN\`.

| Method | Path | What it does |
|---|---|---|
| GET, PUT | \`/v1/branding\` | The workspace brand kit. Reading it works with any key. |
| POST | \`/v1/branding/apply\`, \`/v1/branding/revert\` | Apply the kit to forms, or undo it. Body \`{ "formIds": [...] }\`. |
| GET | \`/v1/notifications\` | The workspace's email notifications. |
| PUT | \`/v1/notifications/{emailKey}\` | Change one. Body \`{ "enabled"?, "subject"?, "body"?, "recipients"? }\`. |
| POST | \`/v1/notifications/{emailKey}/reset\` | Back to the default. |
| GET, PUT | \`/v1/forms/{id}/notifications\`, \`/v1/forms/{id}/notifications/{emailKey}\` | The same, for one form. |
| GET | \`/v1/integrations\`, \`/v1/integrations/webhooks\` | Which integrations are connected, and every webhook in the workspace. Read only. |
| GET | \`/v1/integrations/hubspot/properties\`, \`/v1/integrations/calendly/event-types\` | What a destination or a scheduler step can point at. |

## Not available with a key

These answer 403 \`KEY_NOT_ALLOWED\`; the user does them in the dashboard: API keys, members and invitations, workspaces (create, rename, switch), onboarding, writing the member profile or the public page (vanity), and connecting or disconnecting integrations.
`;
}

function errorsMd(): string {
  return `# Errors

Every error is JSON with a stable \`error\` code and an English \`message\`:

~~~json
{
  "error": "BAD_REQUEST",
  "message": "Every step needs a question.",
  "issues": [
    { "path": "config.steps.1.question", "message": "Every step needs a question.", "code": "EMPTY_QUESTION" },
    { "path": "config.steps.2.flowGroup", "message": "This field has no control in the editor.", "code": "UNSUPPORTED_FIELD" }
  ]
}
~~~

\`issues[]\` comes with validation errors (400). It lists every problem, not only the first; \`message\` repeats the first one. \`path\` is the field's dot path inside the request body, so it starts with the body's own key, and numbers are array positions:

- \`config.steps.2.flowGroup\` is the \`flowGroup\` of the third step, on \`POST /v1/forms\` and \`PUT /v1/forms/{id}\`.
- \`destinations.0.settings.timeoutMs\` is a setting of the first destination, on \`PUT /v1/forms/{id}/destinations\`.

## Codes

| Status | \`error\` | What to do |
|---|---|---|
| 400 | \`BAD_REQUEST\` | Read \`issues[]\`, fix every entry, send again. |
| 400 | \`STEPS_REQUIRED\` | A \`PUT /v1/forms/{id}\` config without \`steps\`. Send the full \`steps\` array. |
| 401 | \`INVALID_API_KEY\` | The key is unknown, revoked, or its owner is no longer in the workspace. Ask the user for a new key. |
| 403 | \`KEY_NOT_ALLOWED\` | This route is dashboard only. Tell the user to do it in dForms. |
| 403 | \`WORKSPACE_FORBIDDEN\` | You sent a workspace header for another workspace. Drop the header. |
| 403 | \`FORBIDDEN\` | The key's owner lacks the role: brand kit writes, notifications and the webhook test need an owner or admin. Tell the user. |
| 404 | \`NOT_FOUND\` | The id is wrong or belongs to another workspace. List again. |
| 409 | \`STALE\` | The form changed since you read it. The body has \`updatedAt\` and \`current\` (the form now). Reapply your change on \`current\` and retry. |
| 409 | \`NOTHING_TO_REVERT\` | The form has no earlier published version. |
| 409 | \`SLUG_TAKEN\`, \`SLUG_INVALID\` | Pick another slug: lowercase letters, numbers and hyphens. |
| 409 | \`NAME_TAKEN\` | A folder with that name exists. |
| 429 | \`RATE_LIMITED\` | Wait \`Retry-After\` seconds (also \`retryAfterSec\` in the body), then continue. |
| 5xx | any | Retry later with backoff, but never a \`POST /v1/forms\` without listing first. |

## Issue codes

| \`code\` | Meaning |
|---|---|
| \`UNSUPPORTED_FIELD\` | A field the editor cannot show, or a value other than the editor's own default (\`flowGroup\` derived from the type, \`buttonText\` "Continue", \`reveal.enabled\` and \`scheduler.prefill\` true). Remove it or send back the value you read; \`reference/form-config.schema.json\` allows only those. |
| \`EMPTY_QUESTION\` | A step without \`question\` text. \`reveal\`, \`message\` and \`scheduler\` steps are exempt. |
| \`invalid_type\`, \`too_small\`, \`too_big\`, \`invalid_enum_value\`, \`invalid_string\`, \`invalid_literal\`, \`invalid_union_discriminator\`, \`custom\` | Standard schema checks: wrong type, length or range out of bounds, a value outside the allowed list, a bad URL or email, \`version\` not 1, an unknown destination \`type\`, or a rule such as \`maxChars\` lower than \`minChars\`. |
`;
}

function quizRecipe({ apiUrl }: SkillUrls): string {
  return `# Recipe: a quiz with scoring and results

Each answer adds points; the total picks one of the \`outcomes\` by its \`minScore\` and \`maxScore\` (inclusive). Leave \`maxScore\` off the highest range so every score lands somewhere.

- \`multiple_choice\` and \`dropdown\` options score with \`points\`.
- \`slider\` steps score with \`sliderScoring\` ranges.
- Ask for the person's name with a \`name\` step and their email with an \`email\` step, never with \`text\` (see Step types in \`SKILL.md\`).
- \`scoring: { "enabled": false }\` turns scoring and outcomes off; leave it true.
- An outcome's \`label\` and \`message\` are the result screen's heading and text; \`[step_key]\` inserts an answer, and \`[name]\` the full name from a \`name\` step. \`redirectUrl\` sends the person to a page instead, and takes placeholders too, except when the form is embedded: then every query parameter with a placeholder is left out.

~~~bash
curl -sS -X POST "${apiUrl}/v1/forms" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data @quiz.json
~~~

\`quiz.json\`:

~~~json
${json({ name: 'Plan quiz', config: QUIZ_CONFIG })}
~~~

The 201 answer carries \`id\`, \`updatedAt\`, \`publicUrl\` and \`editorUrl\`. The quiz is live at once; give the user the \`publicUrl\` as is. If the call fails or times out, \`GET /v1/forms\` before trying again.
`;
}

function scoreGateRecipe({ apiUrl }: SkillUrls): string {
  return `# Recipe: show a step only above a score

A booking page only for good leads: the scheduler step carries a \`hideWhen\` on \`@score\`, so a low score skips it and the form goes straight to its outcome.

~~~json
{ "field": "@score", "op": "lt", "value": 14 }
~~~

- \`@score\` is the running score: the points of the steps shown before the gated step, not counting the step itself. Here it is \`team_size\` plus \`timeline\`, at most 18.
- Put the gated step after the last scored question. A scored question after the gate still counts for the outcome, but never for the gate.
- \`hideWhen\` with \`lt\` 14 is the same as \`showWhen\` with \`gt\` 13. \`between\` takes \`min\` and \`max\`, both inclusive.
- The outcome ranges use the same total: below 14 lands on \`p3\`, 14 or more on \`p1\`.
- The screens: \`team_size\`, \`timeline\`, \`name\`, \`email\`, then \`demo\` only from 14 points, then the outcome.
- \`[firstname]\` and \`[name]\` (first and last name joined) come from the \`name\` step; they work in any step after it and in the outcomes.

~~~bash
curl -sS -X POST "${apiUrl}/v1/forms" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data @demo.json
~~~

\`demo.json\`:

~~~json
${json({ name: 'Demo booking', config: SCORE_GATE_CONFIG })}
~~~

Replace the scheduler \`url\` with the user's own booking page. Check the gate on the \`publicUrl\`: answer low and the booking page never shows.
`;
}

function editRecipe({ apiUrl }: SkillUrls): string {
  return `# Recipe: edit one step

\`PUT /v1/forms/{id}\` replaces the whole config, so an edit is always read, change, write back.

1. Read the form:

~~~bash
curl -sS "${apiUrl}/v1/forms/$FORM_ID" -H "Authorization: Bearer $DFORMS_API_KEY" > form.json
~~~

2. Start from \`draftConfig\` when it is not null (someone has unpublished edits), else from \`config\`. Change only what the user asked. Here, the \`interest\` question is reworded and gets one more option:

~~~bash
jq '{
  config: ((.draftConfig // .config)
    | .steps |= map(if .key == "interest"
        then .question = "What brings you here today?"
          | .options += [{"label": "A partnership", "value": "partnership"}]
        else . end)),
  expectedUpdatedAt: .updatedAt
}' form.json > edit.json
~~~

3. Send it back:

~~~bash
curl -sS -X PUT "${apiUrl}/v1/forms/$FORM_ID" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data @edit.json
~~~

Before:

~~~json
${json(LEAD_CONFIG)}
~~~

After (every step is still there):

~~~json
${json(LEAD_CONFIG_EDITED)}
~~~

The edit is a draft until you publish it (see \`publish-and-revert.md\`).

- **409 \`STALE\`:** someone saved the form in the editor after your read. Run step 2 again on \`current\` from the error body, with its \`updatedAt\`.
- **400:** fix every entry of \`issues[]\`. A config without \`steps\` is \`STEPS_REQUIRED\`.
- Keep step \`key\`s stable: responses, logic and destinations refer to them.
`;
}

function publishRecipe({ apiUrl }: SkillUrls): string {
  return `# Recipe: publish and revert

Publish the draft, guarded by the \`updatedAt\` you last saw:

~~~bash
curl -sS -X POST "${apiUrl}/v1/forms/$FORM_ID/publish" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data '{"expectedUpdatedAt": 1767225600000}'
~~~

The answer is the form with the new \`config\`, \`draftConfig: null\` and a new \`publishedAt\`. Check the \`publicUrl\` and hand it to the user as is.

If the published version is wrong, put the previous one back. Check first that the form's \`previousPublishedAt\` is not null: it is when the version a revert brings back went live (epoch ms). The call takes no body:

~~~bash
curl -sS -X POST "${apiUrl}/v1/forms/$FORM_ID/revert" \\
  -H "Authorization: Bearer $DFORMS_API_KEY"
~~~

- It answers 200 with the form, now serving the previous config.
- The previously published config becomes live again, and the one you replaced becomes the previous one: reverting twice undoes the revert.
- Destinations stay as they are, and a pending draft is not touched.
- 409 \`NOTHING_TO_REVERT\`: the form was never published over an earlier version.
- People can do the same from the form editor.
`;
}

function responsesRecipe({ apiUrl }: SkillUrls): string {
  return `# Recipe: responses with filters

Completed responses from October 2026 with a score of 10 or more that picked "demo", best scores first:

~~~bash
curl -sS -G "${apiUrl}/v1/forms/$FORM_ID/submissions" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  --data-urlencode "status=completed" \\
  --data-urlencode "from=2026-10-01" \\
  --data-urlencode "to=2026-10-31" \\
  --data-urlencode "scoreMin=10" \\
  --data-urlencode 'answers={"interest":["demo"]}' \\
  --data-urlencode "sort=score_desc" \\
  --data-urlencode "limit=100" \\
  --data-urlencode "offset=0"
~~~

The answer:

~~~json
{
  "items": [
    {
      "id": "8f0c1d52-0000-4000-8000-000000000000",
      "formId": "$FORM_ID",
      "data": { "firstname": "Ana", "lastname": "Ruiz", "email": "ana@example.com", "interest": "demo" },
      "score": 15,
      "startedAt": 1759334400000,
      "completedAt": 1759334460000,
      "partialAt": null
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
~~~

- Page with \`offset\` until \`offset + items.length >= total\`.
- \`from\` and \`to\` as \`YYYY-MM-DD\` are whole days in the workspace's time zone; epoch ms works too.
- \`answers\` only filters choice questions; \`search\` looks inside written answers.
- \`completedAt: null\` is a partial: the person left before the end.
- Answers are keyed by step \`key\`, except a \`name\` step, which stores \`firstname\` and \`lastname\`. Read the form's \`config.steps\` to turn keys and option values into the questions and labels people saw.
`;
}

function analyticsRecipe({ apiUrl }: SkillUrls): string {
  return `# Recipe: analytics and CSV

Funnel for a date range:

~~~bash
curl -sS -G "${apiUrl}/v1/forms/$FORM_ID/analytics" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  --data-urlencode "from=2026-10-01" \\
  --data-urlencode "to=2026-10-31"
~~~

- \`views\`: people who opened the form; \`starts\`: reached the first question; \`submissions\`: completed.
- \`completionRate\` is submissions over starts in percent, or null when nobody started.
- \`timeToComplete\` is the median in seconds, or null. Null is not zero.
- \`dropoff[]\` has one row per step with how many people reached or answered it: report the step with the largest drop.
- \`trends[]\` is one point per day.
- Days are counted in the workspace's time zone; pass \`tz\` (an IANA zone such as \`America/Bogota\`) to count them in another.

Per-question breakdown, with the same filters as the response list:

~~~bash
curl -sS -G "${apiUrl}/v1/forms/$FORM_ID/summary" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  --data-urlencode "status=completed"
~~~

CSV export, ready for a spreadsheet (UTF-8 with BOM, one column per question, option labels instead of values):

~~~bash
curl -sS -G "${apiUrl}/v1/forms/$FORM_ID/submissions.csv" \\
  -H "Authorization: Bearer $DFORMS_API_KEY" \\
  --data-urlencode "status=completed" \\
  --data-urlencode "from=2026-10-01" \\
  -o responses.csv
~~~

The CSV is not paginated: it has every response that matches the filters. \`ids=a,b,c\` exports only those responses.
`;
}

function installMd({ apiUrl, appUrl }: SkillUrls): string {
  return `# Installing the dForms API skill

1. Create an API key on ${appUrl}/admin/developers/keys. It is shown once: copy it then.
   Every route, with a curl example and its answer, is on ${appUrl}/admin/developers/docs.
2. Put it in the environment the agent runs in, never in a file you commit:

~~~bash
export DFORMS_API_KEY="dforms_your_key_here"
~~~

3. Check it:

~~~bash
curl -sS "${apiUrl}/v1/me" -H "Authorization: Bearer $DFORMS_API_KEY"
~~~

## Claude Code

Unzip so that \`SKILL.md\` ends up in a folder named \`dforms-api\` inside a skills folder:

- For all your projects: \`~/.claude/skills/dforms-api/SKILL.md\`
- For one project: \`.claude/skills/dforms-api/SKILL.md\` in that project

~~~bash
unzip ${SKILL_ZIP_NAME} -d ~/.claude/skills/
~~~

Claude Code picks the skill up on its own when a request is about dForms. You can also ask for it by name: "use the dforms-api skill".

## Codex

Codex reads \`AGENTS.md\`. Unzip the folder into your project and point \`AGENTS.md\` at it:

~~~bash
unzip ${SKILL_ZIP_NAME} -d .
cat >> AGENTS.md <<'EOF'

## dForms
For any task about dForms forms, responses or analytics, read dforms-api/SKILL.md first and follow its rules. The references and recipes it names are in dforms-api/.
EOF
~~~

## Cursor

Unzip the folder into your project and add a project rule that sends Cursor to it:

~~~bash
unzip ${SKILL_ZIP_NAME} -d .
mkdir -p .cursor/rules
cat > .cursor/rules/dforms-api.mdc <<'EOF'
---
description: Use the dForms API to create, edit, publish and revert forms and to read responses and analytics.
alwaysApply: false
---
Read dforms-api/SKILL.md and follow its rules. References and recipes are in dforms-api/.
EOF
~~~

## Other agents

Any agent that can read files and make HTTP requests can use it: give it \`dforms-api/SKILL.md\` as instructions and keep the folder next to it.
`;
}

/**
 * Every file of the skill, inside `SKILL_DIR/`. Pure: the same URLs always give
 * the same files, which is what lets the spec check them without a server.
 */
export function buildSkillFiles(urls: SkillUrls): SkillFile[] {
  const files: Array<[string, string]> = [
    ['SKILL.md', skillMd(urls)],
    ['INSTALL.md', installMd(urls)],
    ['reference/endpoints.md', endpointsMd(urls)],
    ['reference/errors.md', errorsMd()],
    ['reference/form-config.schema.json', `${json(formConfigJsonSchema())}\n`],
    ['recipes/quiz-with-scoring.md', quizRecipe(urls)],
    ['recipes/gate-a-step-by-score.md', scoreGateRecipe(urls)],
    ['recipes/edit-a-step.md', editRecipe(urls)],
    ['recipes/publish-and-revert.md', publishRecipe(urls)],
    ['recipes/responses-with-filters.md', responsesRecipe(urls)],
    ['recipes/analytics-and-csv.md', analyticsRecipe(urls)],
  ];
  return files.map(([path, content]) => ({ path: `${SKILL_DIR}/${path}`, content }));
}
