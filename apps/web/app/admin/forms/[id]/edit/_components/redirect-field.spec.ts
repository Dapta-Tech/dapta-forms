import { describe, expect, it } from "vitest";
import { committableRedirect, normalizeRedirect } from "./redirect-field";

/**
 * The commit rule behind the redirect input (Design tab and per-outcome). The
 * input commits on every change so a URL typed right before Publish is in the
 * draft the server publishes; the rule below is what keeps a half-typed value
 * from reaching the autosave and failing the schema's `.url()` check.
 */
describe("normalizeRedirect", () => {
  it("upgrades a schemeless entry to https://", () => {
    expect(normalizeRedirect("example.com")).toBe("https://example.com");
    expect(normalizeRedirect("  example.com/thanks  ")).toBe(
      "https://example.com/thanks",
    );
  });

  it("leaves a scheme alone and maps empty to null", () => {
    expect(normalizeRedirect("http://example.com")).toBe("http://example.com");
    expect(normalizeRedirect("HTTPS://Example.com")).toBe(
      "HTTPS://Example.com",
    );
    expect(normalizeRedirect("")).toBeNull();
    expect(normalizeRedirect("   ")).toBeNull();
  });
});

describe("committableRedirect", () => {
  it("commits every keystroke of a plain host, like the headline next to it", () => {
    // Each prefix of "tbreakthrough.com" is a valid URL once https:// is added.
    for (const typed of [
      "t",
      "tb",
      "tbreakthrough",
      "tbreakthrough.",
      "tbreakthrough.com",
    ]) {
      expect(committableRedirect(typed), typed).toBe(`https://${typed}`);
    }
  });

  it("commits a full URL with path and query as typed", () => {
    expect(committableRedirect("https://a.co/x?y=1")).toBe(
      "https://a.co/x?y=1",
    );
  });

  it("holds back text the schema would refuse", () => {
    expect(committableRedirect("exa mple")).toBeUndefined();
    expect(committableRedirect("https://")).toBeUndefined();
    expect(committableRedirect("http://")).toBeUndefined();
  });

  it("commits null for an emptied field (back to the thank-you screen)", () => {
    expect(committableRedirect("")).toBeNull();
    expect(committableRedirect("  ")).toBeNull();
  });
});
