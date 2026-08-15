# SPEC — Métricas del dashboard (paridad Typeform)

> Estado: **decisiones de producto cerradas**, listo para implementar.
> Alcance: validar y corregir las métricas del Results screen de Dapta Forms
> contra Typeform (Views, Starts, Submissions, Completion rate, Time to complete)
> + Trends + filtro de rango de fechas. **Filtro de dispositivos: fuera de alcance.**
>
> Respaldado por dos auditorías (código + runtime en vivo con Playwright contra la
> instancia aislada :3400). Todos los defectos abajo se reprodujeron con números
> reales.

---

## 0. Decisiones de producto (LOCKED)

| # | Tema | Decisión |
|---|------|----------|
| 1 | **Start** | Un "start" = **la primera pregunta fue vista** (`step_view` con `step_index=0`). Funciona con y sin portada. Es el denominador de Completion rate. |
| 2 | **Completion rate** | `submissions / starts` (con el nuevo Start). |
| 3 | **Submissions** | Solo **completas** (`completed_at` no null). Los parciales siguen como métrica aparte (`partialSubmits`). |
| 4 | **Time to complete** | **Mediana** de `completed_at − open`, donde `open` = `created_at` del evento `view` de esa sesión (fallback `started_at`). No promedio. |
| 5 | **Views** | **Únicos por sesión**: `COUNT(DISTINCT session_id)` de eventos `view`. |
| 6 | **Ventana de fecha** | Cada métrica se filtra por **su propio timestamp**: views por hora del view, starts por hora del `step_view idx0`, submissions/time por `completed_at`. |
| 7 | **Timezone** | **Account-level**. Fase 1: límites en **UTC** (server-authoritative, cero config). Fase 2: campo `account.timezone` (migración aditiva, default UTC) configurable por el admin. |
| 8 | **Presets** | **Typeform + Custom**: All time / Today / Last week / Last month / Last year / Custom. |
| 9 | **Trends** | Serie de tiempo por métrica (chart). **Fase 2**, después de los P0. |

Definiciones semánticas exactas (para no reinterpretar):
- **Today** = día actual completo en la zona de la cuenta (Fase 1: UTC).
- **Last week / month / year** = **ventana móvil** (últimos 7 / 30 / 365 días) — NO semana/mes calendario. (Typeform es ambiguo; elegimos móvil por simplicidad y consistencia; documentar en la UI.)
- **open** (para Time) = primer evento `view` de la sesión. Si no hay `view` (evento perdido), fallback a `submission.started_at`.

---

## 1. Estado actual (ground truth con file:line)

### Captura (cliente → `form_event`)
- `apps/web/app/[accountCode]/[handle]/[slug]/form-renderer.tsx`
  - `:146` `useState<Phase>(cover ? 'cover' : 'steps')` — sin portada arranca en `steps`.
  - `:222` `track('view')` en mount.
  - `:232` `track('step_view', index)` cuando `phase==='steps' && step`, deduplicado por `${phase}:${index}` (`lastStepViewKey`). **Emite `step_view idx0` para toda sesión que ve la 1ª pregunta, con o sin cover.**
  - `:427` `track('start')` — SOLO desde el CTA de la portada.
  - `sessionId` = `useSessionId('quill-form-<acct>-<slug>')` (sessionStorage; mismo id sobrevive refresh en la misma pestaña).
- Persistencia: `recordFormEvent` `packages/db/src/forms.ts` → tabla `form_event (id, form_id, session_id, type, step_index, created_at)`. Tipos: `view, start, step_view, step_complete, partial_submit, submit`.
- `submission (…, started_at, completed_at, partial_at)` vía `upsertSubmission` `forms.ts:444-504`. `started_at = now` en el **primer write persistido** (no en el open).

### Agregación (server)
- `packages/db/src/analytics.ts`:
  - `andRange(col, range)` `:25` — arma `AND col >= from AND col <= to`.
  - `eventTypeCounts` `:35` — `SELECT type, COUNT(*) GROUP BY type`, rango por `created_at`. **`COUNT(*)`, no distinct.**
  - `stepViewCounts` `:51` — `COUNT(*)` de `step_view` por `step_index`, rango por `created_at`.
  - `submissionAggregates` `:84` — `SUM(CASE completed_at…)`, `SUM(CASE partial…)`, `AVG(CASE completed_at THEN completed_at-started_at)`. **Rango por `started_at`. Promedio, no mediana. started_at≈open falso.**
- `apps/api/src/analytics.service.ts`:
  - `pct1(n,d)` `:25` — `d<=0 → 0`.
  - `funnel()` `:42` — `views=counts.view`, `starts=counts.start`, `submissions=agg.completed`, `completionRate=pct1(submissions, starts)`, `avgTimeToComplete=round(agg.avgCompletionMs/1000)`.
  - Drop-off: `rowViews[0]=views` (crudo), fila cover usa `config.cover?.headline || 'Cover'` `:74`.
- `apps/api/src/analytics.controller.ts`:
  - `:48` `@Get('forms/:id/analytics')`, `@Query('from'|'to')` → `parseBound(from,false)/parseBound(to,true)` → `funnel(accountId, id, {from,to})`. Account-scope vía `getFormById` previo.
- `apps/api/src/query-params.ts:10` `parseBound` — epoch-ms passthrough o `YYYY-MM-DD` con **`setUTCHours` (UTC-only)**.
- Schema respuesta: `packages/types/src/index.ts:731` `analyticsResponseSchema` — escalares + `dropoff[]` + `range`. **Sin trends.**

### UI
- `apps/web/app/admin/forms/[id]/analytics/page.tsx`:
  - `resolveRange` `:18` — presets `7/30/90` (móvil, `Date.now()-days*DAY_MS`), custom UTC.
  - `cards` `:109-116` — 6 tarjetas (Views, Starts, Submissions, Completion rate, Avg time, Partial submits).
  - Tabla drop-off `:131`. **Sin chart, sin selector de métrica.**
- `apps/web/app/admin/forms/[id]/analytics/analytics-filter.tsx` — presets `7/30/90/all/custom` a la URL.
- i18n: `packages/shared/src/i18n/index.ts` bloque `admin.analytics` (`metricViews`, `rangeLast7`, … ~`:646-660` en; espejo en es).

### Storage (veredicto)
- **Una sola DB OLTP** (Postgres prod / SQLite dev). Tablas de métricas: `form_event`, `submission`. **No hay DB de métricas aparte, y NO hace falta.**
- Índices: `form_event_form_idx (form_id, created_at)`; `submission_form_session_uq (form_id, session_id)`. **No hay índice por `completed_at`.**
- Retención: **ninguna** (`form_event` crece sin límite).

---

## 2. Comportamiento objetivo por métrica (antes → después)

Todo el SQL debe seguir siendo **portable** (COUNT / SUM(CASE) / AVG(CASE) / DISTINCT; **sin** window fns, `FILTER`, `percentile_cont`, `date_trunc`, `strftime`). Ver invariante #1 y el header de `analytics.ts`.

### Views (#5, #6)
- Antes: `counts.view` = `COUNT(*)` de `view`, rango por `created_at`.
- Después: `COUNT(DISTINCT session_id)` de `view`, rango por `created_at`.
- Efecto: refresh en misma pestaña ya no infla (mismo `session_id`). También corrige la fila cover del drop-off (usa el mismo conteo único).

### Starts (#1, #6)
- Antes: `counts.start` (solo se emite con cover) → 0 sin portada.
- Después: `COUNT(DISTINCT session_id)` de `form_event WHERE type='step_view' AND step_index=0`, rango por `created_at`.
- Efecto: funciona con y sin cover. El evento `start` legacy se deja intacto (no se borra; simplemente deja de ser la fuente de la métrica).

### Completion rate (#2)
- `pct1(submissions, starts)` — sin cambio de fórmula. Se arregla solo al arreglar `starts`.

### Submissions (#3)
- `agg.completed` — sin cambio (ya cuenta solo `completed_at` no null). Ventana pasa a `completed_at` (ver #6).

### Time to complete (#4, #6)
- Antes: `round(AVG(completed_at - started_at)/1000)`, rango por `started_at`. → 0 o subconteo.
- Después: **mediana** app-side de `completed_at − open` (segundos), sobre submissions completas cuya `completed_at` cae en el rango.
  - `open` = `MIN(created_at)` de `form_event WHERE type='view' AND session_id = s.session_id` (fallback `s.started_at` si null o si `open > completed_at`).
  - Query devuelve la lista de duraciones (ms); la mediana se computa en JS (`analytics.service.ts`), redondeada a segundos.
- Nota de perf: correlated subquery o JOIN+GROUP BY; aceptable al volumen actual, optimizable con rollup (Fase 2).

### Ventana de fecha por métrica (#6)
- `views` / `starts` (`step_view idx0`): rango por `form_event.created_at` (ya es así para eventos).
- `submissions` / `partialSubmits` / `time`: rango por `completed_at` (submissions) y `partial_at` (parciales) en vez de `started_at`.
- Requiere separar el filtro de `submissionAggregates` (hoy usa `started_at` para todo).

### Timezone (#7) + Presets (#8)
- Fase 1 (ahora): los presets se computan **client-side a `from/to` epoch-ms** en UTC. Reemplazar `resolveRange`/`AnalyticsFilter` por el set Typeform. `parseBound` sigue UTC. Todos ven los mismos números (server-authoritative en UTC).
- Fase 2: `account.timezone` (migración aditiva, default `'UTC'`); los límites de día/preset se computan en esa zona. La cuenta la configura en Settings.

### Trends (#9) — Fase 2
- Nuevo query bucketizado por día **portable**: agrupar por `created_at / 86400000` (int-divide a día epoch) o agrupar app-side; **nunca** `date_trunc`/`strftime`.
- Devuelve series por métrica (views, starts, submissions, completionRate, time) por día dentro del rango.
- Nuevo shape en `analyticsResponseSchema` (aditivo, campo `trends?`) o endpoint separado `GET /v1/forms/:id/analytics/trends`.
- UI: componente chart (área/línea) + dropdown selector de métrica. **Requiere decidir librería de charting** (ninguna instalada) — opciones: SVG a mano (sin dep, control total) vs. una lib liviana. Decisión al llegar a Fase 2.

---

## 3. Plan de implementación por fases

### FASE P0 — métricas que dan datos falsos hoy (server-only, cero schema)
Objetivo: Starts, Views, Completion rate y Time to complete correctos. Sin tocar el renderer ni el schema de DB.

**Archivos:**
1. `packages/db/src/analytics.ts`
   - `eventTypeCounts`: para `view` usar `COUNT(DISTINCT session_id)`. (O nueva fn `uniqueViewCount`.)
   - Nueva fn `startsCount(db, formId, range)` = `COUNT(DISTINCT session_id) WHERE type='step_view' AND step_index=0`, rango por `created_at`.
   - Reescribir `submissionAggregates`:
     - `completed`/`partial` → rango por `completed_at` / `partial_at` respectivamente (no `started_at`).
     - Quitar `avg_ms`; añadir fn `completionDurations(db, formId, range)` que devuelve `number[]` (ms de `completed_at − open` por sesión completa en rango-por-`completed_at`).
2. `apps/api/src/analytics.service.ts`
   - `starts = await startsCount(...)`.
   - `views = uniqueViewCount(...)`.
   - `avgTimeToComplete` → `medianSeconds = median(completionDurations)` (helper `median(nums:number[]):number`).
   - `completionRate = pct1(submissions, starts)` (sin cambio).
   - Drop-off fila cover: usar el conteo único de views; y si no hay cover, no rotular "Cover" (usar la 1ª pregunta o label neutro) — ver P3.
3. `packages/types/src/index.ts`
   - Sin cambio de shape en P0 (los campos existentes ya sirven). Actualizar los comentarios doc de `starts`/`avgTimeToComplete`/`views` para reflejar la nueva semántica.
4. **Tests** (`packages/db` + `apps/api`):
   - Unit: `startsCount` cuenta distinct por `step_view idx0`, con/sin cover.
   - Unit: `uniqueViewCount` dedup por sesión.
   - Unit: `median` (par/impar/vacío).
   - Unit: `completionDurations` usa `open` del view, fallback `started_at`.
   - e2e (isolated :3400): repetir los escenarios del audit y **asertar los números corregidos** (form sin cover → starts≥1, completionRate>0; time > 0 y ≈ wall-clock; refresh no infla views).

Criterio de aceptación P0: los 4 escenarios rotos del audit empírico ahora dan números correctos.

### FASE P1 — ventana por timestamp propio + presets Typeform (UI) + índice
**Archivos:**
1. `packages/db/src/analytics.ts` — asegurar que cada agregado filtra por su timestamp propio (#6). Índice nuevo requiere migración (abajo).
2. `packages/db/migrations/{postgres,sqlite}/000X_submission_completed_idx.sql` — `CREATE INDEX submission_form_completed_idx ON submission (form_id, completed_at)` (aditivo). Declararlo también en `schema.pg.ts` + `schema.sqlite.ts` (y de paso declarar `form_event_form_idx`, hoy subdocumentado).
3. `apps/web/.../analytics/analytics-filter.tsx` + `page.tsx` (`resolveRange`) — presets `all / today / week / month / year / custom`; cómputo client-side a `from/to` UTC (Fase 1 de #7).
4. `packages/shared/src/i18n/index.ts` — nuevas keys de preset (`rangeToday`, `rangeWeek`, `rangeMonth`, `rangeYear`) en **en + es**; deprecar/retirar `rangeLast7/30/90` si ya no se usan.

### FASE P2 — account timezone + Trends
1. `account.timezone` (migración aditiva default `'UTC'` en pg+sqlite; `schema.*`; zod en types). UI de config en Settings. Cómputo de presets/límites en esa zona.
2. Trends: query bucketizada portable + shape aditivo + endpoint + componente chart + selector de métrica + i18n. Decidir librería de charting.
3. (Higiene) Retención de `form_event` env-gated (`DELETE WHERE created_at < cutoff` o rollup nocturno).

### FASE P3 — cosmético
- Quitar el rótulo literal "Cover" en la fila top del drop-off cuando el form no tiene portada.

---

## 4. Cumplimiento de invariantes (checklist)

- **#1 dual-dialect + aditivo:** todo SQL portable; el único cambio de schema (índice, `account.timezone`) es aditivo y va en pg+sqlite + migración numerada en ambos. Sin drops/renames.
- **#2 engine puro:** no se toca `@quill/engine`.
- **#3 account-scope:** las lecturas siguen tras `getFormById(accountId,…)`; no se introduce query cross-account.
- **#4 config v1:** no se cambia `formConfigSchema` (los cambios de métricas viven en `form_event`/`submission`/analytics, no en la config del form).
- **#8 i18n en+es:** toda nueva label (presets, trends) va en ambos catálogos (parity la fuerza el compilador).
- **Mediana app-side:** justificada por la prohibición de window fns/percentile en SQL portable.

---

## 4b. Decisiones que el QA adversarial destapó

Tres hallazgos del QA adversarial. D1 y D3 quedaron **resueltos en código**
(2026-07-23); D2 queda **diferido a propósito** (decisión explícita del
usuario: el reloj real desde que abre hasta que envía, sin importar
distracción, es el comportamiento correcto — no hace falta cambiarlo).

### D1 — Semántica de ventana del embudo (revisa la decisión #6) — RESUELTO
La decisión #6 ("cada métrica por su propio timestamp") era correcta métrica
por métrica, pero numerador y denominador describían **poblaciones distintas**:
una sesión que arranca antes de la ventana y termina dentro aportaba una
submission sin su start. QA renderizó **200% y 300%** de completion rate y
embudos que **crecen hacia abajo**, alcanzables con el preset "Today" de
fábrica porque cualquier sesión que cruce medianoche UTC se partía en dos
ventanas.

*Arreglo aplicado:* todas las métricas ahora ventanean por el **ancla de
cohorte** de la sesión — su primer `form_event` (o `started_at` si no tiene
ninguno) — así que una sesión pertenece a exactamente una ventana, en toda
métrica, por construcción. Los buckets de Trends usan el mismo día ancla, así
que una sesión que cruza medianoche UTC ya no se parte. El clamp a 100% se
mantiene como defensa: una sesión completada cuyo beacon de start se perdió
(caso legítimo, no de ventana) todavía puede empujar la razón cruda por
encima de 100%. Ver `packages/db/src/analytics.ts` (`cohortSessionIds`,
`submissionAnchor`) + tests en `analytics.service.spec.ts`.

### D2 — Ancla de "Time to complete" (revisa la decisión #4) — DIFERIDO
La decisión #4 fijó `open` = primer evento `view`. QA midió que eso
**sobre-reporta 17x** cuando el respondiente revisita la pestaña, y **16.6x** en
formularios con portada (cuenta el dwell en el cover). **Decisión del usuario
(2026-07-23): no es prioridad — el reloj real desde que abre hasta que
contesta es el número correcto, sin importar si se distrajo.** No se cambia.
Si se revisita más adelante, la alternativa es anclar en `step_view idx 0`.

### D3 — Drop-off atribuye vistas a la pregunta equivocada (bug PREEXISTENTE) — RESUELTO
El renderer emitía `step_view` con el índice sobre los pasos **visibles**
(`runtimeSteps(config, answers)`), pero el servicio mapeaba `rowViews[i]` sobre
`config.steps` (orden **autorado**). En un formulario con `showWhen`/`hideWhen`/
`goto`, una pregunta que nadie vio aparecía con vistas y abandono, y la real
con cero — monótono y nunca negativo, así que ninguna heurística de
consistencia lo detectaba.

*Arreglo aplicado:* migración aditiva `0004_form_event_step_key` (columna
nullable `step_key` en `form_event`, ambos dialectos). El renderer ahora manda
la **clave** del paso junto al índice en cada `track()`; el servicio agrupa
el drop-off por clave (`stepViewCounts.byKey`) cuando existe, con fallback a
la posición antigua (`byIndex`) solo para filas grabadas antes de esta
migración (limitación documentada, no una regresión). Ver
`packages/db/src/analytics.ts`, `apps/web/.../form-renderer.tsx`, tests
`V5-D3` en `analytics.service.spec.ts`.

## 5. Riesgos / notas

- **Perf de Time (correlated subquery por `open`):** aceptable al volumen lead-gen; un rollup diario (Fase 2) lo hace barato. Índice `form_event (form_id, session_id, type)` ayudaría si hiciera falta (aditivo).
- **Eventos top-of-funnel fire-and-forget** (`void recordEventAction`): un `view`/`step_view` puede perderse por red/adblock, subcontando el tope. Fuera de alcance de estos fixes; considerar beacon/retry si el subconteo importa.
- **Semántica "Last week/month/year" móvil vs calendario:** elegimos móvil; si el usuario espera calendario, es un cambio de `resolveRange` (client-side).
- **`account.timezone` (Fase 2):** hasta que exista, todo es UTC — documentado como comportamiento intencional.
