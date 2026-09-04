"use client";

import { useEffect } from "react";

/** Inputs, textareas, selects and anything contenteditable: a slash there is typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = (el.tagName ?? "").toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

export type GlobalShortcut = "search";

/**
 * Which shortcut a keydown means, or null. Cmd/Ctrl+K works everywhere (it
 * is the universal "find" chord and never types a character); a bare `/`
 * only outside editable fields and while no dialog is open, because there it
 * is a character someone is typing.
 */
export function shortcutFor(
  e: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "defaultPrevented"
  >,
  ctx: { editable: boolean; dialogOpen: boolean },
): GlobalShortcut | null {
  if (e.defaultPrevented || e.altKey) return null;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return "search";
  if (
    !e.metaKey &&
    !e.ctrlKey &&
    e.key === "/" &&
    !ctx.editable &&
    !ctx.dialogOpen
  )
    return "search";
  return null;
}

/** One document keydown listener that routes the page's shortcuts to `onShortcut`. */
export function useGlobalShortcut(
  onShortcut: (shortcut: GlobalShortcut, e: KeyboardEvent) => void,
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = shortcutFor(e, {
        editable: isEditableTarget(e.target),
        dialogOpen: document.querySelector('[role="dialog"]') != null,
      });
      if (!shortcut) return;
      e.preventDefault();
      onShortcut(shortcut, e);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onShortcut]);
}
