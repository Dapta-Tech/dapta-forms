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
  /** Public form-renderer chrome (all user content comes from the form config). */
  renderer: {
    start: string;
    back: string;
    next: string;
    submit: string;
    submitting: string;
    thankYouTitle: string;
    thankYouBody: string; // {name}
    ctaQuestion: string;
    ctaAction: string;
    progressLabel: string; // {current} {total}
    revealHeadline: string;
    revealSubtitle: string;
    noSteps: string;
    dropdownPlaceholder: string;
    dropdownEmpty: string;
    trustedBy: string;
    newTab: string;
    errors: {
      required: string;
      email: string;
      work_email: string;
      phone: string;
      number: string;
      too_low: string;
      too_high: string;
      option: string;
      submit: string;
    };
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
    /** The forms list (index) page. */
    forms: {
      title: string;
      subtitle: string;
      create: string;
      createTitle: string;
      nameLabel: string;
      namePlaceholder: string;
      cancel: string;
      emptyTitle: string;
      emptyBody: string;
      updated: string;
      duplicate: string;
      delete: string;
      deleteConfirm: string;
      copy: string;
      copied: string;
      open: string;
    };
    /** The form editor (builder). */
    editor: {
      back: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      previewBtn: string;
      formNamePlaceholder: string;
      tabs: { build: string; cover: string; outcomes: string; flow: string };
      steps: {
        title: string;
        add: string;
        addType: string;
        empty: string;
        select: string;
        delete: string;
        deleteConfirm: string;
        dragHint: string;
        stepN: string;
        untitled: string;
      };
      types: {
        text: string;
        name: string;
        email: string;
        phone: string;
        dropdown: string;
        multiple_choice: string;
        slider: string;
        textarea: string;
        message: string;
      };
      props: {
        type: string;
        question: string;
        questionPlaceholder: string;
        helper: string;
        placeholder: string;
        required: string;
        buttonText: string;
        buttonTextPlaceholder: string;
        flowGroup: string;
        qualification: string;
        leadCapture: string;
        flowGroupHint: string;
        corporateEmailOnly: string;
        corporateEmailHint: string;
        phoneMinDigits: string;
        sliderMin: string;
        sliderMax: string;
        sliderStep: string;
        sliderDefault: string;
      };
      options: {
        title: string;
        add: string;
        label: string;
        value: string;
        points: string;
        icon: string;
        remove: string;
        empty: string;
      };
      sliderScoring: {
        title: string;
        hint: string;
        add: string;
        min: string;
        max: string;
        points: string;
        remove: string;
        empty: string;
      };
      logic: {
        title: string;
        showWhen: string;
        hideWhen: string;
        none: string;
        field: string;
        values: string;
        valuesHint: string;
        clear: string;
        noPriorFields: string;
      };
      variants: {
        title: string;
        hint: string;
        enable: string;
        field: string;
        add: string;
        matchValue: string;
        matchValuePlaceholder: string;
        variantQuestion: string;
        fallback: string;
        remove: string;
        interpolationHint: string;
      };
      cover: {
        title: string;
        subtitle: string;
        enabled: string;
        bannerText: string;
        eyebrow: string;
        headline: string;
        subheadline: string;
        ctaText: string;
        trustBadge: string;
        branding: string;
        primaryColor: string;
        primaryColorHint: string;
      };
      outcomes: {
        title: string;
        subtitle: string;
        scoringEnabled: string;
        scoringHint: string;
        add: string;
        label: string;
        labelPlaceholder: string;
        minScore: string;
        redirectUrl: string;
        redirectPlaceholder: string;
        remove: string;
        empty: string;
      };
      flow: {
        title: string;
        subtitle: string;
        cover: string;
        end: string;
        conditional: string;
        empty: string;
      };
      preview: {
        title: string;
        empty: string;
        coverTitle: string;
        step: string;
        of: string;
        device: string;
        mobile: string;
        desktop: string;
        close: string;
      };
    };
    /** Cross-page tabs shown on a form's analytics/submissions surfaces. */
    nav: {
      edit: string;
      analytics: string;
      submissions: string;
      integrations: string;
      backToForms: string;
    };
    /** The analytics dashboard (funnel + per-step drop-off). */
    analytics: {
      title: string;
      subtitle: string;
      metricViews: string;
      metricStarts: string;
      metricSubmissions: string;
      metricCompletionRate: string;
      metricAvgTime: string;
      metricPartials: string;
      rangeLast7: string;
      rangeLast30: string;
      rangeLast90: string;
      rangeAll: string;
      rangeCustom: string;
      rangeFrom: string;
      rangeTo: string;
      rangeApply: string;
      dropoffTitle: string;
      dropoffSubtitle: string;
      colStep: string;
      colViews: string;
      colDropoff: string;
      coverRow: string;
      emptyTitle: string;
      emptyBody: string;
      error: string;
      retry: string;
      seconds: string; // short unit, e.g. "s"
    };
    /** The submissions table (responses + CSV export + delete). */
    submissions: {
      title: string;
      subtitle: string;
      statusAll: string;
      statusCompleted: string;
      statusPartial: string;
      badgeCompleted: string;
      badgePartial: string;
      colSubmitted: string;
      colStatus: string;
      colScore: string;
      export: string;
      exporting: string;
      delete: string;
      deleteConfirm: string;
      emptyTitle: string;
      emptyBody: string;
      prev: string;
      next: string;
      /** "{from}–{to} of {total}" */
      showing: string;
      na: string;
      error: string;
      retry: string;
    };
    integrations: {
      title: string;
      subtitle: string;
      back: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      loadError: string;
      enabled: string;
      disabled: string;
      // Webhook
      webhookTitle: string;
      webhookDesc: string;
      webhookUrl: string;
      webhookUrlPlaceholder: string;
      webhookUrlInvalid: string;
      webhookSecret: string;
      webhookSecretHelp: string;
      // HubSpot
      hubspotTitle: string;
      hubspotDesc: string;
      hubspotDisabled: string;
      hubspotLoading: string;
      fieldMappings: string;
      fieldMappingsHelp: string;
      utmMappings: string;
      utmMappingsHelp: string;
      scoreProperty: string;
      dateProperty: string;
      createNote: string;
      createNoteHelp: string;
      selectProperty: string;
      noProperty: string;
      addMapping: string;
      remove: string;
      stepKey: string;
      property: string;
      emptyMappings: string;
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
  renderer: {
    start: 'Start',
    back: 'Back',
    next: 'Next',
    submit: 'Submit',
    submitting: 'Submitting…',
    thankYouTitle: 'Thank you!',
    thankYouBody: 'Your responses to “{name}” were recorded.',
    ctaQuestion: 'Want your own form?',
    ctaAction: 'Get Dapta Forms — free',
    progressLabel: 'Step {current} of {total}',
    revealHeadline: 'Reviewing your answers…',
    revealSubtitle: 'One moment while we match you with the best next step.',
    noSteps: 'This form has no steps yet.',
    dropdownPlaceholder: 'Type to search…',
    dropdownEmpty: 'No results found',
    trustedBy: 'Trusted by',
    newTab: '(opens in a new tab)',
    errors: {
      required: 'This field is required.',
      email: 'Enter a valid email address.',
      work_email: 'Please use your work email address.',
      phone: 'Enter a valid phone number.',
      number: 'Enter a number.',
      too_low: 'Value is too low.',
      too_high: 'Value is too high.',
      option: 'Choose one of the available options.',
      submit: 'Could not submit — please try again.',
    },
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
    forms: {
      title: 'Forms',
      subtitle: 'Build a form, share the public link, collect submissions.',
      create: 'Create form',
      createTitle: 'Create a new form',
      nameLabel: 'Form name',
      namePlaceholder: 'e.g. Lead qualification quiz',
      cancel: 'Cancel',
      emptyTitle: 'No forms yet',
      emptyBody: 'Create your first form to start collecting responses.',
      updated: 'Updated {when}',
      duplicate: 'Duplicate',
      delete: 'Delete',
      deleteConfirm: 'Delete this form and all its submissions?',
      copy: 'Copy link',
      copied: 'Copied',
      open: 'Open',
    },
    editor: {
      back: 'Back to forms',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveError: 'Could not save — please try again.',
      previewBtn: 'Preview',
      formNamePlaceholder: 'Form name',
      tabs: { build: 'Build', cover: 'Cover', outcomes: 'Outcomes', flow: 'Flow' },
      steps: {
        title: 'Steps',
        add: 'Add step',
        addType: 'Step type',
        empty: 'No steps yet. Add your first step.',
        select: 'Select a step to edit it.',
        delete: 'Delete step',
        deleteConfirm: 'Delete this step?',
        dragHint: 'Drag to reorder',
        stepN: 'Step {n}',
        untitled: 'Untitled step',
      },
      types: {
        text: 'Text',
        name: 'Full name',
        email: 'Email',
        phone: 'Phone',
        dropdown: 'Dropdown',
        multiple_choice: 'Multiple choice',
        slider: 'Slider',
        textarea: 'Long text',
        message: 'Message (no input)',
      },
      props: {
        type: 'Type',
        question: 'Question',
        questionPlaceholder: 'What do you want to ask?',
        helper: 'Helper text',
        placeholder: 'Placeholder',
        required: 'Required',
        buttonText: 'Button text',
        buttonTextPlaceholder: 'Continue',
        flowGroup: 'Flow group',
        qualification: 'Qualification',
        leadCapture: 'Lead capture',
        flowGroupHint: 'Lead-capture fields (name, email, phone) never contribute to the score.',
        corporateEmailOnly: 'Require work email',
        corporateEmailHint: 'Blocks Gmail, Hotmail, Yahoo and other personal domains.',
        phoneMinDigits: 'Minimum digits',
        sliderMin: 'Min',
        sliderMax: 'Max',
        sliderStep: 'Step',
        sliderDefault: 'Default',
      },
      options: {
        title: 'Options',
        add: 'Add option',
        label: 'Label',
        value: 'Value',
        points: 'Points',
        icon: 'Icon',
        remove: 'Remove option',
        empty: 'No options yet.',
      },
      sliderScoring: {
        title: 'Slider scoring',
        hint: 'Award points when the value falls inside a range.',
        add: 'Add range',
        min: 'From',
        max: 'To',
        points: 'Points',
        remove: 'Remove range',
        empty: 'No scoring ranges — the slider does not score.',
      },
      logic: {
        title: 'Conditional visibility',
        showWhen: 'Show when',
        hideWhen: 'Hide when',
        none: 'Always show',
        field: 'Field',
        values: 'Matches any of',
        valuesHint: 'Comma-separated values from that field’s options.',
        clear: 'Clear',
        noPriorFields: 'Add a step before this one to branch on its answer.',
      },
      variants: {
        title: 'Dynamic question',
        hint: 'Ask a different question depending on an earlier answer.',
        enable: 'Vary the question by a field',
        field: 'Based on field',
        add: 'Add variant',
        matchValue: 'When answer is',
        matchValuePlaceholder: 'e.g. founder',
        variantQuestion: 'Ask instead',
        fallback: 'Fallback (any other answer)',
        remove: 'Remove variant',
        interpolationHint: 'Use [field] to insert an earlier answer into the question.',
      },
      cover: {
        title: 'Cover screen',
        subtitle: 'The intro screen shown before the first step.',
        enabled: 'Show a cover screen',
        bannerText: 'Banner text',
        eyebrow: 'Eyebrow',
        headline: 'Headline',
        subheadline: 'Subheadline',
        ctaText: 'Start button text',
        trustBadge: 'Trust badge',
        branding: 'Branding',
        primaryColor: 'Primary color',
        primaryColorHint: 'Drives the accent on the public form. Auto-adjusted for contrast.',
      },
      outcomes: {
        title: 'Outcomes',
        subtitle: 'Route respondents by their score. The highest bucket they clear wins.',
        scoringEnabled: 'Enable scoring',
        scoringHint: 'When off, every submission scores 0 and no outcome is resolved.',
        add: 'Add outcome',
        label: 'Label',
        labelPlaceholder: 'e.g. Hot lead',
        minScore: 'Minimum score',
        redirectUrl: 'Redirect URL',
        redirectPlaceholder: 'https://…',
        remove: 'Remove outcome',
        empty: 'No outcomes yet. Add buckets to route by score.',
      },
      flow: {
        title: 'Flow overview',
        subtitle: 'A read-only map of the form, including conditional branches.',
        cover: 'Cover',
        end: 'End',
        conditional: 'Conditional',
        empty: 'Add steps to see the flow.',
      },
      preview: {
        title: 'Live preview',
        empty: 'Select a step to preview it.',
        coverTitle: 'Cover',
        step: 'Step',
        of: 'of',
        device: 'Device preview',
        mobile: 'Mobile',
        desktop: 'Desktop',
        close: 'Close',
      },
    },
    nav: {
      edit: 'Edit',
      analytics: 'Analytics',
      submissions: 'Submissions',
      integrations: 'Integrations',
      backToForms: 'Back to forms',
    },
    analytics: {
      title: 'Analytics',
      subtitle: 'Funnel performance and question-by-question drop-off.',
      metricViews: 'Views',
      metricStarts: 'Starts',
      metricSubmissions: 'Submissions',
      metricCompletionRate: 'Completion rate',
      metricAvgTime: 'Avg. time to complete',
      metricPartials: 'Partial submits',
      rangeLast7: 'Last 7 days',
      rangeLast30: 'Last 30 days',
      rangeLast90: 'Last 90 days',
      rangeAll: 'All time',
      rangeCustom: 'Custom',
      rangeFrom: 'From',
      rangeTo: 'To',
      rangeApply: 'Apply',
      dropoffTitle: 'Question-by-question drop-off',
      dropoffSubtitle: 'How many people reach each step, and how many leave.',
      colStep: 'Step',
      colViews: 'Views',
      colDropoff: 'Drop-off',
      coverRow: 'Cover / landing',
      emptyTitle: 'No data yet',
      emptyBody: 'Once people open and fill out this form, the funnel and drop-off will appear here.',
      error: 'Couldn’t load analytics.',
      retry: 'Try again',
      seconds: 's',
    },
    submissions: {
      title: 'Submissions',
      subtitle: 'Every response to this form.',
      statusAll: 'All',
      statusCompleted: 'Completed',
      statusPartial: 'Partial',
      badgeCompleted: 'Completed',
      badgePartial: 'Partial',
      colSubmitted: 'Submitted',
      colStatus: 'Status',
      colScore: 'Score',
      export: 'Download CSV',
      exporting: 'Preparing…',
      delete: 'Delete',
      deleteConfirm: 'Delete this submission? This cannot be undone.',
      emptyTitle: 'No submissions yet',
      emptyBody: 'Responses will show up here as people complete the form.',
      prev: 'Previous',
      next: 'Next',
      showing: '{from}–{to} of {total}',
      na: '—',
      error: 'Couldn’t load submissions.',
      retry: 'Try again',
    },
    integrations: {
      title: 'Integrations',
      subtitle: 'Send each submission to your CRM or a webhook. Delivery is durable and retried.',
      back: '← Back to forms',
      save: 'Save integrations',
      saving: 'Saving…',
      saved: 'Integrations saved.',
      saveError: 'Could not save integrations.',
      loadError: 'Could not load integrations.',
      enabled: 'Enabled',
      disabled: 'Disabled',
      webhookTitle: 'Webhook',
      webhookDesc: 'POST each submission as JSON to a URL you control.',
      webhookUrl: 'Endpoint URL',
      webhookUrlPlaceholder: 'https://example.com/webhooks/forms',
      webhookUrlInvalid: 'Enter a valid https:// URL (plain http is allowed only for localhost).',
      webhookSecret: 'Signing secret (optional)',
      webhookSecretHelp:
        'When set, each request is signed with HMAC-SHA256 in the X-Quill-Signature header so you can verify it.',
      hubspotTitle: 'HubSpot',
      hubspotDesc: 'Upsert the respondent as a contact and attach a note on completed submissions.',
      hubspotDisabled:
        'HubSpot is not configured on this server (HUBSPOT_PRIVATE_APP_TOKEN). Property lookup is unavailable, but you can still save a mapping to use once it is set.',
      hubspotLoading: 'Loading HubSpot properties…',
      fieldMappings: 'Field mappings',
      fieldMappingsHelp: 'Map a form step key to a HubSpot contact property. Map one step to “email”.',
      utmMappings: 'UTM mappings',
      utmMappingsHelp: 'Map captured UTM values to HubSpot contact properties.',
      scoreProperty: 'Score property',
      dateProperty: 'Submitted-date property',
      createNote: 'Create a note on completed submissions',
      createNoteHelp: 'Attaches a note with the form name and score to the contact.',
      selectProperty: 'Select a property…',
      noProperty: '— none —',
      addMapping: 'Add mapping',
      remove: 'Remove',
      stepKey: 'Form step key',
      property: 'HubSpot property',
      emptyMappings: 'No mappings yet.',
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
  renderer: {
    start: 'Comenzar',
    back: 'Atrás',
    next: 'Siguiente',
    submit: 'Enviar',
    submitting: 'Enviando…',
    thankYouTitle: '¡Gracias!',
    thankYouBody: 'Tus respuestas a «{name}» quedaron registradas.',
    ctaQuestion: '¿Quieres tu propio formulario?',
    ctaAction: 'Consigue Dapta Forms — gratis',
    progressLabel: 'Paso {current} de {total}',
    revealHeadline: 'Revisando tus respuestas…',
    revealSubtitle: 'Un momento mientras encontramos el mejor siguiente paso para ti.',
    noSteps: 'Este formulario aún no tiene pasos.',
    dropdownPlaceholder: 'Escribe para buscar…',
    dropdownEmpty: 'No se encontraron resultados',
    trustedBy: 'Confían en nosotros',
    newTab: '(se abre en una pestaña nueva)',
    errors: {
      required: 'Este campo es obligatorio.',
      email: 'Introduce un correo válido.',
      work_email: 'Usa tu correo corporativo.',
      phone: 'Introduce un número de teléfono válido.',
      number: 'Introduce un número.',
      too_low: 'El valor es muy bajo.',
      too_high: 'El valor es muy alto.',
      option: 'Elige una de las opciones disponibles.',
      submit: 'No se pudo enviar. Inténtalo de nuevo.',
    },
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
    forms: {
      title: 'Formularios',
      subtitle: 'Crea un formulario, comparte el enlace público y recibe respuestas.',
      create: 'Crear formulario',
      createTitle: 'Crear un formulario nuevo',
      nameLabel: 'Nombre del formulario',
      namePlaceholder: 'p. ej. Cuestionario de calificación de leads',
      cancel: 'Cancelar',
      emptyTitle: 'Aún no hay formularios',
      emptyBody: 'Crea tu primer formulario para empezar a recibir respuestas.',
      updated: 'Actualizado {when}',
      duplicate: 'Duplicar',
      delete: 'Eliminar',
      deleteConfirm: '¿Eliminar este formulario y todas sus respuestas?',
      copy: 'Copiar enlace',
      copied: 'Copiado',
      open: 'Abrir',
    },
    editor: {
      back: 'Volver a formularios',
      save: 'Guardar',
      saving: 'Guardando…',
      saved: 'Guardado.',
      saveError: 'No se pudo guardar — inténtalo de nuevo.',
      previewBtn: 'Vista previa',
      formNamePlaceholder: 'Nombre del formulario',
      tabs: { build: 'Construir', cover: 'Portada', outcomes: 'Resultados', flow: 'Flujo' },
      steps: {
        title: 'Pasos',
        add: 'Añadir paso',
        addType: 'Tipo de paso',
        empty: 'Aún no hay pasos. Añade el primero.',
        select: 'Selecciona un paso para editarlo.',
        delete: 'Eliminar paso',
        deleteConfirm: '¿Eliminar este paso?',
        dragHint: 'Arrastra para reordenar',
        stepN: 'Paso {n}',
        untitled: 'Paso sin título',
      },
      types: {
        text: 'Texto',
        name: 'Nombre completo',
        email: 'Correo',
        phone: 'Teléfono',
        dropdown: 'Desplegable',
        multiple_choice: 'Opción múltiple',
        slider: 'Deslizador',
        textarea: 'Texto largo',
        message: 'Mensaje (sin campo)',
      },
      props: {
        type: 'Tipo',
        question: 'Pregunta',
        questionPlaceholder: '¿Qué quieres preguntar?',
        helper: 'Texto de ayuda',
        placeholder: 'Marcador de posición',
        required: 'Obligatorio',
        buttonText: 'Texto del botón',
        buttonTextPlaceholder: 'Continuar',
        flowGroup: 'Grupo de flujo',
        qualification: 'Calificación',
        leadCapture: 'Captura de lead',
        flowGroupHint: 'Los campos de captura (nombre, correo, teléfono) nunca suman al puntaje.',
        corporateEmailOnly: 'Exigir correo corporativo',
        corporateEmailHint: 'Bloquea Gmail, Hotmail, Yahoo y otros dominios personales.',
        phoneMinDigits: 'Dígitos mínimos',
        sliderMin: 'Mín',
        sliderMax: 'Máx',
        sliderStep: 'Paso',
        sliderDefault: 'Predeterminado',
      },
      options: {
        title: 'Opciones',
        add: 'Añadir opción',
        label: 'Etiqueta',
        value: 'Valor',
        points: 'Puntos',
        icon: 'Ícono',
        remove: 'Quitar opción',
        empty: 'Aún no hay opciones.',
      },
      sliderScoring: {
        title: 'Puntaje del deslizador',
        hint: 'Otorga puntos cuando el valor cae dentro de un rango.',
        add: 'Añadir rango',
        min: 'Desde',
        max: 'Hasta',
        points: 'Puntos',
        remove: 'Quitar rango',
        empty: 'Sin rangos de puntaje — el deslizador no suma.',
      },
      logic: {
        title: 'Visibilidad condicional',
        showWhen: 'Mostrar cuando',
        hideWhen: 'Ocultar cuando',
        none: 'Mostrar siempre',
        field: 'Campo',
        values: 'Coincide con',
        valuesHint: 'Valores separados por comas de las opciones de ese campo.',
        clear: 'Limpiar',
        noPriorFields: 'Añade un paso antes de este para ramificar por su respuesta.',
      },
      variants: {
        title: 'Pregunta dinámica',
        hint: 'Haz una pregunta distinta según una respuesta anterior.',
        enable: 'Variar la pregunta según un campo',
        field: 'Según el campo',
        add: 'Añadir variante',
        matchValue: 'Cuando la respuesta sea',
        matchValuePlaceholder: 'p. ej. fundador',
        variantQuestion: 'Preguntar en su lugar',
        fallback: 'Alternativa (cualquier otra respuesta)',
        remove: 'Quitar variante',
        interpolationHint: 'Usa [campo] para insertar una respuesta anterior en la pregunta.',
      },
      cover: {
        title: 'Portada',
        subtitle: 'La pantalla de introducción antes del primer paso.',
        enabled: 'Mostrar una portada',
        bannerText: 'Texto del banner',
        eyebrow: 'Antetítulo',
        headline: 'Titular',
        subheadline: 'Subtítulo',
        ctaText: 'Texto del botón de inicio',
        trustBadge: 'Sello de confianza',
        branding: 'Marca',
        primaryColor: 'Color primario',
        primaryColorHint: 'Define el acento del formulario público. Se ajusta para contraste.',
      },
      outcomes: {
        title: 'Resultados',
        subtitle: 'Enruta según el puntaje. Gana el rango más alto que alcancen.',
        scoringEnabled: 'Activar puntaje',
        scoringHint: 'Si está desactivado, todo suma 0 y no se resuelve ningún resultado.',
        add: 'Añadir resultado',
        label: 'Etiqueta',
        labelPlaceholder: 'p. ej. Lead caliente',
        minScore: 'Puntaje mínimo',
        redirectUrl: 'URL de redirección',
        redirectPlaceholder: 'https://…',
        remove: 'Quitar resultado',
        empty: 'Aún no hay resultados. Añade rangos para enrutar por puntaje.',
      },
      flow: {
        title: 'Vista del flujo',
        subtitle: 'Un mapa de solo lectura del formulario, incluidas las ramas condicionales.',
        cover: 'Portada',
        end: 'Fin',
        conditional: 'Condicional',
        empty: 'Añade pasos para ver el flujo.',
      },
      preview: {
        title: 'Vista previa en vivo',
        empty: 'Selecciona un paso para previsualizarlo.',
        coverTitle: 'Portada',
        step: 'Paso',
        of: 'de',
        device: 'Vista por dispositivo',
        mobile: 'Móvil',
        desktop: 'Escritorio',
        close: 'Cerrar',
      },
    },
    nav: {
      edit: 'Editar',
      analytics: 'Analíticas',
      submissions: 'Respuestas',
      integrations: 'Integraciones',
      backToForms: 'Volver a formularios',
    },
    analytics: {
      title: 'Analíticas',
      subtitle: 'Rendimiento del embudo y abandono pregunta por pregunta.',
      metricViews: 'Vistas',
      metricStarts: 'Inicios',
      metricSubmissions: 'Respuestas',
      metricCompletionRate: 'Tasa de finalización',
      metricAvgTime: 'Tiempo promedio para completar',
      metricPartials: 'Envíos parciales',
      rangeLast7: 'Últimos 7 días',
      rangeLast30: 'Últimos 30 días',
      rangeLast90: 'Últimos 90 días',
      rangeAll: 'Todo el tiempo',
      rangeCustom: 'Personalizado',
      rangeFrom: 'Desde',
      rangeTo: 'Hasta',
      rangeApply: 'Aplicar',
      dropoffTitle: 'Abandono pregunta por pregunta',
      dropoffSubtitle: 'Cuántas personas llegan a cada paso y cuántas se van.',
      colStep: 'Paso',
      colViews: 'Vistas',
      colDropoff: 'Abandono',
      coverRow: 'Portada / inicio',
      emptyTitle: 'Aún no hay datos',
      emptyBody: 'Cuando las personas abran y completen este formulario, verás aquí el embudo y el abandono.',
      error: 'No se pudieron cargar las analíticas.',
      retry: 'Reintentar',
      seconds: 's',
    },
    submissions: {
      title: 'Respuestas',
      subtitle: 'Todas las respuestas a este formulario.',
      statusAll: 'Todas',
      statusCompleted: 'Completadas',
      statusPartial: 'Parciales',
      badgeCompleted: 'Completada',
      badgePartial: 'Parcial',
      colSubmitted: 'Enviada',
      colStatus: 'Estado',
      colScore: 'Puntaje',
      export: 'Descargar CSV',
      exporting: 'Preparando…',
      delete: 'Eliminar',
      deleteConfirm: '¿Eliminar esta respuesta? No se puede deshacer.',
      emptyTitle: 'Aún no hay respuestas',
      emptyBody: 'Las respuestas aparecerán aquí a medida que las personas completen el formulario.',
      prev: 'Anterior',
      next: 'Siguiente',
      showing: '{from}–{to} de {total}',
      na: '—',
      error: 'No se pudieron cargar las respuestas.',
      retry: 'Reintentar',
    },
    integrations: {
      title: 'Integraciones',
      subtitle: 'Envía cada respuesta a tu CRM o a un webhook. La entrega es duradera y con reintentos.',
      back: '← Volver a formularios',
      save: 'Guardar integraciones',
      saving: 'Guardando…',
      saved: 'Integraciones guardadas.',
      saveError: 'No se pudieron guardar las integraciones.',
      loadError: 'No se pudieron cargar las integraciones.',
      enabled: 'Activado',
      disabled: 'Desactivado',
      webhookTitle: 'Webhook',
      webhookDesc: 'Envía cada respuesta como JSON (POST) a una URL que tú controlas.',
      webhookUrl: 'URL del endpoint',
      webhookUrlPlaceholder: 'https://ejemplo.com/webhooks/forms',
      webhookUrlInvalid: 'Introduce una URL https:// válida (http solo se permite para localhost).',
      webhookSecret: 'Secreto de firma (opcional)',
      webhookSecretHelp:
        'Si se define, cada solicitud se firma con HMAC-SHA256 en la cabecera X-Quill-Signature para que puedas verificarla.',
      hubspotTitle: 'HubSpot',
      hubspotDesc: 'Crea o actualiza el contacto y adjunta una nota en las respuestas completadas.',
      hubspotDisabled:
        'HubSpot no está configurado en este servidor (HUBSPOT_PRIVATE_APP_TOKEN). La búsqueda de propiedades no está disponible, pero puedes guardar un mapeo para usarlo cuando se configure.',
      hubspotLoading: 'Cargando propiedades de HubSpot…',
      fieldMappings: 'Mapeo de campos',
      fieldMappingsHelp: 'Asigna la clave de un paso del formulario a una propiedad de contacto de HubSpot. Asigna un paso a “email”.',
      utmMappings: 'Mapeo de UTM',
      utmMappingsHelp: 'Asigna los valores UTM capturados a propiedades de contacto de HubSpot.',
      scoreProperty: 'Propiedad de puntuación',
      dateProperty: 'Propiedad de fecha de envío',
      createNote: 'Crear una nota en respuestas completadas',
      createNoteHelp: 'Adjunta al contacto una nota con el nombre del formulario y la puntuación.',
      selectProperty: 'Selecciona una propiedad…',
      noProperty: '— ninguna —',
      addMapping: 'Añadir mapeo',
      remove: 'Quitar',
      stepKey: 'Clave del paso',
      property: 'Propiedad de HubSpot',
      emptyMappings: 'Aún no hay mapeos.',
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
