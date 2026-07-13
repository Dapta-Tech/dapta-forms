/**
 * i18n message catalog (EN/ES). Deliberately minimal for the skeleton: only the
 * message groups the current surfaces use (login + growth badge). Phase 1 grows
 * this catalog alongside the real admin/editor/renderer UI — same mechanism as
 * before: typed catalog, `getMessages(locale)`, `{var}` interpolation via `t()`.
 */

export type Locale = 'en' | 'es';

export interface FormsMessages {
  /** The growth badge + SEO copy on public form pages. */
  growth: {
    madeWith: string;
    ctaQuestion: string;
    ctaAction: string;
    /** SEO/OG meta description for a public form page. */
    seoForm: string;
  };
  admin: {
    login: {
      title: string;
      subtitle: string;
      continue: string;
      footnote: string;
      emailLabel: string;
      emailPlaceholder: string;
      emailInvalid: string;
      workosCta: string;
      workosSubtitle: string;
      error: string;
      retry: string;
    };
  };
}

export const en: FormsMessages = {
  growth: {
    madeWith: 'Made with Dapta Forms',
    ctaQuestion: 'Want your own form?',
    ctaAction: 'Get Dapta Forms — free',
    seoForm: 'Fill out {name} online.',
  },
  admin: {
    login: {
      title: 'Sign in',
      subtitle:
        'Open-source forms. This build uses the local dev provider — enter your email to sign in as yourself.',
      continue: 'Continue',
      footnote:
        'Local mode: any email signs you into its own workspace. Configure WorkOS in your deployment for real accounts.',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      emailInvalid: 'Enter a valid email address.',
      workosCta: 'Continue with Dapta',
      workosSubtitle: 'You’ll be redirected to sign in securely.',
      error: 'Something went wrong signing in. Please try again.',
      retry: 'Try again',
    },
  },
};

export const es: FormsMessages = {
  growth: {
    madeWith: 'Hecho con Dapta Forms',
    ctaQuestion: '¿Quieres tu propio formulario?',
    ctaAction: 'Consigue Dapta Forms — gratis',
    seoForm: 'Completa {name} en línea.',
  },
  admin: {
    login: {
      title: 'Iniciar sesión',
      subtitle:
        'Formularios de código abierto. Esta versión usa el proveedor de desarrollo local — introduce tu correo para entrar como tú mismo.',
      continue: 'Continuar',
      footnote:
        'Modo local: cualquier correo entra a su propio espacio. Configura WorkOS en tu despliegue para cuentas reales.',
      emailLabel: 'Correo',
      emailPlaceholder: 'tu@ejemplo.com',
      emailInvalid: 'Introduce un correo válido.',
      workosCta: 'Continuar con Dapta',
      workosSubtitle: 'Te redirigiremos para iniciar sesión de forma segura.',
      error: 'Algo salió mal al iniciar sesión. Inténtalo de nuevo.',
      retry: 'Reintentar',
    },
  },
};

export const messages = { en, es } as const;

export function getMessages(locale: string): FormsMessages {
  return locale === 'es' ? es : en;
}

/** Tiny `{var}` interpolation for catalog strings. Unknown tokens render empty. */
export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : '',
  );
}
