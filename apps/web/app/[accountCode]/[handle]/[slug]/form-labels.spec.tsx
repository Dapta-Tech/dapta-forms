/**
 * The renderers print the form's OWN button copy: the author's overrides,
 * else the stock copy of the language the page resolved. Pinned through
 * static markup so the public form and the builder preview (same component)
 * cannot drift from `resolveFormLabels`.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// `next/font/google` resolves at build time and has no runtime in vitest; the
// renderers only need a className from it.
vi.mock("next/font/google", () => {
  const font = () => ({
    className: "font",
    variable: "--font",
    style: { fontFamily: "font" },
  });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    IBM_Plex_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

import { FormRenderer } from "./form-renderer";
import { VerticalFormRenderer } from "./vertical-form-renderer";

const step = { key: "q1", type: "text" as const, question: "Your name?" };

function slides(
  config: Record<string, unknown>,
  locale: string,
  startAt?: number | "cover",
) {
  return renderToStaticMarkup(
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="F"
      config={{ version: 1, steps: [step], ...config } as never}
      locale={locale}
      startAt={startAt}
    />,
  );
}

describe("button copy on the public form", () => {
  it("the cover CTA is the author text, else the stock Start of the locale", () => {
    expect(
      slides(
        { cover: { enabled: true, headline: "Hi", ctaText: "Vamos" } },
        "en",
        "cover",
      ),
    ).toContain("Vamos");
    expect(
      slides({ cover: { enabled: true, headline: "Hi" } }, "es", "cover"),
    ).toContain("Comenzar");
  });

  it("the last step submits with the form-level label, else the stock Submit of the locale", () => {
    expect(slides({ labels: { submit: "Send it" } }, "es", 0)).toContain(
      "Send it",
    );
    expect(slides({}, "es", 0)).toContain("Enviar");
    expect(slides({}, "en", 0)).toContain("Submit");
  });

  it("a step’s own buttonText still wins over the form-level label", () => {
    const html = slides(
      {
        labels: { submit: "Send it" },
        steps: [{ ...step, buttonText: "Go go" }],
      },
      "en",
      0,
    );
    expect(html).toContain("Go go");
    expect(html).not.toContain("Send it");
  });

  it("the one-page layout submits with the same resolver", () => {
    const html = renderToStaticMarkup(
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="F"
        config={
          {
            version: 1,
            steps: [step],
            layout: "vertical",
            labels: { submit: "Listo" },
          } as never
        }
        locale="en"
      />,
    );
    expect(html).toContain("Listo");
  });
});
