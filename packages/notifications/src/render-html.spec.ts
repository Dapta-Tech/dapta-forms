import { describe, it, expect } from "vitest";
import { answersTableHtml, autolinkEscaped, emailDocument, linkHtml } from "./render-html";
import { escapeHtml } from "./util";

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

describe("autolinkEscaped", () => {
  const hrefs = (line: string) =>
    [...autolinkEscaped(escapeHtml(line)).matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

  it("links a URL written in prose and leaves the sentence's punctuation outside", () => {
    expect(hrefs("Agenda aquí: https://calendly.com/dapta/intro.")).toEqual(["https://calendly.com/dapta/intro"]);
    expect(hrefs("(ver https://x.io/a), gracias")).toEqual(["https://x.io/a"]);
    expect(autolinkEscaped(escapeHtml("Ve a https://x.io."))).toMatch(/<\/a>\.$/);
  });

  it("keeps a query string, an entity and a parenthesis the URL opened", () => {
    expect(hrefs("https://x.io/?a=1&b=2")).toEqual(["https://x.io/?a=1&amp;b=2"]);
    expect(hrefs("https://en.wikipedia.org/wiki/Form_(HTML)")).toEqual(["https://en.wikipedia.org/wiki/Form_(HTML)"]);
  });

  it("ends the URL at a quote and never swallows a token written after it", () => {
    expect(hrefs('Link: "https://x.io/a"')).toEqual(["https://x.io/a"]);
    expect(autolinkEscaped("https://x.io/{{formName}}")).toContain("</a>{{formName}}");
  });

  it("links several URLs and leaves other schemes and bare hosts alone", () => {
    expect(hrefs("https://a.io y http://b.io")).toEqual(["https://a.io", "http://b.io"]);
    expect(hrefs("javascript:alert(1) www.x.io https://")).toEqual([]);
  });
});

describe("linkHtml", () => {
  it("links an http(s) URL, escaped", () => {
    expect(linkHtml("https://x.io/a?b=1&c=2")).toMatch(
      /^<a href="https:\/\/x\.io\/a\?b=1&amp;c=2" style="[^"]+">https:\/\/x\.io\/a\?b=1&amp;c=2<\/a>$/,
    );
  });

  it("never links another scheme or an empty value", () => {
    expect(linkHtml("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(linkHtml("")).toBe("");
    expect(linkHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("emailDocument", () => {
  it("brands the card: accent bar and the wordmark image when a logo URL is given", () => {
    const html = emailDocument({ lang: "en", lines: ["x"], logoUrl: "https://app.example.com/email/dforms-wordmark.png" });
    expect(html).toContain("background:#3ddc84");
    expect(html).toContain('<img src="https://app.example.com/email/dforms-wordmark.png"');
    expect(html).toContain('alt="dForms"');
  });

  it("draws the growth button at the foot of the card, escaped", () => {
    const html = emailDocument({
      lang: "es",
      lines: ["x"],
      cta: { question: "¿Quieres tu propio formulario?", action: "Crea tu formulario gratis", href: "https://dforms.ai/?a=1&b=2" },
    });
    expect(html).toContain("¿Quieres tu propio formulario?");
    expect(html).toContain('bgcolor="#3ddc84"');
    expect(html).toMatch(/<a href="https:\/\/dforms\.ai\/\?a=1&amp;b=2"[^>]*>Crea tu formulario gratis<\/a>/);
    // Still inside the card: the card table closes after the button row.
    expect(html.indexOf("Crea tu formulario gratis")).toBeLessThan(html.indexOf("</body>"));
  });

  it("draws no button without one, or with a link that is not http(s)", () => {
    expect(emailDocument({ lang: "en", lines: ["x"] })).not.toContain("bgcolor=");
    expect(
      emailDocument({ lang: "en", lines: ["x"], cta: { question: "q", action: "a", href: "javascript:alert(1)" } }),
    ).not.toContain("bgcolor=");
  });

  it("asks clients not to auto-invert the light card", () => {
    expect(emailDocument({ lang: "en", lines: ["x"] })).toContain('name="color-scheme" content="light"');
  });

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
