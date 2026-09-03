import { describe, expect, it } from "vitest";
import { parseBound, parseTimeZone } from "./query-params";

describe("parseBound", () => {
  it("passes epoch-ms through and reads ISO instants as-is", () => {
    expect(parseBound("1700000000000", false)).toBe(1700000000000);
    expect(parseBound("2026-09-03T10:00:00.000Z", false)).toBe(
      Date.UTC(2026, 8, 3, 10),
    );
    expect(parseBound(undefined, false)).toBeNull();
    expect(parseBound("nope", false)).toBeNull();
  });

  it("snaps a bare date to the day bounds in UTC by default", () => {
    expect(parseBound("2026-09-03", false)).toBe(Date.UTC(2026, 8, 3));
    expect(parseBound("2026-09-03", true)).toBe(Date.UTC(2026, 8, 4) - 1);
  });

  it("snaps a bare date to the day bounds in the given zone", () => {
    expect(parseBound("2026-09-03", false, "America/Bogota")).toBe(
      Date.UTC(2026, 8, 3, 5),
    );
    expect(parseBound("2026-09-03", true, "America/Bogota")).toBe(
      Date.UTC(2026, 8, 4, 5) - 1,
    );
  });
});

describe("parseTimeZone", () => {
  it("returns a known zone, UTC for an unknown one, and null when absent", () => {
    expect(parseTimeZone("America/Bogota")).toBe("America/Bogota");
    expect(parseTimeZone("Mars/Olympus")).toBe("UTC");
    expect(parseTimeZone(undefined)).toBeNull();
    expect(parseTimeZone("")).toBeNull();
  });
});
