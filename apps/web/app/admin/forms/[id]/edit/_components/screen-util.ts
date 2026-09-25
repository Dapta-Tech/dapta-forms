/**
 * The builder's side of screens (several questions on one slides screen, #200).
 *
 * The engine owns what a screen IS (`authoredScreens`, `screenIds`, and the
 * canonicalizer `normalizeScreenGroups`); this module owns what the EDITOR does
 * with one: whether a boundary can be joined and why not, where a dragged
 * question lands, where the partial point and a "reveal after" go, and which
 * steps a jump may target. Pure, so each rule is unit-tested without a DOM.
 */
import {
  MAX_SCREEN_SIZE,
  authoredScreens,
  canShareScreen,
  nameFields,
  normalizeScreenGroups,
  screensActive,
  type AuthoredScreen,
  type FormConfig,
  type FormLayout,
  type FormStep,
} from '@quill/engine';

/** Why a question cannot join the one above it. */
export type ScreenBlock = 'first' | 'solo' | 'hidden' | 'max';

export interface ScreenBoundary {
  /** The question shares a screen with the one above it. */
  joined: boolean;
  /** Why joining is not possible, when it is not (splitting always is). */
  blocked: ScreenBlock | null;
}

/** The authored screen holding step `index`, or null when it has one of its own. */
export function screenOf(steps: FormStep[], index: number): AuthoredScreen | null {
  return authoredScreens(steps).find((s) => s.members.includes(index)) ?? null;
}

/** The nearest step above `index` that is not hidden (hidden steps are transparent). */
function visibleAbove(steps: FormStep[], index: number): number {
  let above = index - 1;
  while (above >= 0 && steps[above]?.hidden) above -= 1;
  return above;
}

/** The boundary above step `index`: joined or not, and why it cannot be joined. */
export function screenBoundary(steps: FormStep[], index: number): ScreenBoundary {
  const step = steps[index];
  if (!step) return { joined: false, blocked: 'first' };
  const screens = authoredScreens(steps);
  const own = screens.find((s) => s.members.includes(index)) ?? null;
  const above = visibleAbove(steps, index);
  if (own && above >= 0 && own.members.includes(above)) return { joined: true, blocked: null };
  if (step.hidden) return { joined: false, blocked: 'hidden' };
  if (above < 0) return { joined: false, blocked: 'first' };
  if (!canShareScreen(step) || !canShareScreen(steps[above] as FormStep)) return { joined: false, blocked: 'solo' };
  const upper = screens.find((s) => s.members.includes(above));
  const size = (upper?.members.length ?? 1) + (own?.members.length ?? 1);
  return { joined: false, blocked: size > MAX_SCREEN_SIZE ? 'max' : null };
}

/**
 * The screens in author order, as step indexes: each authored screen of
 * several questions, and every other step that is not hidden on its own.
 * What the respondent walks with no answers given, minus the logic.
 */
export function screenList(steps: FormStep[]): number[][] {
  const byFirst = new Map<number, number[]>();
  const member = new Set<number>();
  for (const s of authoredScreens(steps)) {
    byFirst.set(s.members[0] as number, s.members);
    for (const i of s.members) member.add(i);
  }
  const list: number[][] = [];
  steps.forEach((step, i) => {
    const screen = byFirst.get(i);
    if (screen) list.push(screen);
    else if (!member.has(i) && !step.hidden) list.push([i]);
  });
  return list;
}

/**
 * Move a step, and decide which screen it lands on. Within its own screen it
 * stays (a reorder); dropped strictly between two questions of another screen
 * it joins that screen, within the cap; anywhere else it leaves. A question
 * that cannot join (a calendar, a reveal, a file upload, or one more on a
 * full screen) dropped inside a screen lands right after it instead, so a
 * drop never cuts a screen in two; a hidden one stays where it was dropped,
 * since it cuts nothing. The ids are then canonicalized, so a screen left with
 * one question dissolves.
 */
export function moveStep(steps: FormStep[], from: number, to: number): FormStep[] {
  const moved = steps[from];
  if (!moved || from === to) return steps;
  const own = screenOf(steps, from);
  const arr = [...steps];
  arr.splice(from, 1);
  arr.splice(to, 0, moved);
  let prev: FormStep | undefined;
  for (let i = to - 1; i >= 0 && !prev; i -= 1) if (!arr[i]?.hidden) prev = arr[i];
  let next: FormStep | undefined;
  for (let i = to + 1; i < arr.length && !next; i += 1) if (!arr[i]?.hidden) next = arr[i];
  const { screenGroup: _left, ...plain } = moved;
  if (own && (prev?.screenGroup === own.id || next?.screenGroup === own.id)) {
    arr[to] = { ...moved, screenGroup: own.id };
  } else if (prev?.screenGroup && prev.screenGroup === next?.screenGroup) {
    const inside = prev.screenGroup;
    const size = arr.filter((s) => s !== moved && s.screenGroup === inside).length;
    if (canShareScreen(moved) && size < MAX_SCREEN_SIZE) {
      arr[to] = { ...moved, screenGroup: inside };
    } else if (moved.hidden) {
      // A hidden question is transparent: it sits there and cuts nothing.
      arr[to] = plain;
    } else {
      // Dropped inside a screen it cannot join: it goes right after that screen.
      arr.splice(to, 1);
      let end = to - 1;
      for (let i = to; i < arr.length; i += 1) {
        if (arr[i]?.screenGroup === inside) end = i;
        else if (!arr[i]?.hidden) break;
      }
      arr.splice(end + 1, 0, plain);
    }
  } else {
    arr[to] = moved.screenGroup !== undefined ? plain : moved;
  }
  return normalizeScreenGroups(arr);
}

/**
 * A question shown again (hidden switched off) that sits between two
 * questions of one screen goes back into it. Hidden, it was transparent and
 * lost its id; without this, un-hiding it would cut the screen it used to
 * belong to in two. One that can never share a screen (a file upload, say,
 * hidden and dropped inside one) goes right after the screen instead, as a
 * drag would put it. One that sat at a screen's edge stays out: nothing says
 * which side it belonged to, and the settings hint warns before hiding.
 */
export function rejoinUnhidden(steps: FormStep[], index: number): FormStep[] {
  const step = steps[index];
  if (!step || step.hidden) return steps;
  const above = visibleAbove(steps, index);
  let below = index + 1;
  while (below < steps.length && steps[below]?.hidden) below += 1;
  const id = steps[above]?.screenGroup;
  if (!id || steps[below]?.screenGroup !== id) return steps;
  if (!canShareScreen(step)) {
    const arr = [...steps];
    arr.splice(index, 1);
    let end = index - 1;
    for (let i = index; i < arr.length; i += 1) {
      if (arr[i]?.screenGroup === id) end = i;
      else if (!arr[i]?.hidden) break;
    }
    arr.splice(end + 1, 0, step);
    return arr;
  }
  // No cap here: the question already sat inside the screen, and leaving it
  // out would cut the screen in two. The cap only gates new joins.
  return steps.map((s, i) => (i === index ? { ...s, screenGroup: id } : s));
}

/**
 * The authored screen whose span covers step `index`: one of its questions, or
 * a hidden step sitting between two of them (transparent, but drawn and
 * ordered inside the screen all the same).
 */
export function screenSpanning(steps: FormStep[], index: number): AuthoredScreen | null {
  return (
    authoredScreens(steps).find(
      (s) => (s.members[0] as number) <= index && index <= (s.members[s.members.length - 1] as number),
    ) ?? null
  );
}

/** The last question of the screen spanning `index` (itself when it has a screen of its own). */
export function screenEnd(steps: FormStep[], index: number): number {
  const screen = screenSpanning(steps, index);
  return screen ? (screen.members[screen.members.length - 1] as number) : index;
}

/**
 * The partial point (1-based "after step N") never sits inside a screen: one
 * that falls on a question that is not its screen's last moves after the
 * screen, which is also when it fires at runtime.
 */
export function snapAfterScreen(steps: FormStep[], afterStep: number | undefined): number | undefined {
  if (afterStep == null || afterStep < 1 || afterStep > steps.length) return afterStep;
  const end = screenEnd(steps, afterStep - 1);
  return end + 1 === afterStep ? afterStep : end + 1;
}

/**
 * Where a jump from step `from` to `key` lands, when that needs saying (slides
 * only): `'own'` for a question of the jump's own screen, which the form
 * ignores (it goes on in order, as with any target that is not ahead), and
 * `'mid'` for a question inside another screen other than its first, which
 * opens that whole screen from the top.
 */
export type JumpLanding = 'own' | 'mid' | null;

export function jumpLanding(steps: FormStep[], from: number, key: string, layout: FormLayout): JumpLanding {
  if (!screensActive({ layout })) return null;
  const target = steps.findIndex((s) => s.key === key);
  if (target < 0) return null;
  if (screenOf(steps, from)?.members.includes(target)) return 'own';
  const screen = screenOf(steps, target);
  return screen && screen.members[0] !== target ? 'mid' : null;
}

/**
 * The partial point after a reorder, when a screen decides it. The point sits
 * after a SCREEN's last question when it belongs to a screen, so when that
 * question is dragged out of its screen, the point stays after the screen
 * (now ending on the question that was above it) instead of travelling with
 * the question. Null when the usual rule applies: the point follows the
 * question it sits after.
 */
export function partialAfterScreenMove(
  pos: number | undefined,
  before: FormStep[],
  after: FormStep[],
  movedKey: string,
): number | null {
  if (pos == null) return null;
  const anchor = before[pos - 1];
  const screen = screenOf(before, pos - 1);
  if (!anchor || anchor.key !== movedKey || !screen) return null;
  const stayed = screen.members
    .map((i) => before[i]?.key)
    .filter((key) => key !== movedKey)
    .map((key) => after.findIndex((s) => s.key === key));
  const now = screenOf(after, after.findIndex((s) => s.key === movedKey));
  // Still on the same screen (a reorder within it): it is still that screen's point.
  if (now && stayed.some((i) => now.members.includes(i))) return null;
  return Math.max(...stayed) + 1;
}

/** Where the per-question "reveal after" card goes: after the question, or after its whole screen. */
export function revealSlot(config: FormConfig, index: number): number {
  return (screensActive(config) ? screenEnd(config.steps, index) : index) + 1;
}

/**
 * Screens put back in canonical shape after every edit: ids dropped on solo
 * types, hidden questions and screens of one, an id repeated in separate runs
 * re-issued, and on slides the partial point moved off the inside of a screen
 * (it fires when the screen is submitted, so it sits after its last question).
 * Returns the SAME config when nothing changes, so opening a form without
 * screens does not mark it dirty.
 */
export function withScreens(config: FormConfig): FormConfig {
  const steps = normalizeScreenGroups(config.steps);
  const partial = screensActive(config)
    ? snapAfterScreen(steps, config.partialSubmitAfterStep)
    : config.partialSubmitAfterStep;
  if (steps === config.steps && partial === config.partialSubmitAfterStep) return config;
  return { ...config, steps, partialSubmitAfterStep: partial };
}

/** Is step `index` a question of a screen of several (slides only)? */
export function onScreen(steps: FormStep[], index: number, layout: FormLayout): boolean {
  return screensActive({ layout }) && screenOf(steps, index) !== null;
}

/**
 * Does step `index` show or hide on an answer given on its own screen? Then it
 * appears and disappears while the person answers, which the builder says.
 */
export function readsOwnScreen(steps: FormStep[], index: number, layout: FormLayout): boolean {
  if (!screensActive({ layout })) return false;
  const screen = screenOf(steps, index);
  const step = steps[index];
  if (!screen || !step) return false;
  const fields = [step.showWhen?.field, step.hideWhen?.field].filter((f): f is string => !!f);
  return fields.some((field) => {
    const source = steps.findIndex((s) => s.key === field || nameFields(s).includes(field));
    return source >= 0 && screen.members.includes(source);
  });
}
