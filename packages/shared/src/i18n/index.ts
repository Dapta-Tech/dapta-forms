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
    /** Inline scheduling screen shown when an outcome has a booking config. */
    booking: {
      title: string;
      loading: string;
      loadError: string;
      fallbackCta: string;
      iframeTitle: string;
      /** Subtle prompt before the always-present escape-hatch scheduling link. */
      troublePrefix: string;
    };
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
    /** The phone step's country-code picker (searchable dial-code selector). */
    phonePicker: {
      /** aria-label for the country-select trigger + listbox. */
      countryLabel: string;
      /** Placeholder + aria-label for the country search box. */
      search: string;
      /** Empty-state row when the search matches no country. */
      noResults: string;
      /** Inline hint when the typed number is shorter than the country issues. */
      invalid: string;
    };
    /** The `name` step's two inputs — localized defaults rendered when the
     *  builder leaves a placeholder empty (also the editor preview fallback). */
    name: {
      firstPlaceholder: string;
      lastPlaceholder: string;
    };
  };
  admin: {
    /** Branded combobox (`components/ui/select`) that replaces native selects. */
    select: {
      search: string;
      noResults: string;
    };
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
    /** Settings → Notifications: edit the two submission emails the platform sends. */
    notifications: {
      heading: string;
      subtitle: string;
      receivedTitle: string;
      receivedSubtitle: string;
      confirmedTitle: string;
      confirmedSubtitle: string;
      enabledLabel: string;
      enabledHint: string;
      subjectLabel: string;
      bodyLabel: string;
      tokensLabel: string;
      tokensHint: string;
      previewLabel: string;
      previewSubject: string;
      usingDefault: string;
      customized: string;
      save: string;
      saving: string;
      reset: string;
      resetConfirm: string;
      saveSuccess: string;
      saveError: string;
      resetSuccess: string;
      /** Human labels for each {{token}}, shown in the variable chips. */
      tokenFormName: string;
      tokenRespondentEmail: string;
      tokenScore: string;
      tokenOutcomeLabel: string;
      tokenFormLink: string;
      /** Muted pointer: forms can override these from their Connect tab. */
      formOverrideNote: string;
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
      connect: string;
      openForm: string;
    };
    /** The form editor (builder). */
    editor: {
      back: string;
      save: string;
      saving: string;
      saved: string;
      saveError: string;
      /** V4 autosave hardening: surface WHY a save failed + client pre-validation. */
      saveErrorReason: string;
      saveInvalid: string;
      /** Results tab clarity (V4-16 outcome heading + redirect field). */
      resultsHelp: {
        outcomeHeadingHelp: string;
        redirectLabel: string;
        redirectHelp: string;
      };
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
        /** One-line explainer under the options list tying points to scoring. */
        pointsHint: string;
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
        hint: string;
        hideNone: string;
        personalEmailOnly: string;
        personalEmailHint: string;
        /** V4 — operator dropdown (numeric fields) + operand labels. */
        operator: string;
        opEq: string;
        opGt: string;
        opLt: string;
        opBetween: string;
        value: string;
        betweenMin: string;
        betweenMax: string;
        /** V4 — contradiction guard warning (show + hide cancel out). */
        contradiction: string;
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
        /** Clarifies that a variant only swaps the title; branching is Logic. */
        scopeNote: string;
        sliderLabel: string;
        /** The `@` recall-information picker inside variant textareas. */
        tokenPickerLabel: string;
        tokenPickerEmpty: string;
        tokenPickerNoMatch: string;
        /** `{token}` is replaced with the bracketed token, e.g. `[firstname]`. */
        tokenWarnLater: string;
        tokenWarnUnknown: string;
      };
      /** Per-question behavior toggles (terminal / reveal trigger). */
      behavior: {
        title: string;
        terminal: string;
        terminalHint: string;
        reveal: string;
        revealHint: string;
      };
      /** The `name` step's two collected fields + placeholders. */
      nameStep: {
        title: string;
        hint: string;
        first: string;
        second: string;
        fieldKey: string;
        /** Explains the field key doubles as a URL parameter for prefill. */
        fieldKeyHint: string;
        placeholder: string;
      };
      /** The reveal/processing interstitial settings (Design tab). */
      reveal: {
        title: string;
        subtitle: string;
        enabled: string;
        stepHint: string;
        headline: string;
        headlinePlaceholder: string;
        subtitleLabel: string;
        subtitlePlaceholder: string;
        template: string;
        templateHint: string;
        duration: string;
        durationHint: string;
        prewarm: string;
        prewarmHint: string;
      };
      /** Partial-submission threshold ("save a partial after step N"). */
      partial: {
        title: string;
        hint: string;
        none: string;
        afterStep: string; // {n}
      };
      cover: {
        title: string;
        subtitle: string;
        enabled: string;
        bannerText: string;
        eyebrow: string;
        badge: string;
        headline: string;
        subheadline: string;
        ctaText: string;
        trustBadge: string;
        branding: string;
        primaryColor: string;
        primaryColorHint: string;
        logo: string;
        logoHint: string;
        logoInvalid: string;
        clientLogos: string;
        clientLogosHint: string;
        clientLogoName: string;
        clientLogoSrc: string;
        addClientLogo: string;
        removeClientLogo: string;
        clientLogosEmpty: string;
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
      /** The editor's Connect tab (per-form integrations, tracking, emails). */
      connect: {
        tab: string;
        integrationsTitle: string;
        integrationsSubtitle: string;
        integrationsLoadError: string;
        retry: string;
        trackingTitle: string;
        trackingSubtitle: string;
        gtmLabel: string;
        gtmHelp: string;
        metaLabel: string;
        metaHelp: string;
        posthogKeyLabel: string;
        posthogKeyHelp: string;
        posthogHostLabel: string;
        posthogHostHelp: string;
        posthogHostInvalid: string;
        hubspotLabel: string;
        hubspotHelp: string;
        utmNote: string;
        emailsTitle: string;
        emailsSubtitle: string;
        emailsLoadError: string;
        /** Collapsed-state badge: this email follows the account template. */
        emailsUsingAccount: string;
        /** Badge when a per-form override is stored. */
        emailsCustomBadge: string;
        /** Expands the per-form editor. */
        emailsCustomize: string;
        /** Removes the per-form override (falls back to the account template). */
        emailsUseAccount: string;
        emailsUseAccountConfirm: string;
        /** Footer pointer: the account-wide template lives in Settings. */
        emailsGlobalNote: string;
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
      // HubSpot pilot extras
      valueMaps: string;
      valueMapsHelp: string;
      valueMapsExample: string;
      valueMapAnswer: string;
      valueMapCrmValue: string;
      addValueMap: string;
      addValueMapRow: string;
      emptyValueMaps: string;
      outcomeProperty: string;
      outcomePropertyHelp: string;
      staticProperties: string;
      staticPropertiesHelp: string;
      staticValue: string;
      addStaticProperty: string;
      emptyStaticProperties: string;
      inferCompany: string;
      inferCompanyHelp: string;
      bookingSync: string;
      bookingSyncHelp: string;
      bookingStageProperty: string;
      bookingStageValue: string;
      bookingDateProperty: string;
      bookingHoursProperty: string;
      // Account-connection gating + Typeform-style mapping (per-form)
      connectPromptTitle: string;
      connectPromptBody: string;
      connectPromptCta: string;
      connectedBadge: string;
      propertiesUnavailable: string;
      mapQuestions: string;
      mapQuestionsHelp: string;
      yourQuestion: string;
      noQuestions: string;
      autoMap: string;
      autoMapFilled: string;
      autoMapNone: string;
      mapElements: string;
      mapElementsHelp: string;
      customMappings: string;
      customMappingsHelp: string;
      // Key pickers (custom mapping rows + value-map groups)
      keyGroupQuestions: string;
      keyGroupSystem: string;
      keyCustomOption: string;
      keyCustomBack: string;
      selectKeyPlaceholder: string;
      webhookEvents: string;
      webhookEventsHelp: string;
      eventPartial: string;
      eventComplete: string;
    };
    /** Account-level provider connections (paste-token) surfaced on /admin/integrations. */
    connections: {
      title: string;
      subtitle: string;
      hubspotName: string;
      hubspotDesc: string;
      calendlyName: string;
      calendlyDesc: string;
      connected: string;
      notConnected: string;
      connect: string;
      connecting: string;
      disconnect: string;
      disconnecting: string;
      cancel: string;
      tokenLabel: string;
      tokenPlaceholder: string;
      tokenHelp: string;
      connectedAs: string;
      endingIn: string;
      connectedOn: string;
      connectSuccess: string;
      connectError: string;
      tokenRequired: string;
      disconnectSuccess: string;
      disconnectError: string;
      disconnectConfirm: string;
      encryptionOff: string;
      encryptionOffBody: string;
      loadError: string;
      perFormNote: string;
    };
    /** Draft → publish controls in the form editor (publish button + badge). */
    publish: {
      publish: string;
      publishing: string;
      published: string;
      publishError: string;
      unpublishedChanges: string;
      noChanges: string;
    };
  };
  /** Branded confirm dialog that replaces native browser confirm() prompts. */
  dialog: {
    /** Generic action labels (component defaults for every confirm dialog). */
    confirm: string;
    cancel: string;
    /** Per-surface dialog titles (the body reuses each surface's *Confirm copy). */
    deleteFormTitle: string;
    deleteQuestionTitle: string;
    deleteSubmissionTitle: string;
    removeMemberTitle: string;
    resetEmailTitle: string;
    disconnectIntegrationTitle: string; // {provider}
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
    booking: {
      title: 'Pick a time',
      loading: 'Loading the calendar…',
      loadError: 'The calendar could not load.',
      fallbackCta: 'Open the scheduling page',
      iframeTitle: 'Schedule a meeting',
      troublePrefix: 'Having trouble?',
    },
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
    phonePicker: {
      countryLabel: 'Select country code',
      search: 'Search country or code',
      noResults: 'No countries found',
      invalid: 'Enter a valid phone number.',
    },
    name: {
      firstPlaceholder: 'First name',
      lastPlaceholder: 'Last name',
    },
  },
  admin: {
    select: {
      search: 'Search…',
      noResults: 'No results',
    },
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
    notifications: {
      heading: 'Notifications',
      subtitle: 'Edit the emails sent when a form is submitted.',
      receivedTitle: 'New submission notice',
      receivedSubtitle: 'Sent to you when someone submits a form.',
      confirmedTitle: 'Respondent confirmation',
      confirmedSubtitle: 'Sent to the respondent to confirm you received their answers.',
      enabledLabel: 'Send this email',
      enabledHint: 'Turn off to stop sending this email entirely.',
      subjectLabel: 'Subject',
      bodyLabel: 'Body',
      tokensLabel: 'Available variables',
      tokensHint: 'Click a variable to insert it. Each is replaced with the real value when the email is sent.',
      previewLabel: 'Preview',
      previewSubject: 'Subject',
      usingDefault: 'Using default',
      customized: 'Customized',
      save: 'Save changes',
      saving: 'Saving…',
      reset: 'Reset to default',
      resetConfirm: 'Reset this email’s subject and body to the default copy?',
      saveSuccess: 'Notification email saved.',
      saveError: 'Could not save. Please try again.',
      resetSuccess: 'Reset to the default copy.',
      tokenFormName: 'Form name',
      tokenRespondentEmail: 'Respondent email',
      tokenScore: 'Score',
      tokenOutcomeLabel: 'Outcome',
      tokenFormLink: 'Form link',
      formOverrideNote: 'Each form can override these emails from its Connect tab in the editor.',
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
      connect: 'Connect',
      openForm: 'Open form',
    },
    editor: {
      back: 'Back to forms',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveError: 'Could not save — please try again.',
      saveErrorReason: 'Couldn’t save: {reason}',
      saveInvalid: 'Can’t save yet — {reason}',
      resultsHelp: {
        outcomeHeadingHelp:
          'Shown to respondents as the heading on the thank-you screen when their score lands in this range.',
        redirectLabel: 'Redirect URL (optional)',
        redirectHelp:
          'Leave empty to show the thank-you screen. If set, respondents are sent here instead.',
      },
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
        pointsHint: 'Added to the score when this option is picked. Use a negative number to subtract.',
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
        hint: 'Show or hide this question based on an earlier answer.',
        hideNone: 'Never hidden',
        personalEmailOnly: 'Personal email only',
        personalEmailHint:
          'Show this question only when the respondent entered a personal (non-work) email.',
        operator: 'Condition',
        opEq: 'Equal to',
        opGt: 'Greater than',
        opLt: 'Less than',
        opBetween: 'Between',
        value: 'Value',
        betweenMin: 'Min',
        betweenMax: 'Max',
        contradiction:
          'These show and hide rules cancel out — this question could never appear. Adjust one of them.',
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
        interpolationHint: 'Type @ (or [field]) to insert an earlier answer into the question.',
        scopeNote: 'This only changes the question’s title — not its options. To send people to a different question, use Logic.',
        sliderLabel: 'Slider unit label',
        tokenPickerLabel: 'Insert a previous answer',
        tokenPickerEmpty: 'No earlier answers yet — this is the first question.',
        tokenPickerNoMatch: 'No matching fields.',
        tokenWarnLater: '“{token}” is asked after this step — it will be empty here.',
        tokenWarnUnknown: '“{token}” doesn’t exist in this form.',
      },
      behavior: {
        title: 'Behavior',
        terminal: 'Ends the form',
        terminalHint: 'Completing this question ends the form immediately (disqualification).',
        reveal: 'Show reveal screen after',
        revealHint: 'Plays the processing/reveal screen after this question. Set it up in Design.',
      },
      nameStep: {
        title: 'Name fields',
        hint: 'The two inputs this question collects on one screen.',
        first: 'First field',
        second: 'Second field',
        fieldKey: 'Field key',
        fieldKeyHint: 'Used as a URL parameter to prefill this field.',
        placeholder: 'Placeholder',
      },
      reveal: {
        title: 'Reveal screen',
        subtitle: 'A short processing interstitial shown before the result.',
        enabled: 'Enable the reveal screen',
        stepHint: 'Pick which question triggers it under Build → Behavior.',
        headline: 'Headline',
        headlinePlaceholder: 'Reviewing your answers…',
        subtitleLabel: 'Subtitle',
        subtitlePlaceholder: 'One moment while we match you with the best next step.',
        template: 'Subtitle template',
        templateHint:
          'Overrides the subtitle. Use [field] to insert an answer — e.g. “Finding the best advisor for [industry]…”.',
        duration: 'Duration (ms)',
        durationHint: 'How long the reveal plays, 500–30000 ms. Default: 2200.',
        prewarm: 'Pre-load the booking page',
        prewarmHint: 'Warms the outcome’s booking embed while the reveal screen plays.',
      },
      partial: {
        title: 'Partial submissions',
        hint: 'Save a partial submission once a question is completed, even if the respondent never finishes.',
        none: 'Off — only save completed submissions',
        afterStep: 'After question {n}',
      },
      cover: {
        title: 'Cover screen',
        subtitle: 'The intro screen shown before the first step.',
        enabled: 'Show a cover screen',
        bannerText: 'Banner text',
        eyebrow: 'Eyebrow',
        badge: 'Badge',
        headline: 'Headline',
        subheadline: 'Subheadline',
        ctaText: 'Start button text',
        trustBadge: 'Trust badge',
        branding: 'Branding',
        primaryColor: 'Primary color',
        primaryColorHint: 'Drives the accent on the public form. Auto-adjusted for contrast.',
        logo: 'Logo URL',
        logoHint: 'Shown at the top of the form. An https:// image URL.',
        logoInvalid: 'This URL protocol is not allowed for images.',
        clientLogos: 'Client logos',
        clientLogosHint: 'A “trusted by” marquee on the cover. The name shows when no image is set.',
        clientLogoName: 'Name',
        clientLogoSrc: 'Image URL',
        addClientLogo: 'Add logo',
        removeClientLogo: 'Remove logo',
        clientLogosEmpty: 'No client logos yet.',
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
      connect: {
        tab: 'Connect',
        integrationsTitle: 'Integrations',
        integrationsSubtitle:
          'Send each submission to your CRM or a webhook. Delivery is durable and retried.',
        integrationsLoadError: 'Could not load integrations.',
        retry: 'Retry',
        trackingTitle: 'Tracking & pixels',
        trackingSubtitle:
          'Measure visits and conversions on this form’s public page. Each tag loads only when its ID is set.',
        gtmLabel: 'Google Tag Manager ID',
        gtmHelp: 'Loads your GTM container on the form page so your tags fire.',
        metaLabel: 'Meta Pixel ID',
        metaHelp: 'Fires a PageView on your Meta pixel to measure campaigns.',
        posthogKeyLabel: 'PostHog project key',
        posthogKeyHelp: 'Captures a pageview in PostHog for product analytics.',
        posthogHostLabel: 'PostHog host (optional)',
        posthogHostHelp: 'Defaults to PostHog US cloud; set your EU or self-hosted ingestion URL.',
        posthogHostInvalid: 'Enter a full http(s) URL, e.g. https://eu.i.posthog.com.',
        hubspotLabel: 'HubSpot tracking ID',
        hubspotHelp: 'Loads the HubSpot tracking code for your portal on the form page.',
        utmNote:
          'UTM parameters are captured automatically and can be mapped to HubSpot properties in Integrations.',
        emailsTitle: 'Emails',
        emailsSubtitle:
          'The submission emails this form sends. Each can follow the account template or use its own copy.',
        emailsLoadError: 'Could not load email settings.',
        emailsUsingAccount: 'Using the account template',
        emailsCustomBadge: 'Custom for this form',
        emailsCustomize: 'Customize for this form',
        emailsUseAccount: 'Use account template',
        emailsUseAccountConfirm:
          'Remove this form’s custom copy and go back to the account template?',
        emailsGlobalNote: 'The account-wide templates live in Settings → Notifications.',
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
      valueMaps: 'Value maps — translate form answers to CRM values',
      valueMapsHelp:
        'Rewrite specific answers into the exact values your HubSpot picklists expect. Answers without a translation are sent unchanged.',
      valueMapsExample: 'E.g. when the answer is “Sales”, HubSpot receives “sales”.',
      valueMapAnswer: 'Answer in the form',
      valueMapCrmValue: 'Value in HubSpot',
      addValueMap: 'Add value translation',
      addValueMapRow: 'Add value',
      emptyValueMaps: 'No value translations yet.',
      outcomeProperty: 'Outcome property',
      outcomePropertyHelp:
        'Contact property that receives the resolved outcome label (e.g. “Qualified”) on completed submissions.',
      staticProperties: 'Static properties',
      staticPropertiesHelp:
        'Fixed values stamped on every completed submission (e.g. an opt-in flag). They never overwrite a mapped answer.',
      staticValue: 'Value',
      addStaticProperty: 'Add property',
      emptyStaticProperties: 'No static properties yet.',
      inferCompany: 'Infer company from email',
      inferCompanyHelp:
        'When the respondent uses a work email, fill the company and website properties from its domain — free-mail domains (gmail, outlook…) are skipped, and mapped values are never overwritten.',
      bookingSync: 'Booking sync',
      bookingSyncHelp:
        'When a respondent books a meeting from an outcome page, stamp these contact properties with the booking facts. Leave a field blank to skip it.',
      bookingStageProperty: 'Stage property',
      bookingStageValue: 'Stage value',
      bookingDateProperty: 'Booking date property',
      bookingHoursProperty: 'Meeting time property',
      connectPromptTitle: 'Connect HubSpot to map this form',
      connectPromptBody:
        'HubSpot isn’t connected for your account yet. Connect it once, then come back to map each question to a contact property.',
      connectPromptCta: 'Go to Connections',
      connectedBadge: 'HubSpot connected',
      propertiesUnavailable:
        'HubSpot properties are temporarily unavailable — you can still type a property name.',
      mapQuestions: 'Map questions',
      mapQuestionsHelp: 'Send each answer to a HubSpot contact property. One question should map to “email”.',
      yourQuestion: 'Your question',
      noQuestions: 'This form has no questions to map yet. Add steps in the editor first.',
      autoMap: 'Auto-map',
      autoMapFilled: 'Auto-mapped {n} question(s). Review and save.',
      autoMapNone: 'No new matches to suggest.',
      mapElements: 'Map form elements',
      mapElementsHelp:
        'Send captured metadata — UTMs, lead score, outcome, and submitted date — to HubSpot properties.',
      customMappings: 'Custom field mappings',
      customMappingsHelp:
        'Send an extra piece of form data to a HubSpot property — useful for hidden fields or UTMs.',
      keyGroupQuestions: 'Form questions',
      keyGroupSystem: 'System fields',
      keyCustomOption: 'Custom key…',
      keyCustomBack: 'Back to list',
      selectKeyPlaceholder: 'Select a field…',
      webhookEvents: 'Trigger on',
      webhookEventsHelp: 'Choose which submissions are sent to this webhook. Both are sent by default.',
      eventPartial: 'Partial submissions',
      eventComplete: 'Complete submissions',
    },
    connections: {
      title: 'Connections',
      subtitle:
        'Connect your account to HubSpot and Calendly once. Then map fields for each form from its integrations tab.',
      hubspotName: 'HubSpot',
      hubspotDesc: 'Sync respondents to HubSpot contacts and map questions to contact properties.',
      calendlyName: 'Calendly',
      calendlyDesc: 'Let respondents book meetings from your form outcomes.',
      connected: 'Connected',
      notConnected: 'Not connected',
      connect: 'Connect',
      connecting: 'Connecting…',
      disconnect: 'Disconnect',
      disconnecting: 'Disconnecting…',
      cancel: 'Cancel',
      tokenLabel: 'Paste your {provider} token',
      tokenPlaceholder: 'Paste token…',
      tokenHelp: 'The token is validated, encrypted, and stored server-side. It is never shown again.',
      connectedAs: 'Connected as {label}',
      endingIn: 'ending in {last4}',
      connectedOn: 'Connected {date}',
      connectSuccess: '{provider} connected.',
      connectError: 'Could not connect. Check the token and try again.',
      tokenRequired: 'Paste a token first.',
      disconnectSuccess: '{provider} disconnected.',
      disconnectError: 'Could not disconnect. Please try again.',
      disconnectConfirm: 'Disconnect {provider} for this account?',
      encryptionOff: 'Connecting is unavailable',
      encryptionOffBody:
        'The server needs a FORMS_ENCRYPTION_KEY to store credentials securely. Set it and restart the API to enable connections.',
      loadError: 'Could not load your connections.',
      perFormNote: 'Field mapping is configured per form, from each form’s integrations tab.',
    },
    publish: {
      publish: 'Publish',
      publishing: 'Publishing…',
      published: 'Changes published — your form is live.',
      publishError: 'Could not publish — please try again.',
      unpublishedChanges: 'Unpublished changes',
      noChanges: 'All changes are published',
    },
  },
  dialog: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    deleteFormTitle: 'Delete form',
    deleteQuestionTitle: 'Delete question',
    deleteSubmissionTitle: 'Delete submission',
    removeMemberTitle: 'Remove member',
    resetEmailTitle: 'Reset email template',
    disconnectIntegrationTitle: 'Disconnect {provider}',
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
    booking: {
      title: 'Elige un horario',
      loading: 'Cargando el calendario…',
      loadError: 'No se pudo cargar el calendario.',
      fallbackCta: 'Abrir la página de agendamiento',
      iframeTitle: 'Agendar una reunión',
      troublePrefix: '¿Tienes problemas?',
    },
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
    phonePicker: {
      countryLabel: 'Selecciona el código de país',
      search: 'Busca país o código',
      noResults: 'No se encontraron países',
      invalid: 'Introduce un número de teléfono válido.',
    },
    name: {
      firstPlaceholder: 'Nombre',
      lastPlaceholder: 'Apellidos',
    },
  },
  admin: {
    select: {
      search: 'Buscar…',
      noResults: 'Sin resultados',
    },
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
    notifications: {
      heading: 'Notificaciones',
      subtitle: 'Edita los correos que se envían cuando se responde un formulario.',
      receivedTitle: 'Aviso de nueva respuesta',
      receivedSubtitle: 'Se te envía cuando alguien responde un formulario.',
      confirmedTitle: 'Confirmación al encuestado',
      confirmedSubtitle: 'Se envía al encuestado para confirmar que recibiste sus respuestas.',
      enabledLabel: 'Enviar este correo',
      enabledHint: 'Desactívalo para dejar de enviar este correo por completo.',
      subjectLabel: 'Asunto',
      bodyLabel: 'Cuerpo',
      tokensLabel: 'Variables disponibles',
      tokensHint: 'Haz clic en una variable para insertarla. Cada una se reemplaza por su valor real al enviar el correo.',
      previewLabel: 'Vista previa',
      previewSubject: 'Asunto',
      usingDefault: 'Usando el predeterminado',
      customized: 'Personalizado',
      save: 'Guardar cambios',
      saving: 'Guardando…',
      reset: 'Restablecer',
      resetConfirm: '¿Restablecer el asunto y el cuerpo de este correo a la versión predeterminada?',
      saveSuccess: 'Correo de notificación guardado.',
      saveError: 'No se pudo guardar. Inténtalo de nuevo.',
      resetSuccess: 'Se restableció a la versión predeterminada.',
      tokenFormName: 'Nombre del formulario',
      tokenRespondentEmail: 'Correo del encuestado',
      tokenScore: 'Puntuación',
      tokenOutcomeLabel: 'Resultado',
      tokenFormLink: 'Enlace del formulario',
      formOverrideNote:
        'Cada formulario puede personalizar estos correos desde su pestaña Conectar en el editor.',
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
      connect: 'Conectar',
      openForm: 'Abrir formulario',
    },
    editor: {
      back: 'Volver a formularios',
      save: 'Guardar',
      saving: 'Guardando…',
      saved: 'Guardado.',
      saveError: 'No se pudo guardar — inténtalo de nuevo.',
      saveErrorReason: 'No se pudo guardar: {reason}',
      saveInvalid: 'Aún no se puede guardar — {reason}',
      resultsHelp: {
        outcomeHeadingHelp:
          'Se muestra a los respondientes como el encabezado de la pantalla de agradecimiento cuando su puntaje cae en este rango.',
        redirectLabel: 'URL de redirección (opcional)',
        redirectHelp:
          'Déjalo vacío para mostrar la pantalla de agradecimiento. Si lo defines, se redirige ahí a los respondientes.',
      },
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
        pointsHint: 'Se suma al puntaje cuando se elige esta opción. Usa un número negativo para restar.',
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
        hint: 'Muestra u oculta esta pregunta según una respuesta anterior.',
        hideNone: 'Nunca se oculta',
        personalEmailOnly: 'Solo correo personal',
        personalEmailHint:
          'Muestra esta pregunta solo cuando la persona ingresó un correo personal (no corporativo).',
        operator: 'Condición',
        opEq: 'Igual a',
        opGt: 'Mayor que',
        opLt: 'Menor que',
        opBetween: 'Entre',
        value: 'Valor',
        betweenMin: 'Mín',
        betweenMax: 'Máx',
        contradiction:
          'Estas reglas de mostrar y ocultar se anulan — esta pregunta nunca aparecería. Ajusta una de ellas.',
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
        interpolationHint: 'Escribe @ (o [campo]) para insertar una respuesta anterior en la pregunta.',
        scopeNote: 'Esto solo cambia el título de la pregunta — no sus opciones. Para enviar a otra pregunta, usa Lógica.',
        sliderLabel: 'Etiqueta de unidad del deslizador',
        tokenPickerLabel: 'Insertar una respuesta anterior',
        tokenPickerEmpty: 'Aún no hay respuestas anteriores — esta es la primera pregunta.',
        tokenPickerNoMatch: 'Ningún campo coincide.',
        tokenWarnLater: '«{token}» se pregunta después de este paso — quedará vacío.',
        tokenWarnUnknown: '«{token}» no existe en este formulario.',
      },
      behavior: {
        title: 'Comportamiento',
        terminal: 'Termina el formulario',
        terminalHint: 'Completar esta pregunta termina el formulario de inmediato (descalificación).',
        reveal: 'Mostrar pantalla de revelación después',
        revealHint: 'Reproduce la pantalla de procesamiento/revelación tras esta pregunta. Configúrala en Diseño.',
      },
      nameStep: {
        title: 'Campos del nombre',
        hint: 'Los dos campos que esta pregunta recoge en una sola pantalla.',
        first: 'Primer campo',
        second: 'Segundo campo',
        fieldKey: 'Clave del campo',
        fieldKeyHint: 'Se usa como parámetro de URL para prellenar este campo.',
        placeholder: 'Texto de ejemplo',
      },
      reveal: {
        title: 'Pantalla de revelación',
        subtitle: 'Un breve intermedio de procesamiento antes del resultado.',
        enabled: 'Activar la pantalla de revelación',
        stepHint: 'Elige qué pregunta la activa en Construir → Comportamiento.',
        headline: 'Titular',
        headlinePlaceholder: 'Revisando tus respuestas…',
        subtitleLabel: 'Subtítulo',
        subtitlePlaceholder: 'Un momento mientras encontramos el mejor siguiente paso para ti.',
        template: 'Plantilla del subtítulo',
        templateHint:
          'Reemplaza el subtítulo. Usa [campo] para insertar una respuesta — p. ej. «Buscando el mejor asesor para [industria]…».',
        duration: 'Duración (ms)',
        durationHint: 'Cuánto dura la revelación, 500–30000 ms. Por defecto: 2200.',
        prewarm: 'Precargar la página de reserva',
        prewarmHint: 'Precarga el calendario de reserva del resultado mientras se muestra la revelación.',
      },
      partial: {
        title: 'Envíos parciales',
        hint: 'Guarda un envío parcial al completar una pregunta, aunque la persona no termine.',
        none: 'Desactivado — solo guardar envíos completos',
        afterStep: 'Tras la pregunta {n}',
      },
      cover: {
        title: 'Portada',
        subtitle: 'La pantalla de introducción antes del primer paso.',
        enabled: 'Mostrar una portada',
        bannerText: 'Texto del banner',
        eyebrow: 'Antetítulo',
        badge: 'Insignia',
        headline: 'Titular',
        subheadline: 'Subtítulo',
        ctaText: 'Texto del botón de inicio',
        trustBadge: 'Sello de confianza',
        branding: 'Marca',
        primaryColor: 'Color primario',
        primaryColorHint: 'Define el acento del formulario público. Se ajusta para contraste.',
        logo: 'URL del logo',
        logoHint: 'Se muestra en la parte superior del formulario. Una URL de imagen https://.',
        logoInvalid: 'Este protocolo de URL no está permitido para imágenes.',
        clientLogos: 'Logos de clientes',
        clientLogosHint: 'Una marquesina de «confían en nosotros» en la portada. El nombre se muestra si no hay imagen.',
        clientLogoName: 'Nombre',
        clientLogoSrc: 'URL de la imagen',
        addClientLogo: 'Añadir logo',
        removeClientLogo: 'Quitar logo',
        clientLogosEmpty: 'Aún no hay logos de clientes.',
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
      connect: {
        tab: 'Conectar',
        integrationsTitle: 'Integraciones',
        integrationsSubtitle:
          'Envía cada respuesta a tu CRM o a un webhook. La entrega es duradera y con reintentos.',
        integrationsLoadError: 'No se pudieron cargar las integraciones.',
        retry: 'Reintentar',
        trackingTitle: 'Seguimiento y píxeles',
        trackingSubtitle:
          'Mide visitas y conversiones en la página pública de este formulario. Cada etiqueta se carga solo cuando su ID está configurado.',
        gtmLabel: 'ID de Google Tag Manager',
        gtmHelp: 'Carga tu contenedor de GTM en la página del formulario para que se disparen tus etiquetas.',
        metaLabel: 'ID del píxel de Meta',
        metaHelp: 'Dispara un PageView en tu píxel de Meta para medir campañas.',
        posthogKeyLabel: 'Clave del proyecto de PostHog',
        posthogKeyHelp: 'Captura una pageview en PostHog para analítica de producto.',
        posthogHostLabel: 'Host de PostHog (opcional)',
        posthogHostHelp:
          'Por defecto usa la nube de PostHog en EE. UU.; configura tu URL de ingesta de la UE o autoalojada.',
        posthogHostInvalid: 'Introduce una URL http(s) completa, p. ej. https://eu.i.posthog.com.',
        hubspotLabel: 'ID de seguimiento de HubSpot',
        hubspotHelp: 'Carga el código de seguimiento de HubSpot de tu portal en la página del formulario.',
        utmNote:
          'Los parámetros UTM se capturan automáticamente y puedes mapearlos a propiedades de HubSpot en Integraciones.',
        emailsTitle: 'Correos',
        emailsSubtitle:
          'Los correos que envía este formulario. Cada uno puede seguir el template de la cuenta o usar su propia versión.',
        emailsLoadError: 'No se pudieron cargar los ajustes de correo.',
        emailsUsingAccount: 'Usando el template de la cuenta',
        emailsCustomBadge: 'Personalizado para este form',
        emailsCustomize: 'Personalizar para este form',
        emailsUseAccount: 'Usar template de la cuenta',
        emailsUseAccountConfirm:
          '¿Quitar la versión personalizada de este formulario y volver al template de la cuenta?',
        emailsGlobalNote: 'El template global de la cuenta vive en Configuración → Notificaciones.',
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
      valueMaps: 'Mapas de valores — traduce respuestas del formulario a valores del CRM',
      valueMapsHelp:
        'Convierte respuestas concretas en los valores exactos que esperan tus listas de HubSpot. Las respuestas sin traducción se envían sin cambios.',
      valueMapsExample: 'Ej.: cuando la respuesta es “Ventas”, HubSpot recibe “sales”.',
      valueMapAnswer: 'Respuesta en el form',
      valueMapCrmValue: 'Valor en HubSpot',
      addValueMap: 'Añadir traducción de valores',
      addValueMapRow: 'Añadir valor',
      emptyValueMaps: 'Aún no hay traducciones de valores.',
      outcomeProperty: 'Propiedad de resultado',
      outcomePropertyHelp:
        'Propiedad del contacto que recibe la etiqueta del resultado (p. ej. “Calificado”) en las respuestas completadas.',
      staticProperties: 'Propiedades estáticas',
      staticPropertiesHelp:
        'Valores fijos que se estampan en cada respuesta completada (p. ej. una marca de opt-in). Nunca sobrescriben una respuesta mapeada.',
      staticValue: 'Valor',
      addStaticProperty: 'Añadir propiedad',
      emptyStaticProperties: 'Aún no hay propiedades estáticas.',
      inferCompany: 'Inferir la empresa desde el email',
      inferCompanyHelp:
        'Cuando la persona usa un email de trabajo, rellena las propiedades de empresa y sitio web a partir de su dominio — los dominios gratuitos (gmail, outlook…) se omiten y los valores mapeados nunca se sobrescriben.',
      bookingSync: 'Sincronización de reservas',
      bookingSyncHelp:
        'Cuando la persona reserva una reunión desde una página de resultado, estampa estas propiedades del contacto con los datos de la reserva. Deja un campo en blanco para omitirlo.',
      bookingStageProperty: 'Propiedad de etapa',
      bookingStageValue: 'Valor de etapa',
      bookingDateProperty: 'Propiedad de fecha de reserva',
      bookingHoursProperty: 'Propiedad de hora de la reunión',
      connectPromptTitle: 'Conecta HubSpot para asignar este formulario',
      connectPromptBody:
        'HubSpot aún no está conectado en tu cuenta. Conéctalo una vez y luego vuelve para asignar cada pregunta a una propiedad de contacto.',
      connectPromptCta: 'Ir a Conexiones',
      connectedBadge: 'HubSpot conectado',
      propertiesUnavailable:
        'Las propiedades de HubSpot no están disponibles temporalmente; aún puedes escribir el nombre de una propiedad.',
      mapQuestions: 'Asignar preguntas',
      mapQuestionsHelp: 'Envía cada respuesta a una propiedad de contacto de HubSpot. Una pregunta debería asignarse a “email”.',
      yourQuestion: 'Tu pregunta',
      noQuestions: 'Este formulario aún no tiene preguntas para asignar. Añade pasos en el editor primero.',
      autoMap: 'Auto-asignar',
      autoMapFilled: 'Se asignaron automáticamente {n} pregunta(s). Revísalas y guarda.',
      autoMapNone: 'No hay nuevas coincidencias que sugerir.',
      mapElements: 'Asignar elementos del formulario',
      mapElementsHelp:
        'Envía los metadatos capturados —UTMs, puntuación, resultado y fecha de envío— a propiedades de HubSpot.',
      customMappings: 'Asignaciones personalizadas',
      customMappingsHelp:
        'Envía un dato adicional del form a una propiedad de HubSpot — útil para campos ocultos o UTMs.',
      keyGroupQuestions: 'Preguntas del formulario',
      keyGroupSystem: 'Campos del sistema',
      keyCustomOption: 'Clave personalizada…',
      keyCustomBack: 'Volver a la lista',
      selectKeyPlaceholder: 'Selecciona un campo…',
      webhookEvents: 'Disparar en',
      webhookEventsHelp: 'Elige qué respuestas se envían a este webhook. Por defecto se envían ambas.',
      eventPartial: 'Respuestas parciales',
      eventComplete: 'Respuestas completas',
    },
    connections: {
      title: 'Conexiones',
      subtitle:
        'Conecta tu cuenta a HubSpot y Calendly una vez. Luego asigna los campos de cada formulario desde su pestaña de integraciones.',
      hubspotName: 'HubSpot',
      hubspotDesc: 'Sincroniza respuestas con contactos de HubSpot y asigna preguntas a propiedades de contacto.',
      calendlyName: 'Calendly',
      calendlyDesc: 'Permite reservar reuniones desde los resultados de tu formulario.',
      connected: 'Conectado',
      notConnected: 'Sin conectar',
      connect: 'Conectar',
      connecting: 'Conectando…',
      disconnect: 'Desconectar',
      disconnecting: 'Desconectando…',
      cancel: 'Cancelar',
      tokenLabel: 'Pega tu token de {provider}',
      tokenPlaceholder: 'Pega el token…',
      tokenHelp: 'El token se valida, se cifra y se guarda en el servidor. No se vuelve a mostrar.',
      connectedAs: 'Conectado como {label}',
      endingIn: 'termina en {last4}',
      connectedOn: 'Conectado el {date}',
      connectSuccess: '{provider} conectado.',
      connectError: 'No se pudo conectar. Revisa el token e inténtalo de nuevo.',
      tokenRequired: 'Pega un token primero.',
      disconnectSuccess: '{provider} desconectado.',
      disconnectError: 'No se pudo desconectar. Inténtalo de nuevo.',
      disconnectConfirm: '¿Desconectar {provider} de esta cuenta?',
      encryptionOff: 'La conexión no está disponible',
      encryptionOffBody:
        'El servidor necesita una FORMS_ENCRYPTION_KEY para guardar credenciales de forma segura. Configúrala y reinicia la API para habilitar las conexiones.',
      loadError: 'No se pudieron cargar tus conexiones.',
      perFormNote: 'La asignación de campos se configura por formulario, desde la pestaña de integraciones de cada uno.',
    },
    publish: {
      publish: 'Publicar',
      publishing: 'Publicando…',
      published: 'Cambios publicados: tu formulario está en línea.',
      publishError: 'No se pudo publicar. Inténtalo de nuevo.',
      unpublishedChanges: 'Cambios sin publicar',
      noChanges: 'Todos los cambios están publicados',
    },
  },
  dialog: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    deleteFormTitle: 'Eliminar formulario',
    deleteQuestionTitle: 'Eliminar pregunta',
    deleteSubmissionTitle: 'Eliminar respuesta',
    removeMemberTitle: 'Quitar miembro',
    resetEmailTitle: 'Restablecer plantilla de correo',
    disconnectIntegrationTitle: 'Desconectar {provider}',
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
