import { describe, it, expect } from "vitest";
import {
  formatAnswerCell,
  formatAnswerValue,
  stepLabel,
  summarizeAnswers,
} from "./answer-summary";
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

describe("stepLabel", () => {
  it("is the question trimmed, markdown and tokens kept", () => {
    expect(
      stepLabel(
        step({ key: "llc", type: "text", question: "  *Nombre de tu LLC*  " }),
      ),
    ).toBe("*Nombre de tu LLC*");
    expect(
      stepLabel(
        step({ key: "why", type: "text", question: "Why, [firstname]?" }),
      ),
    ).toBe("Why, [firstname]?");
  });

  it("falls back to the key when the question is empty or missing", () => {
    expect(
      stepLabel(step({ key: "text_21", type: "text", question: "   " })),
    ).toBe("text_21");
    expect(stepLabel(step({ key: "text_22", type: "text" }))).toBe("text_22");
  });
});

describe("formatAnswerValue", () => {
  const choice = step({
    key: "kind",
    type: "multiple_choice",
    question: "Tipo de sociedad",
    options: [
      { label: "LLC de un solo miembro", value: "single" },
      { label: "LLC multimiembro", value: "multi" },
    ],
  });

  it("maps a single choice or dropdown value to its label", () => {
    expect(formatAnswerValue(choice, "multi")).toBe("LLC multimiembro");
    expect(
      formatAnswerValue(
        step({
          key: "tools",
          type: "dropdown",
          options: [{ label: "HubSpot", value: "hubspot" }],
        }),
        " hubspot ",
      ),
    ).toBe("HubSpot");
  });

  it("joins a multi-select with '; ' by default and honours a custom separator", () => {
    expect(formatAnswerValue(choice, ["single", "multi"])).toBe(
      "LLC de un solo miembro; LLC multimiembro",
    );
    expect(
      formatAnswerValue(choice, ["single", "multi"], { separator: ", " }),
    ).toBe("LLC de un solo miembro, LLC multimiembro");
  });

  it("keeps an unknown option token verbatim and skips blank tokens", () => {
    expect(formatAnswerValue(choice, ["other", "  ", "single"])).toBe(
      "other; LLC de un solo miembro",
    );
  });

  it("prints an uploaded file as its name, never the key or JSON", () => {
    const out = formatAnswerValue(step({ key: "doc", type: "file" }), {
      key: "uploads/acc/form/sub/doc/pasaporte.pdf",
      mime: "application/pdf",
      name: "pasaporte.pdf",
      size: "2048",
    });
    expect(out).toBe("pasaporte.pdf");
  });

  it("trims strings and leaves a phone untouched otherwise", () => {
    expect(
      formatAnswerValue(step({ key: "t", type: "text" }), "  Miami, FL \n"),
    ).toBe("Miami, FL");
    expect(
      formatAnswerValue(step({ key: "p", type: "phone" }), "+573180087175"),
    ).toBe("+573180087175");
  });

  it("returns an empty string for blanks and stringifies numbers and booleans", () => {
    const t = step({ key: "t", type: "text" });
    expect(formatAnswerValue(t, null)).toBe("");
    expect(formatAnswerValue(t, undefined)).toBe("");
    expect(formatAnswerValue(t, "   ")).toBe("");
    expect(formatAnswerValue(choice, [])).toBe("");
    expect(formatAnswerValue(step({ key: "s", type: "slider" }), 0)).toBe("0");
    expect(formatAnswerValue(t, false)).toBe("false");
  });

  it("formats a scheduler booking as a UTC timestamp", () => {
    expect(
      formatAnswerValue(
        step({ key: "call", type: "scheduler" }),
        "2026-09-03T14:30:00.000Z",
      ),
    ).toBe("2026-09-03 14:30 UTC");
  });
});

describe("formatAnswerValue booking time zone", () => {
  const call = step({ key: "call", type: "scheduler" });
  it("reads a booking in the workspace zone with its offset", () => {
    expect(
      formatAnswerValue(call, "2026-09-03T14:30:00.000Z", {
        timeZone: "America/Bogota",
      }),
    ).toBe("2026-09-03 09:30 GMT-5");
  });
  it("falls back to UTC for an unknown zone", () => {
    expect(
      formatAnswerValue(call, "2026-09-03T14:30:00.000Z", {
        timeZone: "Mars/Olympus",
      }),
    ).toBe("2026-09-03 14:30 UTC");
  });
});

describe("formatAnswerCell", () => {
  const t = step({ key: "t", type: "text" });
  it("prints true as a check and false as nothing", () => {
    expect(formatAnswerCell(t, true)).toBe("\u2713");
    expect(formatAnswerCell(t, false)).toBe("");
  });
  it("defers everything else to formatAnswerValue", () => {
    expect(formatAnswerCell(t, "  hi ")).toBe("hi");
  });
});
