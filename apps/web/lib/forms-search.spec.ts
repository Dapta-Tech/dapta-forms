import { describe, expect, it } from "vitest";
import { groupBySections, matchForm, normalize } from "./forms-search";

const forms = [
  {
    id: "a",
    name: "Lead Qualifier",
    slug: "lead-qualifier",
    folderId: "sales",
  },
  {
    id: "b",
    name: "Encuesta de satisfacción",
    slug: "encuesta",
    folderId: null,
  },
  { id: "c", name: "Demo request", slug: "demo-request", folderId: "sales" },
  { id: "d", name: "Archived quiz", slug: "quiz", folderId: "old" },
];
const folders = [
  { id: "old", name: "Archive" },
  { id: "sales", name: "Sales" },
];

describe("normalize", () => {
  it("lower-cases and strips accents so a query matches without them", () => {
    expect(normalize("Satisfacción")).toBe("satisfaccion");
    expect(normalize("  LEAD ")).toBe("lead");
  });
});

describe("matchForm", () => {
  it("matches the name or the slug, and reports the matched ranges on the name", () => {
    expect(matchForm(forms[0]!, "lead")).toEqual({
      matched: true,
      nameRanges: [[0, 4]],
    });
    // Only the slug matches: no highlight ranges on the name, but still a hit.
    expect(matchForm(forms[1]!, "encuesta")).toMatchObject({ matched: true });
    expect(matchForm(forms[1]!, "satisfaccion")).toEqual({
      matched: true,
      nameRanges: [[12, 24]],
    });
    expect(matchForm(forms[0]!, "zzz")).toEqual({
      matched: false,
      nameRanges: [],
    });
  });

  it("keeps a decomposed accent inside the highlight and survives a no-break space", () => {
    // "o" + combining acute, the NFD form some inputs produce.
    const decomposed = { name: "Satisfaccio\u0301n total", slug: "x" };
    expect(matchForm(decomposed, "satisfaccion")).toEqual({ matched: true, nameRanges: [[0, 13]] });
    expect(matchForm({ name: "Lead\u00a0Qualifier", slug: "x" }, "qualifier")).toEqual({
      matched: true,
      nameRanges: [[5, 14]],
    });
  });

  it("an empty query matches everything with no ranges", () => {
    expect(matchForm(forms[2]!, "   ")).toEqual({
      matched: true,
      nameRanges: [],
    });
  });
});

describe("groupBySections", () => {
  it("puts Unfiled first, then folders alphabetically, each with its forms in list order", () => {
    const sections = groupBySections(forms, folders, "");
    expect(sections.map((s) => s.id)).toEqual([null, "old", "sales"]);
    expect(sections.map((s) => s.forms.map((f) => f.id))).toEqual([
      ["b"],
      ["d"],
      ["a", "c"],
    ]);
    expect(sections.map((s) => s.total)).toEqual([1, 1, 2]);
  });

  it("keeps an empty folder as a section (so it can be a drop target) when there is no query", () => {
    const sections = groupBySections(
      forms,
      [...folders, { id: "new", name: "New" }],
      "",
    );
    expect(sections.find((s) => s.id === "new")).toMatchObject({
      forms: [],
      total: 0,
    });
  });

  it("with a query, hides sections without a match and keeps the total for the count", () => {
    const sections = groupBySections(forms, folders, "demo");
    expect(sections.map((s) => s.id)).toEqual(["sales"]);
    expect(sections[0]!.forms.map((f) => f.id)).toEqual(["c"]);
    expect(sections[0]!.total).toBe(2);
  });

  it("a form whose folder no longer exists shows as unfiled rather than vanishing", () => {
    const sections = groupBySections(
      [{ id: "x", name: "Orphan", slug: "orphan", folderId: "gone" }],
      folders,
      "",
    );
    expect(sections[0]!.forms.map((f) => f.id)).toEqual(["x"]);
  });
});
