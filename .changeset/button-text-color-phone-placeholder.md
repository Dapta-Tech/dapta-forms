---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
'@quill/mcp': minor
---

Button text color, phone placeholder and no phone focus on a one-page form.

- `branding.buttonTextColor` (`formBrandingSchema` and `FormBranding`): optional, nullable, validated as a CSS color. The label color of a solid button (`buttonStyle` resolved to `solid`): the Next / Submit button and the CTA of the final screen. Absent, `null` or blank keeps the automatic color that contrasts with `primaryColor`; ignored for `outline` and `soft`. Not part of the brand kit.
- A `phone` step's `placeholder` now replaces the automatic number mask when it is not blank; absent or blank keeps the mask, which still follows the country.
- On the one-page layout no question takes focus on load, the phone included, so an embedded form no longer scrolls its host page. Slides is unchanged.
- i18n (EN + ES): `admin.editor.design.buttonTextColor`, `buttonTextAuto`, `buttonTextLowContrast`.
- MCP: `branding.buttonTextColor` in the config schema with its description; the `phone` step type explains its placeholder.
