import { describe, it, expect } from "vitest";
import { answersTableHtml, emailDocument } from "./render-html";

describe("answersTableHtml", () => {
  it("renders one row per answer with the label and value HTML-escaped", () => {
    const html = answersTableHtml([
      { label: "Role", value: "Founder" },
      { label: "<b>Why</b>", value: '<script>alert(1)</script> & "quotes"' },
    ]);
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("Role");
    expect(html).toContain("Founder");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Why</b>");
    expect(html).toContain("&lt;b&gt;Why&lt;/b&gt;");
    expect(html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;",
    );
  });

  it("renders an empty string when there are no rows", () => {
    expect(answersTableHtml([])).toBe("");
  });

  it("breaks long values so a URL cannot stretch the email", () => {
    expect(answersTableHtml([{ label: "Site", value: "https://x" }])).toContain(
      "word-break",
    );
  });
});

describe("emailDocument", () => {
  it("wraps the lines in a complete, responsive HTML document", () => {
    const html = emailDocument({ lang: "es", lines: ["Hola", "Segunda"] });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("Hola<br/>Segunda");
    // dapta-email splices its support footer before the closing body tag.
    expect(html.trimEnd().endsWith("</body></html>")).toBe(true);
  });

  it("does NOT escape the lines (the caller escapes text and passes trusted markup)", () => {
    const html = emailDocument({ lang: "en", lines: ["<table></table>"] });
    expect(html).toContain("<table></table>");
  });

  it("puts the lines inside a div, never a paragraph (a table inside <p> is invalid HTML)", () => {
    const html = emailDocument({ lang: "en", lines: ["x"] });
    expect(html).not.toContain("<p>");
  });

  it("lets a long link line wrap so it cannot push the card past a phone screen", () => {
    const html = emailDocument({ lang: "en", lines: ["View: https://x"] });
    expect(html).toMatch(
      /<div style="[^"]*overflow-wrap:anywhere[^"]*">View: https:\/\/x<\/div>/,
    );
  });
});
