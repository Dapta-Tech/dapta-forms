import { describe, it, expect } from "vitest";
import { summarizeAnswers } from "./answer-summary";
import type { FormConfig, FormStep } from "./form-logic";

const step = (
  partial: Partial<FormStep> & Pick<FormStep, "key" | "type">,
): FormStep => partial;

const config: FormConfig = {
  version: 1,
  steps: [
    step({ key: "intro", type: "message", question: "Welcome" }),
    step({ key: "name", type: "name", question: "Your name?" }),
    step({
      key: "role",
      type: "multiple_choice",
      question: "What is your role?",
      options: [
        { label: "Founder / CEO", value: "founder" },
        { label: "Marketing", value: "marketing" },
      ],
    }),
    step({
      key: "tools",
      type: "dropdown",
      question: "Which tools do you use?",
      options: [
        { label: "HubSpot", value: "hubspot" },
        { label: "Salesforce", value: "salesforce" },
      ],
    }),
    step({ key: "team_size", type: "slider", question: "Team size" }),
    step({ key: "email", type: "email", question: "Email" }),
    step({ key: "processing", type: "reveal" }),
    step({
      key: "why",
      type: "textarea",
      question: "Why, [firstname]?",
    }),
    step({ key: "call", type: "scheduler", question: "Book a call" }),
    step({ key: "nolabel", type: "text" }),
  ],
};

describe("summarizeAnswers", () => {
  it("walks the steps in order, skipping inputless steps and unanswered ones", () => {
    const rows = summarizeAnswers(config, {
      firstname: "Ana",
      lastname: "Ruiz",
      role: "founder",
      team_size: 20,
      email: "ana@acme.io",
    });
    expect(rows).toEqual([
      { label: "Your name?", value: "Ana Ruiz" },
      { label: "What is your role?", value: "Founder / CEO" },
      { label: "Team size", value: "20" },
      { label: "Email", value: "ana@acme.io" },
    ]);
  });

  it("maps option values to their labels and joins multi-selects with a comma", () => {
    const rows = summarizeAnswers(config, { tools: ["hubspot", "salesforce"] });
    expect(rows).toEqual([
      { label: "Which tools do you use?", value: "HubSpot, Salesforce" },
    ]);
  });

  it('keeps a value that matches no option verbatim (an "other" answer is still an answer)', () => {
    const rows = summarizeAnswers(config, { role: "student" });
    expect(rows).toEqual([{ label: "What is your role?", value: "student" }]);
  });

  it("resolves the question the respondent actually saw ([field] interpolation)", () => {
    const rows = summarizeAnswers(config, { firstname: "Ana", why: "Speed" });
    expect(rows).toEqual([
      { label: "Your name?", value: "Ana" },
      { label: "Why, Ana?", value: "Speed" },
    ]);
  });

  it("formats a scheduler booking as a readable UTC timestamp", () => {
    expect(
      summarizeAnswers(config, { call: "2026-09-03T14:30:00.000Z" }),
    ).toEqual([{ label: "Book a call", value: "2026-09-03 14:30 UTC" }]);
    // The renderer falls back to the literal "booked" when the provider sent no time.
    expect(summarizeAnswers(config, { call: "booked" })).toEqual([
      { label: "Book a call", value: "booked" },
    ]);
  });

  it("falls back to the step key when a step has no question", () => {
    expect(summarizeAnswers(config, { nolabel: "x" })).toEqual([
      { label: "nolabel", value: "x" },
    ]);
  });

  it("drops blank strings, empty arrays and nulls; keeps 0 and false", () => {
    const cfg: FormConfig = {
      version: 1,
      steps: [
        step({ key: "a", type: "text", question: "A" }),
        step({ key: "b", type: "multiple_choice", question: "B", options: [] }),
        step({ key: "c", type: "text", question: "C" }),
        step({ key: "d", type: "slider", question: "D" }),
        step({ key: "e", type: "text", question: "E" }),
      ],
    };
    expect(
      summarizeAnswers(cfg, { a: "   ", b: [], c: null, d: 0, e: false }),
    ).toEqual([
      { label: "D", value: "0" },
      { label: "E", value: "false" },
    ]);
  });

  it("caps a value at 2000 characters", () => {
    const rows = summarizeAnswers(config, { why: "x".repeat(2500) });
    expect(rows[0]!.value).toHaveLength(2000);
  });

  it("ignores answers with no matching step (hidden fields, UTM params)", () => {
    expect(summarizeAnswers(config, { utm_source: "linkedin" })).toEqual([]);
  });
});
