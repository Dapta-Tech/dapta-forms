import { describe, expect, it } from "vitest";
import { resolveFormLocale } from "./form-locale";

describe("resolveFormLocale: ?lang, then the form language, then the browser", () => {
  it("an explicit ?lang wins over everything, and only Spanish-ish values mean Spanish", () => {
    expect(
      resolveFormLocale({
        lang: "es",
        configLanguage: "en",
        acceptLanguage: "en-US",
      }),
    ).toBe("es");
    expect(
      resolveFormLocale({
        lang: "en",
        configLanguage: "es",
        acceptLanguage: "es-CO",
      }),
    ).toBe("en");
    expect(resolveFormLocale({ lang: "ES-mx" })).toBe("es");
    // A ?lang we do not ship is noise, not an ask: the author's language still wins.
    expect(resolveFormLocale({ lang: "fr", configLanguage: "es" })).toBe("es");
    expect(resolveFormLocale({ lang: "fr", acceptLanguage: "en-US" })).toBe("en");
  });

  it("the form language beats the browser", () => {
    expect(
      resolveFormLocale({
        configLanguage: "es",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("es");
    expect(
      resolveFormLocale({ configLanguage: "en", acceptLanguage: "es-CO" }),
    ).toBe("en");
  });

  it("Auto (no form language) reads the browser, like before this field existed", () => {
    expect(resolveFormLocale({ acceptLanguage: "es-CO,es;q=0.9" })).toBe("es");
    expect(resolveFormLocale({ acceptLanguage: "en-GB" })).toBe("en");
    expect(
      resolveFormLocale({ configLanguage: null, acceptLanguage: "es" }),
    ).toBe("es");
  });

  it("defaults to English with nothing at all", () => {
    expect(resolveFormLocale({})).toBe("en");
    expect(
      resolveFormLocale({ lang: "", configLanguage: null, acceptLanguage: "" }),
    ).toBe("en");
  });
});
