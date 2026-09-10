/**
 * The `file` answer inside the engine: what counts as one, what the validator
 * says about it, and how it prints when the owner reads their answers.
 *
 * The answers record is a free-form map shared by every question type, so
 * `parseFileAnswer` is the single place that decides the shape. Anything that
 * renders answers goes through it instead of duck-typing the object, which is
 * what keeps an object key out of an email.
 */
import { describe, it, expect } from "vitest";
import { parseFileAnswer, validateAnswer, validateAnswerCode } from "./form-logic";
import { summarizeAnswers } from "./answer-summary";
import type { FormConfig, FormStep } from "./form-logic";

const FILE: FormStep = {
  key: "cv",
  type: "file",
  question: "Upload your CV",
  required: true,
};

const GOOD = {
  key: "uploads/a/f/s/9f3c.pdf",
  name: "Ada Lovelace CV.pdf",
  size: "40211",
  mime: "application/pdf",
};

describe("parseFileAnswer", () => {
  it("reads a well-formed answer", () => {
    expect(parseFileAnswer(GOOD)).toEqual(GOOD);
  });

  it("fills in the fields that only affect presentation", () => {
    const r = parseFileAnswer({ key: "k", name: "n.pdf" } as never);
    expect(r).toEqual({ key: "k", name: "n.pdf", size: "0", mime: "application/octet-stream" });
  });

  it("rejects anything without a real key or name", () => {
    expect(parseFileAnswer({ ...GOOD, key: "" })).toBeNull();
    expect(parseFileAnswer({ ...GOOD, key: "   " })).toBeNull();
    expect(parseFileAnswer({ ...GOOD, name: "" })).toBeNull();
    expect(parseFileAnswer({ name: "n.pdf" } as never)).toBeNull();
  });

  it("is not fooled by the other things an answer can be", () => {
    expect(parseFileAnswer("a string")).toBeNull();
    expect(parseFileAnswer(["a", "b"])).toBeNull();
    expect(parseFileAnswer(42)).toBeNull();
    expect(parseFileAnswer(null)).toBeNull();
    // The reserved `utm` blob is a string map too, and must never read as a file.
    expect(parseFileAnswer({ utm_source: "linkedin", utm_medium: "post" })).toBeNull();
  });
});

describe("validation", () => {
  it("requires an answer when the step is required", () => {
    expect(validateAnswerCode(FILE, null)).toEqual({ ok: false, code: "required" });
    expect(validateAnswer(FILE, null).ok).toBe(false);
  });

  it("lets an optional file question go unanswered", () => {
    expect(validateAnswerCode({ ...FILE, required: false }, null)).toEqual({ ok: true });
  });

  it("accepts a well-formed answer", () => {
    expect(validateAnswerCode(FILE, GOOD)).toEqual({ ok: true });
    expect(validateAnswer(FILE, GOOD).ok).toBe(true);
  });

  it("rejects a value of the wrong shape with a code of its own", () => {
    expect(validateAnswerCode(FILE, "uploads/a/f/s/9f3c.pdf")).toEqual({ ok: false, code: "file" });
    expect(validateAnswer(FILE, "uploads/a/f/s/9f3c.pdf").ok).toBe(false);
  });
});

describe("summarizeAnswers", () => {
  const config = {
    version: 1,
    steps: [FILE],
  } as unknown as FormConfig;

  it("prints the respondent's own filename and nothing else", () => {
    const rows = summarizeAnswers(config, { cv: GOOD });
    expect(rows).toEqual([{ label: "Upload your CV", value: "Ada Lovelace CV.pdf" }]);
  });

  it("keeps the object key out of the row", () => {
    const [row] = summarizeAnswers(config, { cv: GOOD });
    expect(row.value).not.toContain("uploads/");
    expect(row.value).not.toContain("9f3c");
  });

  it("omits the question entirely when no file was uploaded", () => {
    expect(summarizeAnswers(config, {})).toEqual([]);
  });
});
