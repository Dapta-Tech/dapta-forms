import { describe, expect, it } from "vitest";
import {
  dayBoundsInZone,
  formatDate,
  formatDateTime,
  formatIsoWithOffset,
  isValidTimeZone,
  isoDateInZone,
  localDayIndex,
  resolveTimeZone,
  tzOffsetMs,
  utcOffsetSegments,
  zonedMidnightMs,
} from "./datetime";

const HOUR = 3_600_000;
const DAY = 86_400_000;
// New York springs forward on 2026-03-08 at 07:00Z (02:00 EST -> 03:00 EDT).
const NY_SPRING = Date.UTC(2026, 2, 8, 7, 0, 0);

describe("zone validation", () => {
  it("accepts IANA names the runtime knows and rejects the rest", () => {
    expect(isValidTimeZone("America/Bogota")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("resolveTimeZone falls back to UTC with a warning instead of throwing", () => {
    const warnings: string[] = [];
    expect(resolveTimeZone("Mars/Olympus", (m) => warnings.push(m))).toBe(
      "UTC",
    );
    expect(warnings).toHaveLength(1);
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("America/Bogota")).toBe("America/Bogota");
  });
});

describe("offsets and day math", () => {
  it("knows the offset on both sides of a DST change", () => {
    expect(tzOffsetMs(NY_SPRING - 1, "America/New_York")).toBe(-5 * HOUR);
    expect(tzOffsetMs(NY_SPRING, "America/New_York")).toBe(-4 * HOUR);
    expect(tzOffsetMs(NY_SPRING, "America/Bogota")).toBe(-5 * HOUR);
    expect(tzOffsetMs(NY_SPRING, "UTC")).toBe(0);
  });

  it("buckets an instant into the calendar day of the zone", () => {
    // 2026-09-04T03:30Z is still Sep 3 in Bogota.
    const t = Date.UTC(2026, 8, 4, 3, 30);
    expect(localDayIndex(t, "UTC")).toBe(Math.floor(t / DAY));
    expect(localDayIndex(t, "America/Bogota")).toBe(Math.floor(t / DAY) - 1);
    expect(isoDateInZone(t, "America/Bogota")).toBe("2026-09-03");
    expect(isoDateInZone(t, "UTC")).toBe("2026-09-04");
  });

  it("finds local midnight, including on the day the clocks jump", () => {
    expect(zonedMidnightMs("2026-09-03", "America/Bogota")).toBe(
      Date.UTC(2026, 8, 3, 5),
    );
    expect(zonedMidnightMs("2026-03-08", "America/New_York")).toBe(
      Date.UTC(2026, 2, 8, 5),
    );
    // A zone where midnight itself is skipped lands on the first instant that exists.
    expect(zonedMidnightMs("2026-09-06", "America/Santiago")).toBe(
      Date.UTC(2026, 8, 6, 4),
    );
  });

  it("dayBoundsInZone spans exactly the local day, 23 hours on the spring-forward day", () => {
    const b = dayBoundsInZone("2026-09-03", "America/Bogota");
    expect(b).toEqual({
      from: Date.UTC(2026, 8, 3, 5),
      to: Date.UTC(2026, 8, 4, 5) - 1,
    });
    const ny = dayBoundsInZone("2026-03-08", "America/New_York");
    expect(ny.to - ny.from + 1).toBe(23 * HOUR);
  });
});

describe("utcOffsetSegments", () => {
  it("is one segment for a fixed-offset zone and for UTC", () => {
    expect(
      utcOffsetSegments(
        Date.UTC(2026, 0, 1),
        Date.UTC(2026, 11, 31),
        "America/Bogota",
      ),
    ).toEqual([{ from: Date.UTC(2026, 0, 1), offsetMs: -5 * HOUR }]);
    expect(utcOffsetSegments(0, DAY, "UTC")).toEqual([
      { from: 0, offsetMs: 0 },
    ]);
  });

  it("splits at the exact minute of a DST change", () => {
    const segments = utcOffsetSegments(
      NY_SPRING - 3 * DAY,
      NY_SPRING + 3 * DAY,
      "America/New_York",
    );
    expect(segments).toEqual([
      { from: NY_SPRING - 3 * DAY, offsetMs: -5 * HOUR },
      { from: NY_SPRING, offsetMs: -4 * HOUR },
    ]);
  });
});

describe("formatting", () => {
  it("formats a date-time in the zone and locale", () => {
    const t = Date.UTC(2026, 8, 3, 23, 30);
    // Newer ICU prints a narrow no-break space before AM/PM; the assertion is about the zone.
    const plain = (s: string) => s.replace(/\u202f/g, " ");
    expect(
      plain(formatDateTime(t, { locale: "en", timeZone: "America/Bogota" })),
    ).toBe("Sep 3, 2026, 6:30 PM");
    expect(plain(formatDateTime(t, { locale: "en", timeZone: "UTC" }))).toBe(
      "Sep 3, 2026, 11:30 PM",
    );
    expect(formatDate(t, { locale: "en", timeZone: "Asia/Tokyo" })).toBe(
      "Sep 4, 2026",
    );
  });

  it("writes an ISO timestamp with the zone offset, UTC as +00:00", () => {
    const t = Date.UTC(2026, 8, 3, 23, 30, 15);
    expect(formatIsoWithOffset(t, "America/Bogota")).toBe(
      "2026-09-03T18:30:15-05:00",
    );
    expect(formatIsoWithOffset(t, "UTC")).toBe("2026-09-03T23:30:15+00:00");
    expect(formatIsoWithOffset(t, "Asia/Kolkata")).toBe(
      "2026-09-04T05:00:15+05:30",
    );
  });

  it("never throws on an invalid zone: everything resolves in UTC", () => {
    const t = Date.UTC(2026, 8, 3, 23, 30);
    expect(formatIsoWithOffset(t, "Mars/Olympus")).toBe(
      "2026-09-03T23:30:00+00:00",
    );
    expect(isoDateInZone(t, "Mars/Olympus")).toBe("2026-09-03");
  });
});
