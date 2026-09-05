import { describe, expect, it } from "vitest";
import { isEditableTarget, shortcutFor } from "./use-global-shortcut";

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...init,
  } as KeyboardEvent;
}

describe("shortcutFor", () => {
  it("Cmd/Ctrl+K focuses search from anywhere, even inside an input", () => {
    expect(
      shortcutFor(key({ key: "k", metaKey: true }), {
        editable: false,
        dialogOpen: false,
      }),
    ).toBe("search");
    expect(
      shortcutFor(key({ key: "K", ctrlKey: true }), {
        editable: true,
        dialogOpen: false,
      }),
    ).toBe("search");
  });

  it("a bare slash focuses search only outside editable fields and with no dialog open", () => {
    expect(
      shortcutFor(key({ key: "/" }), { editable: false, dialogOpen: false }),
    ).toBe("search");
    expect(
      shortcutFor(key({ key: "/" }), { editable: true, dialogOpen: false }),
    ).toBeNull();
    expect(
      shortcutFor(key({ key: "/" }), { editable: false, dialogOpen: true }),
    ).toBeNull();
  });

  it("ignores anything already handled, and unrelated keys", () => {
    expect(
      shortcutFor(key({ key: "/", defaultPrevented: true }), {
        editable: false,
        dialogOpen: false,
      }),
    ).toBeNull();
    expect(
      shortcutFor(key({ key: "k" }), { editable: false, dialogOpen: false }),
    ).toBeNull();
    expect(
      shortcutFor(key({ key: "k", metaKey: true, altKey: true }), {
        editable: false,
        dialogOpen: false,
      }),
    ).toBeNull();
  });
});

describe("isEditableTarget", () => {
  const el = (tag: string, extra: Record<string, unknown> = {}) =>
    ({
      tagName: tag,
      isContentEditable: false,
      ...extra,
    }) as unknown as EventTarget;
  it("treats inputs, textareas, selects and contenteditable as editable", () => {
    expect(isEditableTarget(el("INPUT"))).toBe(true);
    expect(isEditableTarget(el("TEXTAREA"))).toBe(true);
    expect(isEditableTarget(el("SELECT"))).toBe(true);
    expect(isEditableTarget(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el("DIV"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
