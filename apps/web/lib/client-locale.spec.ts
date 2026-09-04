import { afterEach, describe, expect, it, vi } from "vitest";
import { publicClientLocale } from "./client-locale";

describe("publicClientLocale (the public error boundary has no request to read)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads ?lang first, then the browser language, then English", () => {
    vi.stubGlobal("location", { search: "?lang=es" });
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(publicClientLocale()).toBe("es");

    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("navigator", { language: "es-CO" });
    expect(publicClientLocale()).toBe("es");

    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(publicClientLocale()).toBe("en");
    // An unshipped ?lang is ignored, the browser still decides.
    vi.stubGlobal("location", { search: "?lang=fr" });
    vi.stubGlobal("navigator", { language: "es-CO" });
    expect(publicClientLocale()).toBe("es");
  });

  it("is safe without a window (server render of the boundary shell)", () => {
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("navigator", undefined);
    expect(publicClientLocale()).toBe("en");
  });
});
