import { describe, expect, it } from "vitest";
import { sameSavedContent, stableStringify } from "./stale-save";

describe("stableStringify", () => {
  it("ignores object key order at every depth (jsonb reorders keys)", () => {
    const a = {
      steps: [
        { type: "text", key: "q", options: [{ value: "1", label: "One" }] },
      ],
      version: 1,
    };
    const b = {
      version: 1,
      steps: [
        { key: "q", options: [{ label: "One", value: "1" }], type: "text" },
      ],
    };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
  it("keeps array order significant", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
  it("drops undefined members, which JSON would drop too", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(
      stableStringify({ a: 1 }),
    );
  });
});

describe("sameSavedContent", () => {
  const mine = {
    name: "Form",
    config: { version: 1, steps: [{ key: "q", type: "text" }] },
  };

  it("is true when the server holds exactly what this editor last saved", () => {
    expect(
      sameSavedContent(
        {
          name: "Form",
          config: { steps: [{ type: "text", key: "q" }], version: 1 },
        },
        mine,
      ),
    ).toBe(true);
  });
  it("ignores destinations on either side (the draft never stages them)", () => {
    const server = {
      name: "Form",
      config: { ...mine.config, destinations: [{ type: "webhook" }] },
    };
    expect(sameSavedContent(server, mine)).toBe(true);
    expect(
      sameSavedContent(mine, {
        ...mine,
        config: { ...mine.config, destinations: [] },
      }),
    ).toBe(true);
  });
  it("is false when the name changed elsewhere", () => {
    expect(sameSavedContent({ ...mine, name: "Renamed" }, mine)).toBe(false);
  });
  it("is false when a step changed elsewhere", () => {
    const server = {
      name: "Form",
      config: { version: 1, steps: [{ key: "q", type: "email" }] },
    };
    expect(sameSavedContent(server, mine)).toBe(false);
  });
  it("is false when the server sent nothing to compare", () => {
    expect(sameSavedContent(null, mine)).toBe(false);
  });
});
