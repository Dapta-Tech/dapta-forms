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
    /** App shell chrome shared across every admin page (sidebar/header/footer). */
    chrome: {
      signOut: string;
      viewPublic: string;
      collapse: string;
      expand: string;
      openNav: string;
      /** Left-nav item labels (icon + label). */
      nav: {
        home: string;
        forms: string;
        submissions: string;
        analytics: string;
        integrations: string;
        settings: string;
      };
      /** The Dapta suite app-switcher. */
      switcher: {
        trigger: string;
        menuLabel: string;
        eyebrow: string;
        dapta: string;
        calendars: string;
        opensNewTab: string;
      };
    };
    /** The dashboard home (/admin) — greeting, public link, stats, quick actions. */
    home: {
      welcome: string;
      welcomeNamed: string; // {name}
      subtitle: string;
      publicLink: string;
      copy: string;
      copied: string;
      open: string;
      statForms: string;
      statSubmissions: string;
      statCompletion: string;
      createForm: string;
      createFormDesc: string;
      branding: string;
      brandingDesc: string;
      integrations: string;
      integrationsDesc: string;
      analytics: string;
      analyticsDesc: string;
    };
    /** The global submissions/analytics/integrations landing pages (form picker). */
    picker: {
      submissionsTitle: string;
      submissionsSubtitle: string;
      analyticsTitle: string;
      analyticsSubtitle: string;
      integrationsTitle: string;
      integrationsSubtitle: string;
      emptyTitle: string;
      emptyBody: string;
      viewSubmissions: string;
      viewAnalytics: string;
      configure: string;
      submissionsCount: string; // {n}
      completionValue: string; // {n}
      completionLabel: string;
    };
    /** The workspace settings page (/admin/settings). */
    settings: {
      title: string;
      subtitle: string;
      workspaceHeading: string;
      workspaceSubtitle: string;
      displayName: string;
      email: string;
      handle: string;
      accountCode: string;
      vanity: string;
      vanityNone: string;
      publicPage: string;
      viewPublic: string;
      membersHeading: string;
      membersSubtitle: string;
      roleOwner: string;
      roleAdmin: string;
      roleMember: string;
      statusActive: string;
      statusInvited: string;
      statusDisabled: string;
      membersEmpty: string;
      you: string;
      addMember: string;
      inviteTitle: string;
      inviteSubtitle: string;
      inviteEmailLabel: string;
      inviteEmailPlaceholder: string;
      inviteRoleLabel: string;
      inviteSubmit: string;
      inviteCancel: string;
      inviteSuccess: string;
      inviteErrorTaken: string;
      inviteErrorInvalid: string;
      inviteErrorFailed: string;
      membersMenu: string;
      makeAdmin: string;
      makeMember: string;
      removeMember: string;
      removeConfirm: string;
      roleChangeSuccess: string;
      removeSuccess: string;
      manageErrorLastOwner: string;
      manageErrorForbidden: string;
      manageErrorFailed: string;
    };
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
      actions: string;
      edit: string;
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
      rangeToday: string;
      rangeWeek: string;
      rangeMonth: string;
      rangeYear: string;
      rangeAll: string;
      rangeCustom: string;
      rangeFrom: string;
      rangeTo: string;
      rangeApply: string;
      /** Trends chart (per-day series, metric switchable). */
      trendsTitle: string;
      trendsSubtitle: string;
      trendsMetricLabel: string;
      trendsEmpty: string;
      dropoffTitle: string;
      dropoffSubtitle: string;
      colStep: string;
      colViews: string;
      colDropoff: string;
      coverRow: string;
      landingRow: string;
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
      webhookSecretSetPlaceholder: string;
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
    chrome: {
      signOut: 'Sign out',
      viewPublic: 'View public page',
      collapse: 'Collapse sidebar',
      expand: 'Expand sidebar',
      openNav: 'Open navigation',
      nav: {
        home: 'Home',
        forms: 'Forms',
        submissions: 'Submissions',
        analytics: 'Analytics',
        integrations: 'Integrations',
        settings: 'Settings',
      },
      switcher: {
        trigger: 'Switch product',
        menuLabel: 'Dapta products',
        eyebrow: 'Dapta',
        dapta: 'Dapta AI',
        calendars: 'Dapta Calendars',
        opensNewTab: '(opens in a new tab)',
      },
    },
    home: {
      welcome: 'Welcome',
      welcomeNamed: 'Welcome, {name}',
      subtitle: 'Your forms at a glance.',
      publicLink: 'Your public form link',
      copy: 'Copy',
      copied: 'Copied',
      open: 'Open',
      statForms: 'Forms',
      statSubmissions: 'Total submissions',
      statCompletion: 'Completion rate',
      createForm: 'Create a form',
      createFormDesc: 'Build a new form and share its link.',
      branding: 'Branding & style',
      brandingDesc: 'Cover, colors and the public look.',
      integrations: 'Integrations & webhooks',
      integrationsDesc: 'Send responses to your CRM or a webhook.',
      analytics: 'Analytics',
      analyticsDesc: 'Funnel performance and drop-off.',
    },
    picker: {
      submissionsTitle: 'Submissions',
      submissionsSubtitle: 'Pick a form to see its responses.',
      analyticsTitle: 'Analytics',
      analyticsSubtitle: 'Pick a form to see its funnel and drop-off.',
      integrationsTitle: 'Integrations',
      integrationsSubtitle: 'Pick a form to configure its CRM and webhook delivery.',
      emptyTitle: 'No forms yet',
      emptyBody: 'Create your first form to unlock this view.',
      viewSubmissions: 'View submissions',
      viewAnalytics: 'View analytics',
      configure: 'Configure',
      submissionsCount: '{n} submissions',
      completionValue: '{n}%',
      completionLabel: 'completion',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Your workspace and team.',
      workspaceHeading: 'Workspace',
      workspaceSubtitle: 'Your identity and public link.',
      displayName: 'Name',
      email: 'Email',
      handle: 'Handle',
      accountCode: 'Account code',
      vanity: 'Vanity slug',
      vanityNone: 'Not set',
      publicPage: 'Public page',
      viewPublic: 'View public page',
      membersHeading: 'Members',
      membersSubtitle: 'People with access to this workspace.',
      roleOwner: 'Owner',
      roleAdmin: 'Admin',
      roleMember: 'Member',
      statusActive: 'Active',
      statusInvited: 'Invited',
      statusDisabled: 'Disabled',
      membersEmpty: 'No members yet.',
      you: 'You',
      addMember: 'Add member',
      inviteTitle: 'Add a member',
      inviteSubtitle: 'They join as invited and get full access the first time they sign in.',
      inviteEmailLabel: 'Email',
      inviteEmailPlaceholder: 'name@company.com',
      inviteRoleLabel: 'Role',
      inviteSubmit: 'Add member',
      inviteCancel: 'Cancel',
      inviteSuccess: 'Member added.',
      inviteErrorTaken: 'A member with that email already exists.',
      inviteErrorInvalid: 'Enter a valid email address.',
      inviteErrorFailed: 'Could not add the member. Please try again.',
      membersMenu: 'Member actions',
      makeAdmin: 'Change to Admin',
      makeMember: 'Change to Member',
      removeMember: 'Remove member',
      removeConfirm: 'Remove this member? They will lose access to this workspace.',
      roleChangeSuccess: 'Role updated.',
      removeSuccess: 'Member removed.',
      manageErrorLastOwner: 'A workspace must keep at least one owner.',
      manageErrorForbidden: 'You do not have permission to do that.',
      manageErrorFailed: 'Something went wrong. Please try again.',
    },
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
      actions: 'Actions',
      edit: 'Edit',
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
      metricAvgTime: 'Time to complete',
      metricPartials: 'Partial submits',
      rangeToday: 'Today',
      rangeWeek: 'Last week',
      rangeMonth: 'Last month',
      rangeYear: 'Last year',
      rangeAll: 'All time',
      rangeCustom: 'Custom',
      rangeFrom: 'From',
      rangeTo: 'To',
      rangeApply: 'Apply',
      trendsTitle: 'Trends',
      trendsSubtitle: 'Daily movement over the selected range.',
      trendsMetricLabel: 'Metric',
      trendsEmpty: 'No activity in this range yet.',
      dropoffTitle: 'Question-by-question drop-off',
      dropoffSubtitle: 'How many people reach each step, and how many leave.',
      colStep: 'Step',
      colViews: 'Views',
      colDropoff: 'Drop-off',
      coverRow: 'Cover / landing',
      landingRow: 'Form views',
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
        'When set, each request is signed with HMAC-SHA256 in the X-Forms-Signature header so you can verify it.',
      webhookSecretSetPlaceholder: 'A secret is set — leave blank to keep it, or type a new one.',
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
    chrome: {
      signOut: 'Cerrar sesión',
      viewPublic: 'Ver página pública',
      collapse: 'Contraer barra lateral',
      expand: 'Expandir barra lateral',
      openNav: 'Abrir navegación',
      nav: {
        home: 'Inicio',
        forms: 'Formularios',
        submissions: 'Respuestas',
        analytics: 'Analíticas',
        integrations: 'Integraciones',
        settings: 'Ajustes',
      },
      switcher: {
        trigger: 'Cambiar producto',
        menuLabel: 'Productos Dapta',
        eyebrow: 'Dapta',
        dapta: 'Dapta AI',
        calendars: 'Dapta Calendars',
        opensNewTab: '(se abre en una pestaña nueva)',
      },
    },
    home: {
      welcome: 'Bienvenido',
      welcomeNamed: 'Bienvenido, {name}',
      subtitle: 'Tus formularios de un vistazo.',
      publicLink: 'Tu enlace público',
      copy: 'Copiar',
      copied: 'Copiado',
      open: 'Abrir',
      statForms: 'Formularios',
      statSubmissions: 'Respuestas totales',
      statCompletion: 'Tasa de finalización',
      createForm: 'Crear un formulario',
      createFormDesc: 'Crea un formulario nuevo y comparte su enlace.',
      branding: 'Marca y estilo',
      brandingDesc: 'Portada, colores y la apariencia pública.',
      integrations: 'Integraciones y webhooks',
      integrationsDesc: 'Envía respuestas a tu CRM o a un webhook.',
      analytics: 'Analíticas',
      analyticsDesc: 'Rendimiento del embudo y abandono.',
    },
    picker: {
      submissionsTitle: 'Respuestas',
      submissionsSubtitle: 'Elige un formulario para ver sus respuestas.',
      analyticsTitle: 'Analíticas',
      analyticsSubtitle: 'Elige un formulario para ver su embudo y abandono.',
      integrationsTitle: 'Integraciones',
      integrationsSubtitle: 'Elige un formulario para configurar su CRM y la entrega por webhook.',
      emptyTitle: 'Aún no hay formularios',
      emptyBody: 'Crea tu primer formulario para habilitar esta vista.',
      viewSubmissions: 'Ver respuestas',
      viewAnalytics: 'Ver analíticas',
      configure: 'Configurar',
      submissionsCount: '{n} respuestas',
      completionValue: '{n}%',
      completionLabel: 'finalización',
    },
    settings: {
      title: 'Ajustes',
      subtitle: 'Tu espacio de trabajo y tu equipo.',
      workspaceHeading: 'Espacio de trabajo',
      workspaceSubtitle: 'Tu identidad y tu enlace público.',
      displayName: 'Nombre',
      email: 'Correo',
      handle: 'Alias',
      accountCode: 'Código de cuenta',
      vanity: 'Slug personalizado',
      vanityNone: 'Sin definir',
      publicPage: 'Página pública',
      viewPublic: 'Ver página pública',
      membersHeading: 'Miembros',
      membersSubtitle: 'Personas con acceso a este espacio de trabajo.',
      roleOwner: 'Propietario',
      roleAdmin: 'Administrador',
      roleMember: 'Miembro',
      statusActive: 'Activo',
      statusInvited: 'Invitado',
      statusDisabled: 'Desactivado',
      membersEmpty: 'Aún no hay miembros.',
      you: 'Tú',
      addMember: 'Añadir miembro',
      inviteTitle: 'Añadir un miembro',
      inviteSubtitle: 'Se une como invitado y obtiene acceso completo la primera vez que inicia sesión.',
      inviteEmailLabel: 'Correo',
      inviteEmailPlaceholder: 'nombre@empresa.com',
      inviteRoleLabel: 'Rol',
      inviteSubmit: 'Añadir miembro',
      inviteCancel: 'Cancelar',
      inviteSuccess: 'Miembro añadido.',
      inviteErrorTaken: 'Ya existe un miembro con ese correo.',
      inviteErrorInvalid: 'Introduce un correo válido.',
      inviteErrorFailed: 'No se pudo añadir el miembro. Inténtalo de nuevo.',
      membersMenu: 'Acciones de miembro',
      makeAdmin: 'Cambiar a Administrador',
      makeMember: 'Cambiar a Miembro',
      removeMember: 'Quitar miembro',
      removeConfirm: '¿Quitar a este miembro? Perderá el acceso a este espacio de trabajo.',
      roleChangeSuccess: 'Rol actualizado.',
      removeSuccess: 'Miembro eliminado.',
      manageErrorLastOwner: 'Un espacio de trabajo debe conservar al menos un propietario.',
      manageErrorForbidden: 'No tienes permiso para hacer eso.',
      manageErrorFailed: 'Algo salió mal. Inténtalo de nuevo.',
    },
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
      actions: 'Acciones',
      edit: 'Editar',
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
      metricAvgTime: 'Tiempo para completar',
      metricPartials: 'Envíos parciales',
      rangeToday: 'Hoy',
      rangeWeek: 'Última semana',
      rangeMonth: 'Último mes',
      rangeYear: 'Último año',
      rangeAll: 'Todo el tiempo',
      rangeCustom: 'Personalizado',
      rangeFrom: 'Desde',
      rangeTo: 'Hasta',
      rangeApply: 'Aplicar',
      trendsTitle: 'Tendencias',
      trendsSubtitle: 'Movimiento diario en el rango seleccionado.',
      trendsMetricLabel: 'Métrica',
      trendsEmpty: 'Aún no hay actividad en este rango.',
      dropoffTitle: 'Abandono pregunta por pregunta',
      dropoffSubtitle: 'Cuántas personas llegan a cada paso y cuántas se van.',
      colStep: 'Paso',
      colViews: 'Vistas',
      colDropoff: 'Abandono',
      coverRow: 'Portada / inicio',
      landingRow: 'Vistas del formulario',
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
        'Si se define, cada solicitud se firma con HMAC-SHA256 en la cabecera X-Forms-Signature para que puedas verificarla.',
      webhookSecretSetPlaceholder: 'Hay un secreto guardado — déjalo en blanco para conservarlo o escribe uno nuevo.',
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
