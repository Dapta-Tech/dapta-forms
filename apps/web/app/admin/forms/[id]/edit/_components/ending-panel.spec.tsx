// @vitest-environment happy-dom
/**
 * The ending panel's "Forward UTM parameters" switch (#310): it shows only
 * when some redirect exists (the form's own, or a score range's), reflects
 * `ending.forwardUtm`, and writes it back. The appending itself is pinned in
 * the engine (`appendUtm`) and the renderers' `name-token.spec.tsx`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormConfig } from "@quill/engine";
import { getMessages } from "@quill/shared";
import { EndingPanel } from "./ending-panel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages("en").admin.editor;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mount(over: Partial<FormConfig>) {
  const onEndingChange = vi.fn();
  const config: FormConfig = {
    version: 1,
    steps: [{ key: "email", type: "email", question: "Email?" }],
    ...over,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <EndingPanel
        config={config}
        onEndingChange={onEndingChange}
        hasOutcomes={false}
        m={m}
      />,
    ),
  );
  return onEndingChange;
}

const toggle = () =>
  host!.querySelector<HTMLButtonElement>('[data-testid="ending-forward-utm"]');

describe("EndingPanel: forward UTM parameters", () => {
  it("is hidden while no redirect exists anywhere", async () => {
    await mount({ ending: { headline: "Thanks" } });
    expect(toggle()).toBeNull();
  });

  it("shows with a form-level redirect, off by default, and turns on", async () => {
    const onEndingChange = await mount({
      ending: { redirectUrl: "https://example.com/thanks" },
    });
    expect(toggle()).not.toBeNull();
    expect(toggle()!.getAttribute("aria-checked")).toBe("false");
    expect(host!.textContent).toContain(m.ending.forwardUtmHint);
    await act(async () => toggle()!.click());
    expect(onEndingChange).toHaveBeenCalledWith({ forwardUtm: true });
  });

  it("shows when only a score range redirects", async () => {
    await mount({
      outcomes: [
        {
          id: "o",
          label: "Hot",
          minScore: 0,
          redirectUrl: "https://example.com/vip",
        },
      ],
    });
    expect(toggle()).not.toBeNull();
  });

  it("reflects a stored value and turns off", async () => {
    const onEndingChange = await mount({
      ending: { redirectUrl: "https://example.com/thanks", forwardUtm: true },
    });
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle()!.click());
    expect(onEndingChange).toHaveBeenCalledWith({ forwardUtm: undefined });
  });
});

describe("redirect hints carry the privacy warning", () => {
  it("in the ending panel and the outcomes dialog, in both languages", () => {
    for (const [locale, word] of [
      ["en", /an email/],
      ["es", /correo electrónico/],
    ] as const) {
      const e = getMessages(locale).admin.editor;
      expect(e.ending.redirectHint).toMatch(word);
      expect(e.resultsHelp.redirectHelp).toMatch(word);
    }
  });
});
