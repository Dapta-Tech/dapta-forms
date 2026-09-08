import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationEmailFields } from "./notification-email-fields";

const labels = {
  enabledLabel: "Send",
  enabledHint: "hint",
  subjectLabel: "Subject",
  bodyLabel: "Body",
  tokensLabel: "Tokens",
  tokensHint: "hint",
  previewLabel: "Preview",
  previewSubject: "Subject",
  tokenLabels: { formName: "Form name", answers: "Answers" },
};

function render(notice?: string | null) {
  return renderToStaticMarkup(
    createElement(NotificationEmailFields, {
      value: { enabled: true, subject: "S", body: "B" },
      onChange: () => {},
      tokens: ["formName", "answers"],
      labels,
      notice,
    }),
  );
}

describe("NotificationEmailFields notice", () => {
  it("renders the notice as a status line above the token chips when given", () => {
    const html = render("This email does not include the answers.");
    expect(html).toContain('role="status"');
    expect(html).toContain("This email does not include the answers.");
    expect(html.indexOf('role="status"')).toBeLessThan(
      html.indexOf("{{answers}}"),
    );
  });

  it("renders nothing extra without a notice", () => {
    expect(render(null)).not.toContain('role="status"');
  });
});
