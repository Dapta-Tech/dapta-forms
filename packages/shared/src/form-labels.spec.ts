import { describe, expect, it } from "vitest";
import { resolveFormLabels } from "./form-labels";

describe("resolveFormLabels", () => {
  it("falls back to the stock renderer copy of the locale", () => {
    expect(resolveFormLabels({}, "en")).toEqual({
      back: "Back",
      next: "Next",
      submit: "Submit",
      start: "Start",
    });
    expect(resolveFormLabels({}, "es")).toEqual({
      back: "Atrás",
      next: "Siguiente",
      submit: "Enviar",
      start: "Comenzar",
    });
  });

  it("a form-level override wins over the stock copy, trimmed", () => {
    const labels = resolveFormLabels(
      { labels: { next: "  Continue  ", submit: "Send it" } },
      "es",
    );
    expect(labels.next).toBe("Continue");
    expect(labels.submit).toBe("Send it");
    expect(labels.back).toBe("Atrás");
  });

  it("a blank or null override is no override", () => {
    expect(
      resolveFormLabels({ labels: { next: "   ", back: null } }, "en").next,
    ).toBe("Next");
    expect(resolveFormLabels({ labels: null }, "en").back).toBe("Back");
  });

  it("the cover CTA keeps its own field", () => {
    expect(resolveFormLabels({ cover: { ctaText: "Go" } }, "en").start).toBe(
      "Go",
    );
    expect(resolveFormLabels({ cover: { ctaText: "  " } }, "es").start).toBe(
      "Comenzar",
    );
  });
});
