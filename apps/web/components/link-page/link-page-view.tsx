import { getMessages } from '@quill/shared';
import type { PublicLinkPage } from '@quill/types';
import { MadeWithBadge } from '@/components/made-with-badge';
import { formDesignProps } from '@/lib/form-design';
import { publicFormPath } from '@/lib/public-form-path';
import { initialsOf } from '@/lib/public-page';
import { SocialIcon } from './social-icon';

/**
 * The workspace link page, as markup. The ONE renderer for it: the public
 * route (`app/[accountCode]/page.tsx`) and the editor's live preview both
 * render this component from a `PublicLinkPage`, which both get from
 * `resolveLinkPage`, so the preview cannot show a page the public does not get.
 *
 * No hooks and no handlers, so it renders on the server for the public page
 * and inside the editor's client island alike. Clicks are measured by
 * `LinkPageTracker`, which reads the `data-lp-*` attributes below; the view
 * itself knows nothing about analytics.
 *
 * Styling is the public form's (`public-form.css`, `.pf-lp*`) on the form
 * design tokens from `formDesignProps`, so the brand kit's colours, font,
 * corners and button style reach the page the way they reach a form.
 */
export function LinkPageView({
  page,
  locale,
  preview = false,
}: {
  page: PublicLinkPage;
  locale: string;
  /** Inside the editor: fits its frame instead of filling the viewport. */
  preview?: boolean;
}) {
  const m = getMessages(locale);
  const lp = m.linkPage;
  const design = formDesignProps(page.branding);
  const initials = initialsOf(page.name);

  return (
    <div
      className={preview ? 'pf pf--linkpage pf--linkpage-preview' : 'pf pf--linkpage'}
      {...design.attrs}
      style={design.style}
      data-testid="link-page"
    >
      {design.fontFace ? <style>{design.fontFace}</style> : null}
      <main className="pf-lp">
        <header className="pf-lp__head">
          {page.logo ? (
            <img className="pf-lp__logo" src={page.logo} alt="" width={96} height={96} data-testid="link-page-logo" />
          ) : (
            <span className="pf-lp__logo pf-lp__logo--initials" aria-hidden data-testid="link-page-initials">
              {initials}
            </span>
          )}
          <h1 className="pf-lp__name">{page.name}</h1>
          {page.bio ? <p className="pf-lp__bio">{page.bio}</p> : null}
        </header>

        {page.socials.length > 0 ? (
          <ul className="pf-lp__socials" aria-label={lp.socialsLabel} data-testid="link-page-socials">
            {page.socials.map((s, i) => (
              <li key={s.network}>
                {/* rel: an author-supplied outbound link gets no window
                    reference and no referrer. */}
                <a
                  className="pf-lp__social"
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={`${lp.social[s.network]} ${m.renderer.newTab}`}
                  data-lp-type="social"
                  data-lp-network={s.network}
                  data-lp-pos={i}
                  data-testid={`link-page-social-${s.network}`}
                >
                  <SocialIcon network={s.network} />
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {page.buttons.length > 0 ? (
          <ul className="pf-lp__buttons" aria-label={lp.buttonsLabel} data-testid="link-page-buttons">
            {page.buttons.map((b, i) =>
              b.type === 'form' ? (
                <li key={`form:${b.slug}:${i}`}>
                  {/* A form is part of this site: same tab, like any other
                      page of the workspace. */}
                  <a
                    className="pf__btn pf-lp__btn"
                    href={publicFormPath(page.accountCode, b.slug)}
                    data-lp-type="form"
                    data-lp-slug={b.slug}
                    data-lp-pos={i}
                  >
                    {b.label}
                  </a>
                </li>
              ) : (
                <li key={`link:${b.url}:${i}`}>
                  <a
                    className="pf__btn pf-lp__btn"
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    data-lp-type="link"
                    data-lp-pos={i}
                  >
                    {b.label}
                    <span className="sr-only"> {m.renderer.newTab}</span>
                  </a>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </main>
      <MadeWithBadge locale={locale} accountCode={page.accountCode} medium="link-page" />
    </div>
  );
}
