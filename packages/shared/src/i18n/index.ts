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
    /** Step count on the generated share card. `{count}` is a number. */
    shareCardSteps: string;
    /**
     * Headline on a share card for a form that could not be loaded. The card is
     * rendered by a social crawler, so this is the one string here a RESPONDENT
     * may never see and a stranger's timeline might.
     */
    shareCardUntitled: string;
  };
  /** Public form-renderer chrome (all user content comes from the form config). */
  renderer: {
    start: string;
    back: string;
    next: string;
    submit: string;
    submitting: string;
    thankYouTitle: string;
    /**
     * V5-QA: no longer takes the form name. The only name available here is the
     * ADMIN one ("Q3 paid-ads lead gen v2"), which respondents were being shown
     * verbatim — and V5-A1 made this the guaranteed ending for scoring-off forms.
     * Authors who want a specific line set it in Design.
     */
    thankYouBody: string;
    ctaQuestion: string;
    ctaAction: string;
    progressLabel: string; // {current} {total}
    /** Vertical layout: the answered-question counter. // {answered} {total} */
    verticalProgress: string;
    /** Vertical layout: inline error summary shown next to the Submit button. */
    verticalErrors: string;
    revealHeadline: string;
    revealSubtitle: string;
    /** `versus` interstitial: the two marks' labels when the config sets none. */
    revealVersusYou: string;
    revealVersusMatch: string;
    /** The live status under the match's label while the screen plays. */
    revealVersusStatus: string;
    noSteps: string;
    dropdownPlaceholder: string;
    dropdownEmpty: string;
    trustedBy: string;
    newTab: string;
    /** Scheduler step (V6): copy for an unconfigured embed + the optional skip. */
    schedulerUnconfigured: string;
    schedulerSkip: string;
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
  /** The public member page (`/[accountCode]/[handle]`). */
  profile: {
    formsTitle: string;
    noForms: string;
  };
  admin: {
    /** Branded combobox (`components/ui/select`) that replaces native selects. */
    select: {
      search: string;
      noResults: string;
    };
    /** Branded mini calendar (`components/ui/date-picker`) that replaces native
     *  date inputs. */
    datePicker: {
      placeholder: string;
      dialogLabel: string;
      prevMonth: string;
      nextMonth: string;
      clear: string;
    };
    /** App shell chrome shared across every admin page (sidebar/header/footer). */
    chrome: {
      collapse: string;
      expand: string;
      openNav: string;
      /** The colour-scheme toggle. `next` names what one more click will do, so an
       *  icon-only control still announces its effect rather than only its state. */
      theme: {
        label: string;
        dark: string;
        light: string;
        next: string;
      };
      /** Left-nav item labels (icon + label). */
      nav: {
        home: string;
        forms: string;
        submissions: string;
        analytics: string;
        integrations: string;
        /**
         * The door to the wider platform (agents), an EXTERNAL link. Rendered
         * only when the deployment configures a platform URL, so a fork's rail
         * never carries a dead item.
         */
        agents: string;
      };
      /** The bottom-left profile button (avatar + name) and its menu. */
      profileMenu: {
        /** Accessible name of the trigger + the menu. */
        label: string;
        accountSettings: string;
        logOut: string;
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
      /** The workspace picker — a different axis from `switcher` (product). */
      workspaces: {
        menuLabel: string;
        eyebrow: string;
        /** Marks a workspace you were invited to and have not opened yet. */
        invited: string;
        /** The account is not among the caller's memberships (a stale choice). */
        unknown: string;
        /** "New workspace" menu entry + the create dialog. */
        create: string;
        createTitle: string;
        createSubtitle: string;
        createNameLabel: string;
        createNamePlaceholder: string;
        createSubmit: string;
        creating: string;
        createCancel: string;
        createErrorInvalid: string;
        createErrorForbidden: string;
        createErrorFailed: string;
        /** Type-to-find inside the menu (shown from six workspaces, or always for staff). */
        search: string;
        searching: string;
        searchEmpty: string;
        /** Marks a workspace the person is in by access grant (deployment staff), or an estate row. */
        staff: string;
        /** Eyebrow over estate rows the person never opened here (staff only). */
        estate: string;
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
    /** The workspace brand kit (Account settings → Brand kit; /admin/branding redirects there). */
    brandKit: {
      title: string;
      subtitle: string;
      save: string;
      saving: string;
      saved: string;
      /** V5: the save request never reached the server (kept, retry manually). */
      saveOffline: string;
      /** Read-only banner for non-admin members. */
      adminOnly: string;
      logoTitle: string;
      logoSubtitle: string;
      logoUrl: string;
      logoUrlPlaceholder: string;
      clientLogosTitle: string;
      clientLogosSubtitle: string;
      clientLogosAdd: string;
      clientLogosRemove: string;
      clientLogoUrlPlaceholder: string;
      clientLogoNamePlaceholder: string;
      colorsTitle: string;
      colorsSubtitle: string;
      /** An axis the kit leaves to each form. */
      notSet: string;
      clearAxis: string;
      typographyTitle: string;
      typographySubtitle: string;
      controlsTitle: string;
      controlsSubtitle: string;
      previewTitle: string;
      previewQuestion: string;
      previewButton: string;
      applyTitle: string;
      applySubtitle: string;
      applyWarning: string;
      applySelectAll: string;
      applyClear: string;
      applyButton: string; // {count}
      applying: string;
      appliedToast: string; // {count}
      appliedBadge: string;
      revert: string;
      reverting: string;
      revertedToast: string;
      emptyForms: string;
      updatedAt: string; // {date}
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
    /** Workspace/member/public-page labels shared by Account settings (/admin/settings redirects there). */
    settings: {
      title: string;
      subtitle: string;
      /** The renameable workspace name (admin/owner). */
      workspaceName: string;
      workspaceNameSave: string;
      workspaceNameSaved: string;
      workspaceNameError: string;
      displayName: string;
      email: string;
      handle: string;
      accountCode: string;
      vanity: string;
      vanityNone: string;
      publicPage: string;
      viewPublic: string;
      /** Pending invitations (identity-service deployments). */
      pendingBadge: string;
      resendInvite: string;
      resendSuccess: string;
      resendError: string;
      roleOwner: string;
      roleAdmin: string;
      roleMember: string;
      statusActive: string;
      statusInvited: string;
      statusDisabled: string;
      /** The public member page (`/[accountCode]/[handle]`). */
      publicPageHeading: string;
      publicPageSubtitle: string;
      publicPageEnable: string;
      publicPageNoHandle: string;
      publicPageHeadline: string;
      publicPageHeadlinePlaceholder: string;
      publicPageBio: string;
      publicPageBioPlaceholder: string;
      publicPageSave: string;
      publicPageSaving: string;
      publicPageSaved: string;
      publicPageError: string;
      publicPageView: string;
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
      /** The identity service refused the invitation (role or address). */
      inviteErrorUpstream: string;
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
      /** The identity service could not apply the change (role missing, member unmanaged, refused). */
      manageErrorUpstream: string;
      /** Ownership is a membership type upstream; only the Dapta app transfers it. */
      manageErrorOwnership: string;
    };
    /**
     * Account settings (/admin/account): the area behind the profile button.
     * Sub-nav Workspaces · Brand kit · Notifications · Public page. Role /
     * status / invite / manage-error labels are shared with `settings`.
     */
    account: {
      title: string;
      subtitle: string;
      /** Names the workspace the pages act in ("Managing: {name}"). */
      managing: string;
      nav: {
        workspaces: string;
        brandKit: string;
        notifications: string;
        publicPage: string;
      };
      /** The workspace list (cards). */
      workspaces: {
        title: string;
        subtitle: string;
        search: string;
        searchEmpty: string;
        newWorkspace: string;
        current: string;
        open: string;
        manage: string;
        yourRole: string;
        memberOne: string;
        /** {count} */
        memberOther: string;
        empty: string;
      };
      /** One workspace: name, Members and Invitations tabs. */
      workspace: {
        back: string;
        tabMembers: string;
        tabInvitations: string;
        notFound: string;
        noAccess: string;
        colName: string;
        colEmail: string;
        colRole: string;
        colStatus: string;
        colActions: string;
        colSent: string;
        colExpires: string;
        activate: string;
        deactivate: string;
        statusChangeSuccess: string;
        invitationsEmpty: string;
        invitationsSubtitle: string;
      };
      /** Public page: the member's own identity fields shown next to the editor. */
      profileHeading: string;
      profileSubtitle: string;
      /** Notifications, seen by a plain member (admins/owners edit them). */
      notificationsNoAccess: string;
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
      /** V5 — inline blank-name error (replaces the browser's native bubble). */
      nameRequired: string;
      /** Layout picker in the create dialog (slides vs vertical page). */
      layoutLabel: string;
      layoutSlides: string;
      layoutSlidesDesc: string;
      layoutVertical: string;
      layoutVerticalDesc: string;
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
      /** V5: the save request never reached the server; autosave keeps retrying. */
      saveOffline: string;
      /** Results tab clarity (V4-16 outcome heading + message + redirect field). */
      resultsHelp: {
        outcomeHeadingHelp: string;
        /** V5-A1 — why the ranges are inert while scoring is off. */
        outcomesInert: string;
        redirectDelayLabel: string;
        redirectDelayHelp: string;
        redirectDelayHint: string;
        overridesLabel: string;
        overridesHelp: string;
        overrideRemove: string;
        /** `{field}` `{bound}` — an override read back as a sentence. */
        overrideAtMost: string;
        overrideAtLeast: string;
        overrideIsAnyOf: string;
        /** V5-B5 — the heading field's tooltip (it IS the thank-you headline). */
        outcomeHeadingHelp2: string;
        /** V5-B5 — spells out that a redirect replaces the screen entirely. */
        redirectHelp2: string;
        redirectLabel: string;
        redirectHelp: string;
        /** Label for the per-outcome thank-you body textarea. */
        messageLabel: string;
        messageHelp: string;
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
        /** Phone step: label for the per-form default-country picker (V4-14). */
        phoneDefaultCountry: string;
        /** The "auto (locale-based)" option in the default-country picker. */
        phoneDefaultCountryAuto: string;
        /** Explains what the minimum-digit floor is for (V5-B5). */
        phoneMinDigitsHelp: string;
        sliderMin: string;
        sliderMax: string;
        sliderStep: string;
        sliderDefault: string;
        /** V5 — Default outside min/max; `{min}`/`{max}` are the bounds. */
        sliderDefaultOutOfRange: string;
        /** V5 — Max typed below Min. */
        sliderMaxBelowMin: string;
        /** V5-QA — min === max: the handle cannot move. */
        sliderNoTravel: string;
        /** V5-QA — step <= 0 is invalid HTML; the browser silently uses 1. */
        sliderStepInvalid: string;
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
        /** What may go in the Icon column: an emoji, initials, or an image. */
        iconHelp: string;
        iconPlaceholder: string;
        /** Icon picker: the three kinds, plus its empty/clear affordances. */
        iconTabEmoji: string;
        iconTabLetters: string;
        iconTabImage: string;
        iconClear: string;
        iconEmpty: string;
        iconLettersHint: string;
        iconImageHint: string;
        iconUrlInvalid: string;
        /** Section headings inside the emoji grid. */
        emojiGroups: {
          reactions: string;
          people: string;
          business: string;
          tech: string;
          comms: string;
          status: string;
          places: string;
        };
        remove: string;
        empty: string;
        /** V5 — what the `value` column is for, vs the visible label (B5). */
        valueHelp: string;
        /** V5 — what the visible label is. */
        labelHelp: string;
        /** Spreadsheet-paste import (option + optional score columns). */
        importer: {
          /** The "Import options" button beside "Add option". */
          open: string;
          title: string;
          /** One-line how-to above the textarea. */
          intro: string;
          placeholder: string;
          modeReplace: string;
          modeAppend: string;
          colOption: string;
          colScore: string;
          colStatus: string;
          statusOk: string;
          statusDuplicate: string;
          statusInvalid: string;
          /** {n} — decimal rounded to this integer. */
          statusRounded: string;
          /** {n} valid rows summary chip. */
          summaryValid: string;
          /** {n} rows carrying a score. */
          summaryWithScore: string;
          summaryHeaderSkipped: string;
          summaryExtraColumns: string;
          /** {n} rows cut by the per-question cap. */
          summaryTruncated: string;
          /** CTA — {n} interpolated. */
          submit: string;
          /** Replace would drop icons the current options carry. */
          replaceIconsNote: string;
          /** Paste has no score column but the question is scored. */
          noScoresNote: string;
          cancel: string;
        };
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
        /** V5 — range lies outside the slider bounds; `{min}`/`{max}` are them. */
        unreachable: string;
        /** V5-QA — an earlier range already claims these values (first wins). */
        overlapped: string;
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
        scoreField: string;
        scoreHint: string;
        scoreDead: string;
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
        /**
         * V5 — the show + hide rules overlap only partially, so the question
         * survives in a narrower window than the show rule reads. `{lo}`/`{hi}`
         * are the surviving bounds.
         */
        narrow: string;
        /** V5-QA — a rule the engine can never satisfy, so the step never shows. */
        neverShowMissing: string;
        neverShowEmpty: string;
        neverShowNoValues: string;
        /** V5-QA — same rule on the HIDE side: harmless, but it does nothing. */
        hideRuleInert: string;
      };
      variants: {
        title: string;
        hint: string;
        enable: string;
        field: string;
        add: string;
        matchValue: string;
        matchValuePlaceholder: string;
        /** V5 — multi-select source: tick every option this row answers to (A7). */
        matchValueMulti: string;
        /** V5 — nothing ticked yet on a multi-select row. */
        matchValueMultiEmpty: string;
        /** V5-QA — why a chip refuses: it would empty the row / duplicate another. */
        matchValueMultiLast: string;
        matchValueMultiDuplicate: string;
        /** V5-QA — the stored key names options the source no longer offers. */
        matchValueMultiOrphaned: string;
        /** V5-QA — matching is EXACT-set, which the UI never said. */
        matchValueMultiExact: string;
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
        /** V5-A5 — bare `@key` that never became a token; `{fixed}` is `[key]`. */
        tokenWarnRaw: string;
      };
      /** V5-B1 — the form-level ending (Design tab): the defaults ranges override. */
      ending: {
        title: string;
        subtitle: string;
        headline: string;
        headlineHint: string;
        headlineHelp: string;
        headlinePlaceholder: string;
        body: string;
        bodyHint: string;
        bodyPlaceholder: string;
        redirect: string;
        redirectHint: string;
        redirectPlaceholder: string;
        delay: string;
        delayHint: string;
        delayHelp: string;
        /** Shown when score ranges exist — they can override any field here. */
        outcomesNote: string;
      };
      /** Per-question behavior toggles (terminal / reveal card / hidden). */
      behavior: {
        title: string;
        terminal: string;
        terminalHint: string;
        reveal: string;
        revealHint: string;
        /** Hidden-question toggle — filled via a URL parameter (V4-13). */
        hidden: string;
        hiddenHint: string;
        /** V5 — the step's own answer key, editable in the panel (A10). */
        fieldKey: string;
        fieldKeyHint: string;
        /** V5 — rename refused: another question already uses that key. */
        fieldKeyTaken: string;
        /** V5-QA — input that sanitizes to nothing usable. */
        fieldKeyInvalid: string;
        /** V5 — live `?key=value` example; `{key}` is the current field key. */
        fieldKeyUrlExample: string;
        /** V5 — the rename saved, but its CRM mapping could not be moved. */
        fieldKeyMappingFailed: string;
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
      /** Partial-submission threshold ("save a partial after step N"). */
      partial: {
        title: string;
        hint: string;
        none: string;
        afterStep: string; // {n}
      };
      /** Form layout picker (Design tab): slides vs one-page vertical. */
      layout: {
        title: string;
        subtitle: string;
        slides: string;
        slidesHint: string;
        vertical: string;
        verticalHint: string;
        /** Shown in the cover section when vertical: no Start gate, CTA unused. */
        coverCtaNote: string;
        /** Vertical's ONE reveal (form-level): shown once, after Submit. */
        endReveal: string;
        endRevealHint: string;
      };
      cover: {
        title: string;
        subtitle: string;
        enabled: string;
        bannerText: string;
        bannerScope: string;
        bannerScopeForm: string;
        bannerScopeCover: string;
        bannerColor: string;
        bannerColorHint: string;
        bannerTextColor: string;
        bannerSize: string;
        bannerSizeSm: string;
        bannerSizeMd: string;
        bannerSizeLg: string;
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
        showClientLogos: string;
        clientLogosScope: string;
        clientLogosScopeCover: string;
        clientLogosScopeReveal: string;
        clientLogosScopeBoth: string;
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
        /** Vertical page preview: the single Submit at the end of the page. */
        verticalSubmit: string;
        step: string;
        of: string;
        device: string;
        mobile: string;
        desktop: string;
        close: string;
        /** The address bar above the preview frame. */
        urlLabel: string;
        copyLink: string;
        copied: string;
        openForm: string;
        /** Says the frame is a picture of the form, not a working form. */
        inert: string;
        previous: string;
        next: string;
      };
      /** The Design tab: everything about how the form looks. */
      design: {
        publicTitle: string;
        publicTitleHint: string;
        presetsTitle: string;
        presetsSubtitle: string;
        presetsCustom: string;
        colorsTitle: string;
        colorsSubtitle: string;
        background: string;
        foreground: string;
        accent: string;
        /** Warns that choosing colors stops the form following the visitor's theme. */
        themeLockHint: string;
        backgroundStyle: string;
        bgSolid: string;
        bgGradient: string;
        bgGlow: string;
        bgImage: string;
        backgroundImage: string;
        backgroundImageHint: string;
        overlay: string;
        contrast: string;
        contrastText: string;
        contrastButton: string;
        contrastFail: string;
        accentLowContrast: string;
        suggestApply: string;
        typographyTitle: string;
        typographySubtitle: string;
        font: string;
        fontSans: string;
        fontSerif: string;
        fontCustomGroup: string;
        customFontName: string;
        customFontNamePlaceholder: string;
        customFontUrl: string;
        customFontHint: string;
        controlsTitle: string;
        controlsSubtitle: string;
        radius: string;
        radiusSharp: string;
        radiusSoft: string;
        radiusRound: string;
        buttonStyle: string;
        buttonSolid: string;
        buttonOutline: string;
        buttonSoft: string;
        buttonFullWidth: string;
        progress: string;
        progressBar: string;
        progressDots: string;
        progressSteps: string;
        progressNone: string;
        layoutTitle: string;
        layoutSubtitle: string;
        formLogo: string;
        formLogoHint: string;
        logoSize: string;
        sizeSm: string;
        sizeMd: string;
        sizeLg: string;
        logoPosition: string;
        alignLeft: string;
        alignCenter: string;
        contentAlign: string;
        contentWidth: string;
        widthNarrow: string;
        widthWide: string;
        transition: string;
        transitionSlide: string;
        transitionFade: string;
        transitionNone: string;
        shareTitle: string;
        shareSubtitle: string;
        ogImage: string;
        ogImageHint: string;
        ogFallback: string;
        reset: string;
        /** The custom color popover. */
        colorSwatches: string;
        colorCustom: string;
        colorHex: string;
        colorInvalid: string;
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
        /** V5-QA — these ride the draft, unlike the integrations above them. */
        trackingDraftNote: string;
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
      metricTimeToComplete: string;
      metricPartials: string;
      metricBookings: string;
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
      colAnswered: string;
      colDropoff: string;
      dropoffSubtitleAnswered: string;
      coverRow: string;
      landingRow: string;
      emptyRangeTitle: string;
      emptyRangeBody: string;
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
      /** V5-A4 — steady-state autosave status (the Save button is gone). */
      autosaved: string;
      /** V5-QA — saved, except one card that has a problem of its own. */
      autosavedPartial: string;
      saveError: string;
      /** V5: the save never reached the server; autosave is retrying on its own. */
      saveOffline: string;
      saveRetrying: string;
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
      /** The mirror-form switch: a real HubSpot form-submission activity. */
      formActivity: string;
      formActivityHelp: string;
      /** Shown when HubSpot refused to build the mirror form. `{reason}` */
      formActivityError: string;
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
      /** V5-B5 — what the score property receives. */
      scorePropertyHelp: string;
      /** V5-B5 — HubSpot date properties are midnight-UTC, so the time is lost. */
      datePropertyHelp: string;
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
      /** What the fixed stage value is FOR — the card's least obvious control. */
      bookingStagePropertyHelp: string;
      bookingStageValue: string;
      bookingDateProperty: string;
      /** The distinction the whole property turns on: booked day, not meeting day. */
      bookingDatePropertyHelp: string;
      bookingHoursProperty: string;
      bookingHoursPropertyHelp: string;
      bookingDateTimezone: string;
      bookingDateTimezoneHelp: string;
      /** A sample IANA zone — the same in both locales, but authored not hardcoded. */
      bookingDateTimezonePlaceholder: string;
      /** Shown under the field when the browser cannot resolve the zone typed. */
      bookingDateTimezoneInvalid: string;
      /** Legacy configs only: a stored second HubSpot destination this tab will drop. */
      extraHubspotTitle: string;
      extraHubspotBody: string;
      /**
       * The form stores more webhooks than this card edits. Unlike the HubSpot
       * pair above, they are KEPT — several webhooks is a legal configuration.
       * `{count}` is how many ride along untouched.
       */
      carriedWebhooksTitle: string;
      carriedWebhooksBody: string;
      // Account-connection gating + Typeform-style mapping (per-form)
      connectPromptTitle: string;
      connectPromptBody: string;
      connectPromptCta: string;
      /** HubSpot keys contacts on email — a form with no address cannot sync. */
      emailRequiredTitle: string;
      emailRequiredBody: string;
      emailRequiredCta: string;
      emailFromScheduler: string;
      hubspotHowTitle: string;
      hubspotHowBody: string;
      /** Same explanation for a form whose address comes from the booking. */
      hubspotHowBodyScheduler: string;
      /** A scheduler supplies the address, but its provider is not connected. */
      schedulerDisconnected: string;
      mapQuestionsHelpScheduler: string;
      emailMappingConflictTitle: string;
      /** `{keys}` — the questions pointed at the email property. */
      emailMappingConflictBody: string;
      /** Send one sample delivery to the configured webhook. */
      pingWebhook: string;
      pingSending: string;
      pingOk: string;
      pingFailed: string;
      pingNeedsUrl: string;
      pingHelp: string;
      /**
       * Why a test delivery failed. One line per reason the API can name — a
       * bare "HTTP 400" told the author nothing about where to look. Only
       * `pingMethodNotAllowed` may claim POST was refused; that is the one
       * status that actually says so.
       */
      pingStatus: string;
      pingWeSend: string;
      pingEndpointSaid: string;
      pingMethodNotAllowed: string;
      pingUnsupportedMedia: string;
      pingRejectedBody: string;
      pingUnauthorized: string;
      pingNotFound: string;
      pingRateLimited: string;
      pingServerError: string;
      pingRedirect: string;
      pingBlocked: string;
      pingUnreachable: string;
      pingUnknown: string;
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
      /** Labels for what the booking page collected about the invitee. */
      inviteeName: string;
      inviteeFirstName: string;
      inviteeLastName: string;
      inviteePhone: string;
      /** The meeting slot itself — the scheduler step's own answer. */
      bookingStart: string;
      keyCustomBack: string;
      selectKeyPlaceholder: string;
      // Value pickers — choosing a HubSpot value instead of typing it exactly
      selectValue: string;
      valueCustomOption: string;
      valueCustomBack: string;
      /** Which properties a value map writes to. `{properties}` = a comma list. */
      valueMapTargets: string;
      /** Why a value map has no picker: nothing is mapped, so nothing constrains it. */
      valueMapNoTarget: string;
      /** Rows inside a collapsed value-map group. `{n}` = the row count. */
      valueMapRowCount: string;
      expandGroup: string;
      collapseGroup: string;
      webhookEvents: string;
      webhookEventsHelp: string;
      eventPartial: string;
      eventComplete: string;
      // Delivery history — the collapsible log inside each integration card.
      /** Per-card headings; the shared panel takes them as props. */
      historyWebhookTitle: string;
      historyHubspotTitle: string;
      historyEmailTitle: string;
      historyHelp: string;
      /** How a test delivery differs from a real one, since both are listed. */
      historyPingNote: string;
      /** Marks a row the "Send test" button produced. */
      historyTestBadge: string;
      // The transcript — what we sent, what came back.
      historyRequest: string;
      historyResponse: string;
      /** No transcript stored: an older delivery, or a kind that reports none. */
      historyBodyNotRecorded: string;
      /** The endpoint answered with no body at all. */
      historyBodyEmpty: string;
      historyEmpty: string;
      historyLoadError: string;
      historyRefresh: string;
      /** Opens the log in a dialog — a card is a settings form, not a log view. */
      historyOpen: string;
      historyClose: string;
      /** Header chips. `{n}` = a row count within the window that was read. */
      historyCount: string;
      historyFailedCount: string;
      // Row status labels.
      historyDelivered: string;
      historyRetrying: string;
      historyFailed: string;
      historySkipped: string;
      /** `{n}` = delivery attempts, shown only past the first. */
      historyAttempts: string;
      historyNoReason: string;
      // Google Sheets — announced, not shipped; the card is inert
      gsheetsTitle: string;
      gsheetsDesc: string;
      comingSoon: string;
    };
    /** Account-level provider connections (paste-token) surfaced on /admin/integrations. */
    connections: {
      title: string;
      subtitle: string;
      hubspotName: string;
      hubspotDesc: string;
      calendlyName: string;
      calendlyDesc: string;
      /** Google Sheets — coming-soon card only, not a connectable provider yet. */
      gsheetsName: string;
      gsheetsDesc: string;
      comingSoon: string;
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
      /** The deployment already supplies this provider's token (env fallback). */
      serverProvided: string;
      serverProvidedTitle: string;
      serverProvidedBody: string;
      /**
       * The account-level webhook INVENTORY, below the connections grid.
       *
       * Read-only by design: a webhook belongs to one form and is edited there.
       * This exists because "which of my forms send data out, and where?" was a
       * question you could only answer by opening every form in turn.
       */
      webhooks: {
        title: string;
        subtitle: string;
        colForm: string;
        colEndpoint: string;
        colEvents: string;
        colStatus: string;
        colHealth: string;
        on: string;
        off: string;
        eventsBoth: string;
        eventsPartial: string;
        eventsComplete: string;
        /** A signing secret is configured. The value itself is never shown. */
        signed: string;
        edit: string;
        /** Failure pill. `{n}` = deliveries that ended without landing. */
        failedCount: string;
        /** Tooltip head above the worker's verbatim reason. `{date}` = last one. */
        lastFailure: string;
        /** Why the count is per FORM even when a form has two webhooks. */
        failuresScopeNote: string;
        emptyTitle: string;
        emptyBody: string;
        emptyCta: string;
        loadError: string;
      };
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
    /**
     * First-run wizard: three questions, then the template the first form is
     * built from. Keys are spelled out rather than derived from the @quill/types
     * enums on purpose — this package is dependency-free by design, and the
     * compiler still enforces EN/ES parity and a complete option set either way.
     */
    onboarding: {
      /** The three stages, all visible from the first screen so the end is never a surprise. */
      stages: { account: string; profile: string; firstForm: string };
      next: string;
      back: string;
      /** Headline of the interstitial shown while the first form is created. */
      creating: string;
      creatingSubtitle: string;
      /** Shown in place of the interstitial when the form could not be created. */
      error: { headline: string; body: string; retry: string };
      /** Announced to assistive tech as the wizard advances. */
      progress: string; // {current} {total}
      role: {
        question: string;
        helper: string;
        options: {
          sales: string;
          marketing: string;
          support: string;
          product: string;
          founder: string;
          engineering: string;
          hr: string;
          operations: string;
          other: string;
        };
      };
      industry: {
        question: string;
        helper: string;
        placeholder: string;
        search: string;
        empty: string;
        options: {
          accounting: string;
          airlines_aviation: string;
          alternative_dispute_resolution: string;
          alternative_medicine: string;
          animation: string;
          apparel_fashion: string;
          architecture_planning: string;
          arts_crafts: string;
          automotive: string;
          aviation_aerospace: string;
          banking: string;
          biotechnology: string;
          broadcast_media: string;
          building_materials: string;
          business_supplies: string;
          capital_markets: string;
          chemicals: string;
          civic_social: string;
          civil_engineering: string;
          commercial_real_estate: string;
          computer_security: string;
          computer_games: string;
          computer_hardware: string;
          computer_networking: string;
          computer_software: string;
          construction: string;
          consumer_electronics: string;
          consumer_goods: string;
          consumer_services: string;
          education_management: string;
          financial_services: string;
          health_wellness: string;
          hospital_healthcare: string;
          hospitality: string;
          it_services: string;
          insurance: string;
          internet: string;
          law_practice: string;
          legal_services: string;
          marketing_advertising: string;
          medical_practice: string;
          nonprofit: string;
          real_estate: string;
          restaurants: string;
          retail: string;
          telecommunications: string;
          other: string;
          events_services: string;
          higher_education: string;
          human_resources: string;
          information_services: string;
          professional_training_coaching: string;
        };
      };
      /** Asked only of a cold signup — someone arriving from Dapta answered it there. */
      crm: {
        question: string;
        helper: string;
        options: {
          none: string;
          hubspot: string;
          odoo: string;
          clientify: string;
          ghl: string;
          bitrix24: string;
          salesforce: string;
          activecampaign: string;
          pipedrive: string;
          zoho_crm: string;
          escala: string;
          other: string;
        };
      };
      /**
       * The phone screen, first and cold-cohort only. Worded exactly as Dapta's
       * own signup words it — a neutral field label, never a verb. "What number
       * should we call you on?" tells someone they are about to be called, and
       * the answer to that is no.
       */
      phone: {
        question: string;
        helper: string;
        label: string;
        placeholder: string;
        invalid: string;
      };
      /**
       * Lead volume — asked with a slider (0–5000), so the copy is a unit label
       * beside the number rather than a set of bucket options. The buckets still
       * exist, but as the STORED value: the slider's number is folded into the
       * IAM's `contacts_per_month` buckets at answer time, so a Forms answer and
       * a Dapta answer land in the same histogram.
       */
      leadVolume: {
        question: string;
        helper: string;
        /** Sits beside the slider's number, e.g. "leads / month". */
        unit: string;
      };
      /**
       * Where the leads come from. The one question the IAM has no equivalent
       * for, so it is asked of BOTH cohorts.
       */
      leadSource: {
        question: string;
        helper: string;
        options: {
          none: string;
          facebook_ads: string;
          google_ads: string;
          outbound: string;
          internal_lists: string;
          other: string;
        };
      };
      useCase: {
        question: string;
        helper: string;
        options: {
          leads: string;
          feedback: string;
          event: string;
          application: string;
          other: string;
        };
      };
      templates: {
        question: string;
        helper: string;
        /** Badge on the card the previous answer pre-selected. */
        recommended: string;
        cta: string;
        /**
         * `name`/`description` are the CARD; `formName` is what the created form
         * is actually called. They are two strings because they are two jobs —
         * the blank card invites you to "Start from scratch" and the form it
         * makes is an "Untitled form" — and they live together so the name the
         * API writes cannot drift from the card that was clicked.
         */
        options: {
          'lead-qualifier': { name: string; description: string; formName: string };
          'customer-feedback': { name: string; description: string; formName: string };
          'event-registration': { name: string; description: string; formName: string };
          application: { name: string; description: string; formName: string };
          blank: { name: string; description: string; formName: string };
        };
      };
      /** The three coach marks shown in the builder right after the form is made. */
      tour: {
        next: string;
        done: string;
        dismiss: string;
        step: string; // {current} {total}
        edit: { title: string; body: string };
        preview: { title: string; body: string };
        publish: { title: string; body: string };
      };
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
    ctaAction: 'Get Dapta Forms, free',
    seoForm: 'Fill out {name} online.',
    shareCardSteps: '{count} questions',
    shareCardUntitled: 'Form',
  },
  renderer: {
    start: 'Start',
    back: 'Back',
    next: 'Next',
    submit: 'Submit',
    submitting: 'Submitting…',
    thankYouTitle: 'Thank you!',
    thankYouBody: 'Your answers were recorded.',
    ctaQuestion: 'Want your own form?',
    ctaAction: 'Get Dapta Forms, free',
    progressLabel: 'Step {current} of {total}',
    verticalProgress: '{answered} of {total} answered',
    verticalErrors: 'Check the highlighted questions above.',
    revealHeadline: 'Reviewing your answers…',
    revealSubtitle: 'One moment while we match you with the best next step.',
    revealVersusYou: 'You',
    revealVersusMatch: 'Your match',
    revealVersusStatus: 'Searching…',
    noSteps: 'This form has no steps yet.',
    dropdownPlaceholder: 'Type to search…',
    dropdownEmpty: 'No results found',
    trustedBy: 'Trusted by',
    newTab: '(opens in a new tab)',
    schedulerUnconfigured: 'This scheduler has not been set up yet.',
    schedulerSkip: 'Skip for now',
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
      submit: 'Could not submit. Please try again.',
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
  profile: {
    formsTitle: 'Forms',
    noForms: 'Nothing published yet.',
  },
  admin: {
    select: {
      search: 'Search…',
      noResults: 'No results',
    },
    datePicker: {
      placeholder: 'Pick a date',
      dialogLabel: 'Calendar',
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      clear: 'Clear date',
    },
    chrome: {
      collapse: 'Collapse sidebar',
      expand: 'Expand sidebar',
      openNav: 'Open navigation',
      theme: {
        label: 'Theme',
        dark: 'Dark',
        light: 'Light',
        next: 'Switch to',
      },
      nav: {
        home: 'Home',
        forms: 'Forms',
        submissions: 'Submissions',
        analytics: 'Analytics',
        integrations: 'Integrations',
        agents: 'Dapta Agents',
      },
      profileMenu: {
        label: 'Account menu',
        accountSettings: 'Account settings',
        logOut: 'Log out',
      },
      switcher: {
        trigger: 'Switch product',
        menuLabel: 'Dapta products',
        eyebrow: 'Dapta',
        dapta: 'Dapta Agents',
        calendars: 'Dapta Calendars',
        opensNewTab: '(opens in a new tab)',
      },
      workspaces: {
        menuLabel: 'Your workspaces',
        eyebrow: 'Workspace',
        invited: 'Invited',
        unknown: 'Unknown workspace',
        create: 'New workspace',
        createTitle: 'New workspace',
        createSubtitle: 'A separate space with its own forms, members, branding and integrations. You will be its owner.',
        createNameLabel: 'Name',
        createNamePlaceholder: 'e.g. Sales team',
        createSubmit: 'Create',
        creating: 'Creating…',
        createCancel: 'Cancel',
        createErrorInvalid: 'Give the workspace a name (up to 80 characters).',
        createErrorForbidden: 'Your account cannot create workspaces.',
        createErrorFailed: 'Could not create the workspace. Try again.',
        search: 'Find a workspace',
        searching: 'Searching',
        searchEmpty: 'No workspace matches that.',
        staff: 'Staff',
        estate: 'All workspaces',
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
      brandingDesc: 'Your brand kit: logo, colors and the public look.',
      integrations: 'Integrations & webhooks',
      integrationsDesc: 'Send responses to your CRM or a webhook.',
      analytics: 'Analytics',
      analyticsDesc: 'Funnel performance and drop-off.',
    },
    brandKit: {
      title: 'Brand kit',
      subtitle:
        'Your workspace look: logo, colors, font and controls. New forms start with it; you can apply it to existing forms below.',
      save: 'Save brand kit',
      saving: 'Saving…',
      saved: 'Brand kit saved.',
      saveOffline: 'Can’t reach the server. Check your connection and try again.',
      adminOnly: 'Only an admin or owner can edit the brand kit.',
      logoTitle: 'Logo',
      logoSubtitle: 'Shown on covers and headers unless a form sets its own.',
      logoUrl: 'Logo URL',
      logoUrlPlaceholder: 'https://…/logo.png',
      clientLogosTitle: 'Client logos',
      clientLogosSubtitle: 'The “trusted by” marquee on covers.',
      clientLogosAdd: 'Add logo',
      clientLogosRemove: 'Remove',
      clientLogoUrlPlaceholder: 'https://…/client.svg',
      clientLogoNamePlaceholder: 'Client name',
      colorsTitle: 'Colors',
      colorsSubtitle: 'Setting a background locks the light/dark theme of forms the kit is applied to.',
      notSet: 'Not set: each form keeps its own',
      clearAxis: 'Clear',
      typographyTitle: 'Typography',
      typographySubtitle: 'The typeface forms render with.',
      controlsTitle: 'Controls',
      controlsSubtitle: 'Corner radius and button style.',
      previewTitle: 'Preview',
      previewQuestion: 'How should we reach you?',
      previewButton: 'Continue',
      applyTitle: 'Apply to existing forms',
      applySubtitle: 'Pick the forms that should adopt the kit. Fields the kit doesn’t set are left as each form has them.',
      applyWarning:
        'Applying updates the selected forms immediately, including their published version. You can undo per form.',
      applySelectAll: 'Select all',
      applyClear: 'Clear selection',
      applyButton: 'Apply to selected ({count})',
      applying: 'Applying…',
      appliedToast: 'Brand kit applied ({count}).',
      appliedBadge: 'Kit applied',
      revert: 'Undo',
      reverting: 'Undoing…',
      revertedToast: 'Brand kit apply undone.',
      emptyForms: 'No forms yet. The kit will style your first one automatically.',
      updatedAt: 'Last saved {date}',
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
      workspaceName: 'Workspace name',
      workspaceNameSave: 'Save',
      workspaceNameSaved: 'Workspace renamed.',
      workspaceNameError: 'Could not rename the workspace.',
      displayName: 'Name',
      email: 'Email',
      handle: 'Handle',
      accountCode: 'Account code',
      vanity: 'Vanity slug',
      vanityNone: 'Not set',
      publicPage: 'Public page',
      viewPublic: 'View public page',
      pendingBadge: 'Pending',
      resendInvite: 'Resend',
      resendSuccess: 'Invitation sent again.',
      resendError: 'Could not resend the invitation.',
      roleOwner: 'Owner',
      roleAdmin: 'Admin',
      roleMember: 'Member',
      statusActive: 'Active',
      statusInvited: 'Invited',
      statusDisabled: 'Disabled',
      publicPageHeading: 'Your public page',
      publicPageSubtitle:
        'A page at your handle listing the forms you want people to find. Off until you turn it on.',
      publicPageEnable: 'Published',
      publicPageNoHandle: 'You need a handle before this page can have a URL.',
      publicPageHeadline: 'Headline',
      publicPageHeadlinePlaceholder: 'What you help people with',
      publicPageBio: 'About',
      publicPageBioPlaceholder: 'A short paragraph about what you do.',
      publicPageSave: 'Save',
      publicPageSaving: 'Saving…',
      publicPageSaved: 'Public page saved.',
      publicPageError: 'Could not save your public page.',
      publicPageView: 'View page',
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
      inviteErrorUpstream: 'The identity service refused that invitation.',
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
      manageErrorUpstream: 'The identity service could not apply this change.',
      manageErrorOwnership: 'Ownership is transferred from the Dapta app.',
    },
    account: {
      title: 'Account settings',
      subtitle: 'Your workspaces, brand kit, notifications and public page.',
      managing: 'Managing',
      nav: {
        workspaces: 'Workspaces',
        brandKit: 'Brand kit',
        notifications: 'Notifications',
        publicPage: 'Public page',
      },
      workspaces: {
        title: 'Workspaces',
        subtitle: 'Every workspace you belong to. Open one to work in it, or manage its members and invitations.',
        search: 'Search workspaces',
        searchEmpty: 'No workspace matches that.',
        newWorkspace: 'New workspace',
        current: 'Current',
        open: 'Open',
        manage: 'Manage',
        yourRole: 'Your role',
        memberOne: '1 member',
        memberOther: '{count} members',
        empty: 'You are not in any workspace yet.',
      },
      workspace: {
        back: 'All workspaces',
        tabMembers: 'Members',
        tabInvitations: 'Invitations',
        notFound: 'That workspace is not among yours.',
        noAccess: 'Only admins and owners of this workspace can manage its members.',
        colName: 'Name',
        colEmail: 'Email',
        colRole: 'Role',
        colStatus: 'Status',
        colActions: 'Actions',
        colSent: 'Sent',
        colExpires: 'Expires',
        activate: 'Activate',
        deactivate: 'Deactivate',
        statusChangeSuccess: 'Status updated.',
        invitationsEmpty: 'No pending invitations.',
        invitationsSubtitle: 'People invited by email who have not accepted yet.',
      },
      profileHeading: 'Your identity',
      profileSubtitle: 'How you appear on your public page.',
      notificationsNoAccess: 'Only admins and owners of this workspace can edit its notification emails.',
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
        'Open-source forms. This build uses the local dev provider: enter your email to sign in as yourself.',
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
      nameRequired: 'Give your form a name.',
      layoutLabel: 'Layout',
      layoutSlides: 'Slides',
      layoutSlidesDesc: 'One question per screen, step by step.',
      layoutVertical: 'One page',
      layoutVerticalDesc: 'All questions on a single page, one Submit.',
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
      saveError: 'Could not save. Please try again.',
      saveErrorReason: 'Couldn’t save: {reason}',
      saveInvalid: 'Can’t save yet: {reason}',
      saveOffline:
        'Can’t reach the server. Your changes are kept and saving will retry automatically.',
      resultsHelp: {
        outcomeHeadingHelp:
          'Shown to respondents as the heading on the thank-you screen when their score lands in this range.',
        outcomeHeadingHelp2:
          'This is the big line on the thank-you screen for this range. Not an internal name for it. Write it as something a respondent should read.',
        redirectHelp2:
          'If you set this, the thank-you screen above is never shown for this range. The respondent goes straight to the URL. Leave it empty to show the screen.',
        outcomesInert:
          'Scoring is off, so no range can be reached. Everyone sees the form’s own thank-you screen. Anything set on a range is skipped too, including its redirect and its scheduling handoff. Your ranges are kept; turn scoring on to use them again.',
        redirectDelayLabel: 'Show the thank-you first (ms)',
        redirectDelayHelp:
          'How long the thank-you screen stays up before the redirect happens. 0 leaves immediately.',
        redirectDelayHint: '0 = redirect immediately. 1500 shows the message for a second and a half.',
        overridesLabel: 'Forced by an answer',
        overridesHelp:
          'These beat the score outright: a respondent matching one lands here no matter what they scored. Shown so the range above can be trusted.',
        overrideRemove: 'Remove',
        overrideAtMost: '{field} is at most {bound}',
        overrideAtLeast: '{field} is at least {bound}',
        overrideIsAnyOf: '{field} is any of {bound}',
        redirectLabel: 'Redirect URL (optional)',
        redirectHelp:
          'Leave empty to show the thank-you screen. If set, respondents are sent here instead.',
        messageLabel: 'Message shown for this outcome',
        messageHelp:
          'The thank-you body respondents see for this range. Use [field] to insert an answer. Leave empty to use the default message.',
      },
      ending: {
        title: 'When the form ends',
        subtitle: 'What every respondent sees after they submit.',
        headline: 'Heading',
        headlineHint: 'Leave empty for the default “Thank you”.',
        headlineHelp:
          'The big line on the thank-you screen. A score range with its own heading replaces this one for people who land in that range.',
        headlinePlaceholder: 'Thanks. We got it',
        body: 'Message',
        bodyHint: 'Use [field] to insert an answer. Leave empty for the default text.',
        bodyPlaceholder: 'We’ll be in touch shortly.',
        redirect: 'Redirect URL (optional)',
        redirectHint: 'Leave empty to show the thank-you screen. If set, everyone is sent here.',
        redirectPlaceholder: 'https://…',
        delay: 'Show the thank-you first for (ms)',
        delayHint: '0 redirects immediately.',
        delayHelp:
          'Hold the thank-you screen this long so the respondent can read it, then send them to the URL above. Only applies when a redirect is set.',
        outcomesNote:
          'These are the defaults. A score range in Results that fills the same field wins for the people who land in it; a range that leaves it empty uses what you set here.',
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
        phoneMinDigitsHelp:
          'The shortest number accepted, not counting the country code. Phone lengths vary by country, so this is the floor that catches an obviously incomplete number.',
        phoneDefaultCountry: 'Default country',
        phoneDefaultCountryAuto: 'Automatic (based on visitor language)',
        sliderMin: 'Min',
        sliderMax: 'Max',
        sliderStep: 'Step',
        sliderDefault: 'Default',
        sliderDefaultOutOfRange: 'Default sits outside {min}–{max}. Respondents will see {shown} instead.',
        sliderMaxBelowMin: 'Max is below Min. The slider has nothing to move along.',
        sliderNoTravel: 'Min and Max are the same, so the handle cannot move. Respondents can only answer {min}.',
        sliderStepInvalid: 'Step must be greater than 0. Browsers ignore anything else and move in steps of 1.',
      },
      options: {
        title: 'Options',
        add: 'Add option',
        label: 'Label',
        value: 'Value',
        points: 'Points',
        pointsHint: 'Added to the score when this option is picked. Use a negative number to subtract.',
        icon: 'Icon',
        iconHelp:
          'An emoji, one or two letters, or an image. Emoji and letters show in a circle; images get a box they fit inside, so a wide logo is not cropped. Images are available on the card layout only.',
        iconPlaceholder: '🚀 or https://…',
        iconTabEmoji: 'Emoji',
        iconTabLetters: 'Letters',
        iconTabImage: 'Image',
        iconClear: 'Clear',
        iconEmpty: 'Pick an icon',
        iconLettersHint: 'Up to two letters, e.g. HS for HubSpot. Empty falls back to the label’s initials.',
        iconImageHint: 'An https:// image URL. Logos keep their shape. They are fit inside a box, not cropped to a circle.',
        iconUrlInvalid: 'This URL protocol is not allowed for images.',
        emojiGroups: {
          reactions: 'Reactions',
          people: 'People',
          business: 'Business',
          tech: 'Tech',
          comms: 'Communication',
          status: 'Status',
          places: 'Places',
        },
        remove: 'Remove option',
        empty: 'No options yet.',
        labelHelp: 'What respondents read on the option. Safe to reword at any time.',
        valueHelp:
          'What gets stored in the response and sent to HubSpot or a webhook. Keep it stable: changing it breaks past answers and any mapping that points at it.',
        importer: {
          open: 'Import options',
          title: 'Import options from a spreadsheet',
          intro:
            'Copy one or two columns from your sheet and paste them here. Column 1 is the option, column 2 (optional) is its score. A header row is detected automatically.',
          placeholder: 'SaaS B2B\t10\nE-commerce\t8\nHealthcare\t7',
          modeReplace: 'Replace options',
          modeAppend: 'Add to the end',
          colOption: 'Option',
          colScore: 'Score',
          colStatus: 'Status',
          statusOk: 'ok',
          statusDuplicate: 'duplicate',
          statusInvalid: 'invalid score',
          statusRounded: 'rounded to {n}',
          summaryValid: '{n} valid',
          summaryWithScore: '{n} with score',
          summaryHeaderSkipped: 'header skipped',
          summaryExtraColumns: 'extra columns ignored',
          summaryTruncated: '{n} over the limit',
          submit: 'Import {n} options',
          replaceIconsNote: 'Replacing removes the icons your current options carry.',
          noScoresNote: 'No scores in this paste. This question keeps its current points.',
          cancel: 'Cancel',
        },
      },
      sliderScoring: {
        title: 'Slider scoring',
        hint: 'Award points when the value falls inside a range.',
        add: 'Add range',
        min: 'From',
        max: 'To',
        points: 'Points',
        remove: 'Remove range',
        empty: 'No scoring ranges. The slider does not score.',
        unreachable: 'Outside the slider’s {min}–{max} range. This range can never award points.',
        overlapped: 'Overlaps a range above it. When both match, the one listed first wins.',
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
        scoreField: 'Score so far',
        scoreHint: 'The points collected by the questions above this one. This question\u2019s own answer is not counted, because it has not been given yet.',
        scoreDead:
          'This rule reads the score, but no question above this one can add points: the score is always 0 here, so it can never change what respondents see. Clear it, or move a scored question above.',
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
          'These show and hide rules cancel out. This question could never appear. Adjust one of them.',
        narrow:
          'The hide rule cuts into the show rule: this question only appears for {lo}–{hi}. If that is what you meant, ignore this.',
        neverShowMissing:
          'This rule has no value yet, so it never matches. The question is hidden from everyone until you fill it in.',
        neverShowEmpty:
          'Min is above Max, so no answer can fall in this range. The question is hidden from everyone.',
        neverShowNoValues:
          'No options are selected, so this rule never matches. The question is hidden from everyone.',
        hideRuleInert: 'This hide rule is incomplete, so it never applies. Finish it or clear it.',
      },
      variants: {
        title: 'Dynamic question',
        hint: 'Ask a different question depending on an earlier answer.',
        enable: 'Vary the question by a field',
        field: 'Based on field',
        add: 'Add variant',
        matchValue: 'When answer is',
        matchValuePlaceholder: 'e.g. founder',
        matchValueMulti: 'Tick every option this version answers to',
        matchValueMultiEmpty: 'Pick at least one option. An empty row never matches.',
        matchValueMultiLast: 'Keep at least one option. A row with none never matches.',
        matchValueMultiDuplicate: 'Another version already answers to that exact combination.',
        matchValueMultiOrphaned: 'This row still matches on {values}, which the question above no longer offers.',
        matchValueMultiExact: 'Fires only when the respondent picks exactly these options. No more, no fewer.',
        variantQuestion: 'Ask instead',
        fallback: 'Fallback (any other answer)',
        remove: 'Remove variant',
        interpolationHint: 'Type @ (or [field]) to insert an earlier answer into the question.',
        scopeNote: 'This only changes the question’s title. Not its options. To send people to a different question, use Logic.',
        sliderLabel: 'Slider unit label',
        tokenPickerLabel: 'Insert a previous answer',
        tokenPickerEmpty: 'No earlier answers yet. This is the first question.',
        tokenPickerNoMatch: 'No matching fields.',
        tokenWarnLater: '“{token}” is asked after this step. It will be empty here.',
        tokenWarnUnknown: '“{token}” doesn’t exist in this form.',
        tokenWarnRaw: '“{token}” stays as literal text: only {fixed} fills in an answer. Pick the field from the list to insert it.',
      },
      behavior: {
        title: 'Behavior',
        terminal: 'Ends the form',
        terminalHint: 'Completing this question ends the form immediately (disqualification).',
        reveal: 'Show reveal screen after',
        revealHint:
          'Adds a reveal card right after this question. Turning it off removes that card. Edit its copy by selecting the card.',
        hidden: 'Hidden question',
        hiddenHint: 'Not shown to respondents. Its answer is filled from a matching URL parameter (?key=value).',
        fieldKey: 'Field key',
        fieldKeyHint:
          'The name this answer is stored under. The URL parameter that prefills it, and what you type between brackets to recall it in a later question. Letters, numbers and underscores, up to 64 characters.',
        fieldKeyTaken: 'Another question already uses that key.',
        fieldKeyInvalid: 'A key needs at least one letter or number.',
        fieldKeyUrlExample: 'Prefill it with ?{key}=value',
        fieldKeyMappingFailed:
          'The field key was renamed, but its HubSpot mapping could not be moved. Re-pick the property in Connect.',
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
      partial: {
        title: 'Partial submissions',
        hint: 'Save a partial submission once a question is completed, even if the respondent never finishes.',
        none: 'Off: only save completed submissions',
        afterStep: 'After question {n}',
      },
      layout: {
        title: 'Layout',
        subtitle: 'How respondents move through the form.',
        slides: 'Slides',
        slidesHint: 'One question per screen, step by step.',
        vertical: 'One page',
        verticalHint:
          'Every question on a single page with one Submit. Logic still applies live: questions show and hide as answers change.',
        coverCtaNote:
          'On a one-page form the cover renders as a header above the questions: there is no Start button, so its text is not used.',
        endReveal: 'Reveal screen before results',
        endRevealHint:
          'Plays once, after Submit and before the result. Edit its copy by selecting the card at the end of the question list.',
      },
      cover: {
        title: 'Cover screen',
        subtitle: 'The intro screen shown before the first step.',
        enabled: 'Show a cover screen',
        bannerText: 'Banner text',
        bannerScope: 'Show the banner on',
        bannerScopeForm: 'Every screen',
        bannerScopeCover: 'Cover only',
        bannerColor: 'Banner color',
        bannerColorHint: 'Empty uses a soft tint of the accent. Set a color to make the strip carry.',
        bannerTextColor: 'Banner text color',
        bannerSize: 'Banner height',
        bannerSizeSm: 'Slim',
        bannerSizeMd: 'Standard',
        bannerSizeLg: 'Tall',
        eyebrow: 'Eyebrow',
        badge: 'Badge',
        headline: 'Headline',
        subheadline: 'Subheadline',
        ctaText: 'Start button text',
        trustBadge: 'Trust badge',
        branding: 'Branding',
        primaryColor: 'Primary color',
        primaryColorHint: 'Drives the accent on the public form. Auto-adjusted for contrast.',
        logo: 'Cover logo URL',
        logoHint: 'Shown on the cover screen only. Leave empty for no logo there.',
        logoInvalid: 'This URL protocol is not allowed for images.',
        clientLogos: 'Client logos',
        clientLogosHint: 'A “trusted by” marquee. The name shows when no image is set.',
        showClientLogos: 'Show the marquee',
        clientLogosScope: 'Show the marquee on',
        clientLogosScopeCover: 'Cover',
        clientLogosScopeReveal: 'Reveal screen',
        clientLogosScopeBoth: 'Both',
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
        verticalSubmit: 'Submit',
        step: 'Step',
        of: 'of',
        device: 'Device preview',
        mobile: 'Mobile',
        desktop: 'Desktop',
        close: 'Close',
        urlLabel: 'Public link',
        copyLink: 'Copy link',
        copied: 'Copied',
        openForm: 'Open',
        inert: 'Preview only. Nothing here is submitted.',
        previous: 'Previous screen',
        next: 'Next screen',
      },
      design: {
        publicTitle: 'Form title',
        publicTitleHint:
          'What visitors see. The browser tab, share previews, and the cover heading. Leave empty to use the form\u2019s internal name.',
        presetsTitle: 'Theme',
        presetsSubtitle: 'A starting point you can edit. Pick one, then change anything below.',
        presetsCustom: 'Custom',
        colorsTitle: 'Colors',
        colorsSubtitle: 'The ground, the text on it, and the one accent.',
        background: 'Background',
        foreground: 'Text',
        accent: 'Accent',
        themeLockHint:
          'Choosing a background fixes the form to this palette. It stops following the visitor’s light or dark setting.',
        backgroundStyle: 'Background style',
        bgSolid: 'Solid',
        bgGradient: 'Gradient',
        bgGlow: 'Glow',
        bgImage: 'Image',
        backgroundImage: 'Image URL',
        backgroundImageHint: 'Paste a link to the image. A dark layer keeps the text readable over it.',
        overlay: 'Image dimming',
        contrast: 'Contrast',
        contrastText: 'Text on background',
        contrastButton: 'Label on button',
        contrastFail: 'Below AA: hard to read.',
        accentLowContrast:
          'Your accent is {ratio}:1 against the background. No text uses it, so nothing becomes unreadable: but a selected option and the button may be hard to pick out.',
        suggestApply: 'Use {color}',
        typographyTitle: 'Typography',
        typographySubtitle: 'All eight faces are self-hosted, so the form loads nothing from a font CDN.',
        font: 'Typeface',
        fontSans: 'Sans',
        fontSerif: 'Serif',
        fontCustomGroup: 'Your own',
        customFontName: 'Font name',
        customFontNamePlaceholder: 'e.g. Söhne',
        customFontUrl: 'Font file URL (.woff2)',
        customFontHint: 'Host the file yourself and paste its link. Both fields are required.',
        controlsTitle: 'Shape and controls',
        controlsSubtitle: 'Corners, buttons, and how progress is shown.',
        radius: 'Corners',
        radiusSharp: 'Sharp',
        radiusSoft: 'Soft',
        radiusRound: 'Round',
        buttonStyle: 'Button',
        buttonSolid: 'Solid',
        buttonOutline: 'Outline',
        buttonSoft: 'Soft',
        buttonFullWidth: 'Full-width button',
        progress: 'Progress',
        progressBar: 'Bar',
        progressDots: 'Dots',
        progressSteps: 'Counter',
        progressNone: 'Hidden',
        layoutTitle: 'Layout',
        layoutSubtitle: 'Where things sit and how the form moves between steps.',
        formLogo: 'Form logo URL',
        formLogoHint: 'Shown on every question screen. Leave empty for no logo.',
        logoSize: 'Logo size',
        sizeSm: 'Small',
        sizeMd: 'Medium',
        sizeLg: 'Large',
        logoPosition: 'Logo position',
        alignLeft: 'Left',
        alignCenter: 'Center',
        contentAlign: 'Question alignment',
        contentWidth: 'Content width',
        widthNarrow: 'Narrow',
        widthWide: 'Wide',
        transition: 'Step transition',
        transitionSlide: 'Slide',
        transitionFade: 'Fade',
        transitionNone: 'None',
        shareTitle: 'Share card',
        shareSubtitle: 'How the link looks when someone shares it in chat or social.',
        ogImage: 'Share image URL',
        ogImageHint: 'Ideal size 1200×630.',
        ogFallback: 'Left empty, the card is generated from the colors and logo above.',
        reset: 'Reset design',
        colorSwatches: 'Presets',
        colorCustom: 'Custom',
        colorHex: 'Hex',
        colorInvalid: 'Enter a color like #1f6feb.',
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
        trackingDraftNote:
          'These IDs are staged with the rest of your draft: click Publish to put them on the live form. Integrations above save to the live form immediately.',
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
      metricTimeToComplete: 'Time to complete',
      metricPartials: 'Partial submits',
      metricBookings: 'Bookings',
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
      colAnswered: 'Answered',
      colDropoff: 'Drop-off',
      dropoffSubtitleAnswered: 'How many people answer each question, and how many stop there.',
      coverRow: 'Cover / landing',
      landingRow: 'Form views',
      emptyRangeTitle: 'No activity in this range',
      emptyRangeBody: 'This form has data, just not in the dates you picked. Try a wider range.',
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
      na: '',
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
      autosaved: 'Changes saved automatically',
      autosavedPartial: 'Saved everything except the webhook.',
      saveError: 'Could not save integrations.',
      saveOffline:
        'Can’t reach the server. Your changes are kept and saving will retry automatically.',
      saveRetrying: 'Connection lost: retrying…',
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
      webhookSecretSetPlaceholder: 'A secret is set. Leave blank to keep it, or type a new one.',
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
      formActivity: 'Record a form submission in HubSpot',
      formActivityHelp:
        'Creates a matching form in your portal, so each completed submission shows on the contact as a form submission activity listing the properties it set. Not just a note. Needs the forms and form-submissions-write scopes on your private app.',
      formActivityError: 'HubSpot could not set this up: {reason}',
      selectProperty: 'Select a property…',
      noProperty: '(none)',
      addMapping: 'Add mapping',
      remove: 'Remove',
      stepKey: 'Form step key',
      property: 'HubSpot property',
      emptyMappings: 'No mappings yet.',
      valueMaps: 'Value maps: translate form answers to CRM values',
      valueMapsHelp:
        'Rewrite specific answers into the exact values your HubSpot picklists expect. Answers without a translation are sent unchanged.',
      valueMapsExample: 'E.g. when the answer is “Sales”, HubSpot receives “sales”.',
      valueMapAnswer: 'Answer in the form',
      valueMapCrmValue: 'Value in HubSpot',
      addValueMap: 'Add value translation',
      addValueMapRow: 'Add value',
      emptyValueMaps: 'No value translations yet.',
      scorePropertyHelp:
        'Receives the total score as a number, on completed submissions only.',
      datePropertyHelp:
        'Receives the submission date. HubSpot date properties store midnight UTC, so the time of day is not kept. A webhook gets the full timestamp instead.',
      outcomeProperty: 'Outcome property',
      outcomePropertyHelp:
        'Receives the HEADING you wrote on the matching score range in Results. The same text the respondent sees. Only on completed submissions, and only when a range matches; with scoring off nothing is sent.',
      staticProperties: 'Static properties',
      staticPropertiesHelp:
        'Fixed values stamped on every completed submission (e.g. an opt-in flag). They never overwrite a mapped answer.',
      staticValue: 'Value',
      addStaticProperty: 'Add property',
      emptyStaticProperties: 'No static properties yet.',
      inferCompany: 'Infer company from email',
      inferCompanyHelp:
        'When the respondent uses a work email, fill the company and website properties from its domain: free-mail domains (gmail, outlook…) are skipped, and mapped values are never overwritten.',
      bookingSync: 'Booking sync',
      bookingSyncHelp:
        'When a respondent books a meeting from a scheduler step, stamp these contact properties with the booking facts. Leave a field blank to skip it.',
      bookingStageProperty: 'Stage property',
      bookingStagePropertyHelp:
        'Optional: stamp this fixed value on the chosen property every time someone books (e.g. Lead Status → Demo booked).',
      bookingStageValue: 'Stage value',
      bookingDateProperty: 'Booking date property',
      bookingDatePropertyHelp: 'Calendar day the lead booked (not the meeting day).',
      bookingHoursProperty: 'Meeting time property',
      bookingHoursPropertyHelp: 'Date and time the meeting starts, from the scheduler.',
      bookingDateTimezone: 'Day timezone',
      bookingDateTimezoneHelp:
        'IANA timezone the booking day is computed in (e.g. America/Bogota). Blank = UTC.',
      bookingDateTimezonePlaceholder: 'America/Bogota',
      bookingDateTimezoneInvalid: 'Not a timezone name we recognise. The day will be computed in UTC.',
      extraHubspotTitle: 'This form has a second HubSpot connection',
      extraHubspotBody:
        'This screen only edits the first one, so the other is invisible here: and any edit on this tab saves right away and deletes it, along with any mappings it holds. To send one answer to several properties, add the properties to the same question above instead.',
      carriedWebhooksTitle: 'This form has {count} more webhook(s)',
      carriedWebhooksBody:
        'This card edits the first one. The rest keep running exactly as they are and are saved untouched. They are just not editable from here. You can see all of them under Integrations.',
      connectPromptTitle: 'Connect HubSpot to map this form',
      connectPromptBody:
        'HubSpot isn’t connected for your account yet. Connect it once, then come back to map each question to a contact property.',
      connectPromptCta: 'Go to Connections',
      emailRequiredTitle: 'This form has no email address to sync',
      emailRequiredBody:
        'HubSpot matches a contact by email address. It updates the one it finds, or creates a new one. A submission with no address arrives with nothing to identify, so no contact is created and the lead is not synced. Add an email question, or a scheduler: Calendly collects the invitee’s address when someone books.',
      emailRequiredCta: 'Add an email question',
      emailFromScheduler:
        'Contacts will be keyed on the address Calendly collects when someone books. Answers only reach HubSpot once a meeting is booked.',
      hubspotHowTitle: 'How the sync works',
      hubspotHowBody:
        'Every submission is matched to a contact by email address: an existing contact is updated, and a new one is created when there is no match. A form that never asks for an email cannot be synced.',
      hubspotHowBodyScheduler:
        'Every submission is matched to a contact by email address: an existing contact is updated, and a new one is created when there is no match. This form does not ask for one. The booking collects it, so nothing here should be mapped to “email”.',
      schedulerDisconnected:
        'Calendly is not connected for this account, so the invitee’s address cannot be read back and nothing will reach HubSpot. The booking still succeeds, which is why this fails quietly. Connect Calendly in Connections.',
      mapQuestionsHelpScheduler:
        'Send each answer to a HubSpot contact property. Do not map anything to “email”. The booking supplies it, and a mapping here takes over and stops the sync.',
      emailMappingConflictTitle: 'This mapping stops the sync',
      emailMappingConflictBody:
        'The booking already supplies the address. A question mapped to “email” takes over as the contact key, so answers stop reaching HubSpot after a booking. Remove the mapping on: {keys}.',
      pingWebhook: 'Send test',
      pingSending: 'Sending…',
      pingOk: 'Test delivered. Your endpoint accepted it.',
      pingFailed: 'Test failed: {reason}',
      pingNeedsUrl: 'Save a webhook URL first.',
      pingHelp:
        'Posts one sample body in the real shape, signed the same way, so you can check what your endpoint receives. The answers are made up and marked as a test.',
      pingStatus: 'Your endpoint answered HTTP {status}.',
      pingWeSend: 'Dapta Forms always delivers with POST and a JSON body.',
      pingEndpointSaid: 'It replied: {detail}',
      pingMethodNotAllowed: 'It does not accept POST on this URL.',
      pingUnsupportedMedia: 'It refused the content type.',
      pingRejectedBody: 'It read the request and rejected the body.',
      pingUnauthorized: 'It refused the request as unauthorised. Check any token or secret it expects.',
      pingNotFound: 'There is nothing at that URL.',
      pingRateLimited: 'It is rate-limiting us. Try again shortly.',
      pingServerError: 'It failed on its side.',
      pingRedirect: 'It answered with a redirect, which we never follow. Use the final URL directly.',
      pingBlocked:
        'Blocked before sending: that address is private, reserved, or internal, and we never post to those.',
      pingUnreachable: 'Nothing answered at that URL. Check the host is reachable and not timing out.',
      pingUnknown: 'The delivery failed for a reason we could not identify.',
      connectedBadge: 'HubSpot connected',
      propertiesUnavailable:
        'HubSpot properties are temporarily unavailable, but you can still type a property name.',
      mapQuestions: 'Map questions',
      mapQuestionsHelp: 'Send each answer to a HubSpot contact property. One question should map to “email”.',
      yourQuestion: 'Your question',
      noQuestions: 'This form has no questions to map yet. Add steps in the editor first.',
      autoMap: 'Auto-map',
      autoMapFilled: 'Auto-mapped {n} question(s). Review and save.',
      autoMapNone: 'No new matches to suggest.',
      mapElements: 'Map form elements',
      mapElementsHelp:
        'Send captured metadata (UTMs, lead score, outcome, and submitted date) to HubSpot properties.',
      customMappings: 'Custom field mappings',
      customMappingsHelp:
        'Send an extra piece of form data to a HubSpot property: useful for hidden fields or UTMs.',
      keyGroupQuestions: 'Form questions',
      keyGroupSystem: 'System fields',
      keyCustomOption: 'Custom key…',
      inviteeName: 'Booking: full name',
      inviteeFirstName: 'Booking: first name',
      inviteeLastName: 'Booking: last name',
      inviteePhone: 'Booking: phone',
      bookingStart: 'Booking: meeting time',
      keyCustomBack: 'Back to list',
      selectKeyPlaceholder: 'Select a field…',
      selectValue: 'Select a value…',
      valueCustomOption: 'Custom value…',
      valueCustomBack: 'Back to list',
      valueMapTargets: 'Values are written to: {properties}',
      valueMapNoTarget: 'Map this question to a property above to pick from its values.',
      valueMapRowCount: '{n} value(s)',
      expandGroup: 'Expand',
      collapseGroup: 'Collapse',
      webhookEvents: 'Trigger on',
      webhookEventsHelp: 'Choose which submissions are sent to this webhook. Both are sent by default.',
      eventPartial: 'Partial submissions',
      eventComplete: 'Complete submissions',
      historyWebhookTitle: 'Webhook history',
      historyHubspotTitle: 'HubSpot history',
      historyEmailTitle: 'Email history',
      historyHelp: 'The last deliveries this form made, newest first. Open one to see what was sent.',
      historyPingNote:
        'Test deliveries are listed too, marked as tests: they reach your endpoint for real, but carry sample answers instead of a respondent’s.',
      historyTestBadge: 'Test',
      historyRequest: 'What we sent',
      historyResponse: 'What came back',
      historyBodyNotRecorded: 'Not recorded for this delivery.',
      historyBodyEmpty: 'Your endpoint answered with no body.',
      historyEmpty: 'Nothing has been delivered yet.',
      historyLoadError: 'Could not load the delivery history.',
      historyRefresh: 'Refresh',
      historyOpen: 'View history',
      historyClose: 'Close',
      historyCount: '{n} deliveries',
      historyFailedCount: '{n} failed',
      historyDelivered: 'Delivered',
      historyRetrying: 'In progress',
      historyFailed: 'Failed',
      historySkipped: 'Skipped',
      historyAttempts: '{n} attempts',
      historyNoReason: 'No reason was recorded.',
      gsheetsTitle: 'Google Sheets',
      gsheetsDesc: 'Append each response as a new row in a spreadsheet.',
      comingSoon: 'Coming soon',
    },
    connections: {
      title: 'Connections',
      subtitle:
        'Connect your account to HubSpot and Calendly once. Then map fields for each form from its integrations tab.',
      hubspotName: 'HubSpot',
      hubspotDesc: 'Sync respondents to HubSpot contacts and map questions to contact properties.',
      calendlyName: 'Calendly',
      calendlyDesc: 'Let respondents book meetings from your form outcomes.',
      gsheetsName: 'Google Sheets',
      gsheetsDesc: 'Append each response as a new row in a spreadsheet.',
      comingSoon: 'Coming soon',
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
      serverProvided: 'Provided by the server',
      serverProvidedTitle: 'Already working, using the server’s token',
      serverProvidedBody:
        'This deployment supplies a token for {provider}, so every account here can already sync. Connecting your own replaces it for this account only.',
      webhooks: {
        title: 'Webhooks',
        subtitle:
          'Every form that POSTs its submissions to an endpoint you control. Add or change one from that form’s Connect tab.',
        colForm: 'Form',
        colEndpoint: 'Endpoint',
        colEvents: 'Events',
        colStatus: 'Status',
        colHealth: 'Delivery',
        on: 'On',
        off: 'Off',
        eventsBoth: 'Partial + complete',
        eventsPartial: 'Partial submissions',
        eventsComplete: 'Complete submissions',
        signed: 'Signed with a secret',
        edit: 'Edit',
        failedCount: '{n} failed',
        lastFailure: 'Last failure {date}',
        failuresScopeNote:
          'Failures are counted per form, so a form with two webhooks shows the same count on both.',
        emptyTitle: 'No webhooks yet',
        emptyBody:
          'Open any form’s Connect tab and add a webhook URL to send every submission to your own endpoint.',
        emptyCta: 'Go to forms',
        loadError: 'Could not load your webhooks.',
      },
    },
    publish: {
      publish: 'Publish',
      publishing: 'Publishing…',
      published: 'Changes published. Your form is live.',
      publishError: 'Could not publish. Please try again.',
      unpublishedChanges: 'Unpublished changes',
      noChanges: 'All changes are published',
    },
    onboarding: {
      stages: { account: 'Your account', profile: 'Get to know you', firstForm: 'Your first form' },
      next: 'Continue',
      back: 'Back',
      creating: 'Building your form…',
      creatingSubtitle: 'Setting up your questions. This only takes a second.',
      error: {
        headline: 'We could not create your form',
        body: 'Your answers are saved. Try again. It is usually a passing connection problem.',
        retry: 'Try again',
      },
      progress: 'Question {current} of {total}',
      role: {
        question: 'What best describes your role?',
        helper: 'Pick the closest one. It changes what we put in front of you first.',
        options: {
          sales: 'Sales',
          marketing: 'Marketing',
          support: 'Customer success or support',
          product: 'Product, design or research',
          founder: 'Founder or CEO',
          engineering: 'Engineering or IT',
          hr: 'People or HR',
          operations: 'Operations',
          other: 'Something else',
        },
      },
      industry: {
        question: 'What industry are you in?',
        helper: 'Start typing to find yours.',
        placeholder: 'Search industries',
        search: 'Search',
        empty: 'Nothing matches. Pick Other.',
        options: {
          accounting: 'Accounting',
          airlines_aviation: 'Airlines/Aviation',
          alternative_dispute_resolution: 'Alternative Dispute Resolution',
          alternative_medicine: 'Alternative Medicine',
          animation: 'Animation',
          apparel_fashion: 'Apparel & Fashion',
          architecture_planning: 'Architecture & Planning',
          arts_crafts: 'Arts and Crafts',
          automotive: 'Automotive',
          aviation_aerospace: 'Aviation & Aerospace',
          banking: 'Banking',
          biotechnology: 'Biotechnology',
          broadcast_media: 'Broadcast Media',
          building_materials: 'Building Materials',
          business_supplies: 'Business Supplies and Equipment',
          capital_markets: 'Capital Markets',
          chemicals: 'Chemicals',
          civic_social: 'Civic & Social Organization',
          civil_engineering: 'Civil Engineering',
          commercial_real_estate: 'Commercial Real Estate',
          computer_security: 'Computer & Network Security',
          computer_games: 'Computer Games',
          computer_hardware: 'Computer Hardware',
          computer_networking: 'Computer Networking',
          computer_software: 'Computer Software',
          construction: 'Construction',
          consumer_electronics: 'Consumer Electronics',
          consumer_goods: 'Consumer Goods',
          consumer_services: 'Consumer Services',
          education_management: 'Education Management',
          financial_services: 'Financial Services',
          health_wellness: 'Health, Wellness and Fitness',
          hospital_healthcare: 'Hospital & Health Care',
          hospitality: 'Hospitality',
          it_services: 'Information Technology and Services',
          insurance: 'Insurance',
          internet: 'Internet',
          law_practice: 'Law Practice',
          legal_services: 'Legal Services',
          marketing_advertising: 'Marketing and Advertising',
          medical_practice: 'Medical Practice',
          nonprofit: 'Non-profit Organization Management',
          real_estate: 'Real Estate',
          restaurants: 'Restaurants',
          retail: 'Retail',
          telecommunications: 'Telecommunications',
          other: 'Other Industry',
          events_services: 'Events Services',
          higher_education: 'Higher Education',
          human_resources: 'Human Resources',
          information_services: 'Information Services',
          professional_training_coaching: 'Professional Training & Coaching',
        },
      },
      crm: {
        question: 'Which CRM do you use?',
        helper: 'We can send your responses straight there.',
        options: {
          none: 'None',
          hubspot: 'HubSpot',
          odoo: 'Odoo',
          clientify: 'Clientify',
          ghl: 'GoHighLevel',
          bitrix24: 'Bitrix24',
          salesforce: 'Salesforce',
          activecampaign: 'ActiveCampaign',
          pipedrive: 'Pipedrive',
          zoho_crm: 'Zoho CRM',
          escala: 'Escala',
          other: 'Other',
        },
      },
      phone: {
        question: 'Tell us about you',
        helper: 'So we can tailor your experience.',
        label: 'Your phone number',
        placeholder: '000 000 0000',
        invalid: 'That phone number does not look right. Check it and try again.',
      },
      leadVolume: {
        question: 'How many leads do you get a month?',
        helper: 'A rough number is fine.',
        unit: 'leads / month',
      },
      leadSource: {
        question: 'Where do your leads come from?',
        helper: 'Pick the main one.',
        options: {
          none: 'I do not have leads yet',
          facebook_ads: 'Facebook ads',
          google_ads: 'Google ads',
          outbound: 'Outbound',
          internal_lists: 'Internal lists',
          other: 'Somewhere else',
        },
      },
      useCase: {
        question: 'What do you want to use Forms for?',
        helper: 'We will set your first form up for exactly that.',
        options: {
          leads: 'Get more customers and leads',
          feedback: 'Collect feedback',
          event: 'Register people for an event',
          application: 'Take applications or requests',
          other: 'Something else',
        },
      },
      templates: {
        question: 'Here is your first form',
        helper: 'Start from one of these: every question is yours to change.',
        recommended: 'Recommended for you',
        cta: 'Create my form',
        options: {
          'lead-qualifier': {
            name: 'Lead qualifier',
            description: 'Scores each answer and splits the results into hot and warm.',
            formName: 'Lead qualifier',
          },
          'customer-feedback': {
            name: 'Customer feedback',
            description: 'A short satisfaction survey with an NPS question.',
            formName: 'Customer feedback',
          },
          'event-registration': {
            name: 'Event registration',
            description: 'Collect who is coming, how, and what they need.',
            formName: 'Event registration',
          },
          application: {
            name: 'Applications and requests',
            description: 'For job applications and inbound work requests alike.',
            formName: 'Applications and requests',
          },
          blank: {
            name: 'Start from scratch',
            description: 'An empty form. You write every question.',
            formName: 'Untitled form',
          },
        },
      },
      tour: {
        next: 'Next',
        done: 'Got it',
        dismiss: 'Dismiss',
        step: '{current} of {total}',
        edit: {
          title: 'Edit any question',
          body: 'Click a question to change its wording, its options, or what it asks for.',
        },
        preview: {
          title: 'See what they see',
          body: 'Preview opens the form exactly as the person answering it will find it.',
        },
        publish: {
          title: 'Publish when you are ready',
          body: 'Nothing is live until you publish. Then you get a link to share.',
        },
      },
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
    ctaAction: 'Consigue Dapta Forms, gratis',
    seoForm: 'Completa {name} en línea.',
    shareCardSteps: '{count} preguntas',
    shareCardUntitled: 'Formulario',
  },
  renderer: {
    start: 'Comenzar',
    back: 'Atrás',
    next: 'Siguiente',
    submit: 'Enviar',
    submitting: 'Enviando…',
    thankYouTitle: '¡Gracias!',
    thankYouBody: 'Tus respuestas quedaron registradas.',
    ctaQuestion: '¿Quieres tu propio formulario?',
    ctaAction: 'Consigue Dapta Forms, gratis',
    progressLabel: 'Paso {current} de {total}',
    verticalProgress: '{answered} de {total} respondidas',
    verticalErrors: 'Revisa las preguntas marcadas arriba.',
    revealHeadline: 'Revisando tus respuestas…',
    revealSubtitle: 'Un momento mientras encontramos el mejor siguiente paso para ti.',
    revealVersusYou: 'Tú',
    revealVersusMatch: 'Tu match',
    revealVersusStatus: 'Buscando…',
    noSteps: 'Este formulario aún no tiene pasos.',
    dropdownPlaceholder: 'Escribe para buscar…',
    dropdownEmpty: 'No se encontraron resultados',
    trustedBy: 'Confían en nosotros',
    newTab: '(se abre en una pestaña nueva)',
    schedulerUnconfigured: 'Este agendador aún no está configurado.',
    schedulerSkip: 'Omitir por ahora',
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
  profile: {
    formsTitle: 'Formularios',
    noForms: 'Todavía no hay nada publicado.',
  },
  admin: {
    select: {
      search: 'Buscar…',
      noResults: 'Sin resultados',
    },
    datePicker: {
      placeholder: 'Elige una fecha',
      dialogLabel: 'Calendario',
      prevMonth: 'Mes anterior',
      nextMonth: 'Mes siguiente',
      clear: 'Borrar fecha',
    },
    chrome: {
      collapse: 'Contraer barra lateral',
      expand: 'Expandir barra lateral',
      openNav: 'Abrir navegación',
      theme: {
        label: 'Tema',
        dark: 'Oscuro',
        light: 'Claro',
        next: 'Cambiar a',
      },
      nav: {
        home: 'Inicio',
        forms: 'Formularios',
        submissions: 'Respuestas',
        analytics: 'Analíticas',
        integrations: 'Integraciones',
        agents: 'Dapta Agents',
      },
      profileMenu: {
        label: 'Menú de cuenta',
        accountSettings: 'Ajustes de cuenta',
        logOut: 'Cerrar sesión',
      },
      switcher: {
        trigger: 'Cambiar producto',
        menuLabel: 'Productos Dapta',
        eyebrow: 'Dapta',
        dapta: 'Dapta Agents',
        calendars: 'Dapta Calendars',
        opensNewTab: '(se abre en una pestaña nueva)',
      },
      workspaces: {
        menuLabel: 'Tus workspaces',
        eyebrow: 'Workspace',
        invited: 'Invitado',
        unknown: 'Workspace desconocido',
        create: 'Nuevo workspace',
        createTitle: 'Nuevo workspace',
        createSubtitle: 'Un espacio aparte con sus propios formularios, miembros, marca e integraciones. Vas a ser su owner.',
        createNameLabel: 'Nombre',
        createNamePlaceholder: 'p. ej. Equipo de ventas',
        createSubmit: 'Crear',
        creating: 'Creando…',
        createCancel: 'Cancelar',
        createErrorInvalid: 'Ponle un nombre al workspace (hasta 80 caracteres).',
        createErrorForbidden: 'Tu cuenta no puede crear workspaces.',
        createErrorFailed: 'No se pudo crear el workspace. Intenta de nuevo.',
        search: 'Buscar workspace',
        searching: 'Buscando',
        searchEmpty: 'Ningún workspace coincide.',
        staff: 'Staff',
        estate: 'Todos los workspaces',
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
      brandingDesc: 'Tu kit de marca: logo, colores y la apariencia pública.',
      integrations: 'Integraciones y webhooks',
      integrationsDesc: 'Envía respuestas a tu CRM o a un webhook.',
      analytics: 'Analíticas',
      analyticsDesc: 'Rendimiento del embudo y abandono.',
    },
    brandKit: {
      title: 'Kit de marca',
      subtitle:
        'La apariencia de tu workspace: logo, colores, tipografía y controles. Los formularios nuevos nacen con él; abajo puedes aplicarlo a los existentes.',
      save: 'Guardar kit de marca',
      saving: 'Guardando…',
      saved: 'Kit de marca guardado.',
      saveOffline: 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.',
      adminOnly: 'Solo un admin o el owner puede editar el kit de marca.',
      logoTitle: 'Logo',
      logoSubtitle: 'Se muestra en portadas y encabezados salvo que un formulario tenga el suyo.',
      logoUrl: 'URL del logo',
      logoUrlPlaceholder: 'https://…/logo.png',
      clientLogosTitle: 'Logos de clientes',
      clientLogosSubtitle: 'La marquesina “confían en nosotros” de las portadas.',
      clientLogosAdd: 'Agregar logo',
      clientLogosRemove: 'Quitar',
      clientLogoUrlPlaceholder: 'https://…/cliente.svg',
      clientLogoNamePlaceholder: 'Nombre del cliente',
      colorsTitle: 'Colores',
      colorsSubtitle: 'Elegir un fondo fija el tema claro/oscuro de los formularios donde se aplique el kit.',
      notSet: 'Sin definir: cada formulario conserva el suyo',
      clearAxis: 'Limpiar',
      typographyTitle: 'Tipografía',
      typographySubtitle: 'La tipografía con la que se renderizan los formularios.',
      controlsTitle: 'Controles',
      controlsSubtitle: 'Radio de esquinas y estilo de botones.',
      previewTitle: 'Vista previa',
      previewQuestion: '¿Cómo te contactamos?',
      previewButton: 'Continuar',
      applyTitle: 'Aplicar a formularios existentes',
      applySubtitle:
        'Elige los formularios que deben adoptar el kit. Los campos que el kit no define quedan como cada formulario los tiene.',
      applyWarning:
        'Aplicar actualiza los formularios seleccionados de inmediato, incluida su versión publicada. Puedes deshacerlo por formulario.',
      applySelectAll: 'Seleccionar todos',
      applyClear: 'Limpiar selección',
      applyButton: 'Aplicar a seleccionados ({count})',
      applying: 'Aplicando…',
      appliedToast: 'Kit de marca aplicado ({count}).',
      appliedBadge: 'Kit aplicado',
      revert: 'Deshacer',
      reverting: 'Deshaciendo…',
      revertedToast: 'Aplicación del kit deshecha.',
      emptyForms: 'Aún no hay formularios. El kit vestirá el primero automáticamente.',
      updatedAt: 'Guardado por última vez {date}',
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
      workspaceName: 'Nombre del workspace',
      workspaceNameSave: 'Guardar',
      workspaceNameSaved: 'Workspace renombrado.',
      workspaceNameError: 'No se pudo renombrar el workspace.',
      displayName: 'Nombre',
      email: 'Correo',
      handle: 'Alias',
      accountCode: 'Código de cuenta',
      vanity: 'Slug personalizado',
      vanityNone: 'Sin definir',
      publicPage: 'Página pública',
      viewPublic: 'Ver página pública',
      pendingBadge: 'Pendiente',
      resendInvite: 'Reenviar',
      resendSuccess: 'Invitación enviada de nuevo.',
      resendError: 'No se pudo reenviar la invitación.',
      roleOwner: 'Propietario',
      roleAdmin: 'Administrador',
      roleMember: 'Miembro',
      statusActive: 'Activo',
      statusInvited: 'Invitado',
      statusDisabled: 'Desactivado',
      publicPageHeading: 'Tu página pública',
      publicPageSubtitle:
        'Una página en tu handle con los formularios que quieres que la gente encuentre. Apagada hasta que la prendas.',
      publicPageEnable: 'Publicada',
      publicPageNoHandle: 'Necesitas un handle antes de que esta página tenga URL.',
      publicPageHeadline: 'Titular',
      publicPageHeadlinePlaceholder: 'En qué ayudas a la gente',
      publicPageBio: 'Sobre ti',
      publicPageBioPlaceholder: 'Un párrafo corto sobre lo que haces.',
      publicPageSave: 'Guardar',
      publicPageSaving: 'Guardando…',
      publicPageSaved: 'Página pública guardada.',
      publicPageError: 'No se pudo guardar tu página pública.',
      publicPageView: 'Ver página',
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
      inviteErrorUpstream: 'El servicio de identidad rechazó esa invitación.',
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
      manageErrorUpstream: 'El servicio de identidad no pudo aplicar este cambio.',
      manageErrorOwnership: 'La propiedad se transfiere desde la app de Dapta.',
    },
    account: {
      title: 'Ajustes de cuenta',
      subtitle: 'Tus workspaces, kit de marca, notificaciones y página pública.',
      managing: 'Administrando',
      nav: {
        workspaces: 'Workspaces',
        brandKit: 'Kit de marca',
        notifications: 'Notificaciones',
        publicPage: 'Página pública',
      },
      workspaces: {
        title: 'Workspaces',
        subtitle: 'Todos los workspaces a los que perteneces. Abre uno para trabajar en él, o administra sus miembros e invitaciones.',
        search: 'Buscar workspaces',
        searchEmpty: 'Ningún workspace coincide.',
        newWorkspace: 'Nuevo workspace',
        current: 'Actual',
        open: 'Abrir',
        manage: 'Administrar',
        yourRole: 'Tu rol',
        memberOne: '1 miembro',
        memberOther: '{count} miembros',
        empty: 'Todavía no perteneces a ningún workspace.',
      },
      workspace: {
        back: 'Todos los workspaces',
        tabMembers: 'Miembros',
        tabInvitations: 'Invitaciones',
        notFound: 'Ese workspace no está entre los tuyos.',
        noAccess: 'Solo los administradores y propietarios de este workspace pueden administrar sus miembros.',
        colName: 'Nombre',
        colEmail: 'Correo',
        colRole: 'Rol',
        colStatus: 'Estado',
        colActions: 'Acciones',
        colSent: 'Enviada',
        colExpires: 'Vence',
        activate: 'Activar',
        deactivate: 'Desactivar',
        statusChangeSuccess: 'Estado actualizado.',
        invitationsEmpty: 'No hay invitaciones pendientes.',
        invitationsSubtitle: 'Personas invitadas por correo que aún no han aceptado.',
      },
      profileHeading: 'Tu identidad',
      profileSubtitle: 'Cómo apareces en tu página pública.',
      notificationsNoAccess: 'Solo los administradores y propietarios de este workspace pueden editar sus correos de notificación.',
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
        'Formularios de código abierto. Esta versión usa el proveedor de desarrollo local: introduce tu correo para entrar como tú mismo.',
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
      nameRequired: 'Ponle un nombre a tu formulario.',
      layoutLabel: 'Diseño',
      layoutSlides: 'Diapositivas',
      layoutSlidesDesc: 'Una pregunta por pantalla, paso a paso.',
      layoutVertical: 'Una página',
      layoutVerticalDesc: 'Todas las preguntas en una sola página, un solo Enviar.',
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
      saveError: 'No se pudo guardar. Inténtalo de nuevo.',
      saveErrorReason: 'No se pudo guardar: {reason}',
      saveInvalid: 'Aún no se puede guardar: {reason}',
      saveOffline:
        'No se pudo contactar al servidor. Tus cambios se conservan y el guardado se reintentará automáticamente.',
      resultsHelp: {
        outcomeHeadingHelp:
          'Se muestra a los respondientes como el encabezado de la pantalla de agradecimiento cuando su puntaje cae en este rango.',
        outcomeHeadingHelp2:
          'Es la línea grande de la pantalla de agradecimiento para este rango. No un nombre interno. Escríbela como algo que el respondiente deba leer.',
        redirectHelp2:
          'Si la defines, la pantalla de agradecimiento de arriba nunca se muestra para este rango. El respondiente va directo a la URL. Déjala vacía para mostrar la pantalla.',
        outcomesInert:
          'El puntaje está apagado, así que ningún rango puede alcanzarse. Todos ven la pantalla de agradecimiento del formulario. También se omite todo lo configurado en un rango, incluida su redirección y su agenda. Tus rangos se conservan; enciende el puntaje para volver a usarlos.',
        redirectDelayLabel: 'Mostrar el agradecimiento antes (ms)',
        redirectDelayHelp:
          'Cuánto se queda la pantalla de agradecimiento antes de redirigir. 0 se va de inmediato.',
        redirectDelayHint: '0 = redirige de inmediato. 1500 muestra el mensaje segundo y medio.',
        overridesLabel: 'Forzado por una respuesta',
        overridesHelp:
          'Estas le ganan al puntaje: quien las cumpla cae acá sin importar cuánto sumó. Se muestran para que el rango de arriba se pueda creer.',
        overrideRemove: 'Quitar',
        overrideAtMost: '{field} es como máximo {bound}',
        overrideAtLeast: '{field} es al menos {bound}',
        overrideIsAnyOf: '{field} es alguno de {bound}',
        redirectLabel: 'URL de redirección (opcional)',
        redirectHelp:
          'Déjalo vacío para mostrar la pantalla de agradecimiento. Si lo defines, se redirige ahí a los respondientes.',
        messageLabel: 'Mensaje mostrado para este resultado',
        messageHelp:
          'El cuerpo de agradecimiento que ven los respondientes en este rango. Usa [campo] para insertar una respuesta. Déjalo vacío para usar el mensaje por defecto.',
      },
      ending: {
        title: 'Cuando termina el formulario',
        subtitle: 'Lo que ve cada respondiente después de enviar.',
        headline: 'Encabezado',
        headlineHint: 'Déjalo vacío para el «Gracias» por defecto.',
        headlineHelp:
          'La línea grande de la pantalla de agradecimiento. Un rango de puntaje con su propio encabezado reemplaza este para quienes caigan en ese rango.',
        headlinePlaceholder: 'Gracias: lo recibimos',
        body: 'Mensaje',
        bodyHint: 'Usa [campo] para insertar una respuesta. Déjalo vacío para el texto por defecto.',
        bodyPlaceholder: 'Te contactamos en breve.',
        redirect: 'URL de redirección (opcional)',
        redirectHint: 'Déjalo vacío para mostrar la pantalla de agradecimiento. Si lo defines, se redirige a todos ahí.',
        redirectPlaceholder: 'https://…',
        delay: 'Mostrar el agradecimiento antes durante (ms)',
        delayHint: '0 redirige de inmediato.',
        delayHelp:
          'Mantiene la pantalla de agradecimiento este tiempo para que el respondiente la lea y luego lo envía a la URL de arriba. Solo aplica si hay redirección.',
        outcomesNote:
          'Estos son los valores por defecto. Un rango de puntaje en Resultados que llene el mismo campo gana para quienes caigan en él; un rango que lo deje vacío usa lo que definas aquí.',
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
        phoneMinDigitsHelp:
          'El número más corto que se acepta, sin contar el código de país. La longitud varía según el país, así que este es el piso que atrapa un número claramente incompleto.',
        phoneDefaultCountry: 'País predeterminado',
        phoneDefaultCountryAuto: 'Automático (según el idioma del visitante)',
        sliderMin: 'Mín',
        sliderMax: 'Máx',
        sliderStep: 'Paso',
        sliderDefault: 'Predeterminado',
        sliderDefaultOutOfRange: 'El predeterminado está fuera de {min}–{max}. Los respondientes verán {shown}.',
        sliderMaxBelowMin: 'El máximo es menor que el mínimo. El deslizador no tiene recorrido.',
        sliderNoTravel: 'El mínimo y el máximo son iguales, así que el control no se puede mover: solo se puede responder {min}.',
        sliderStepInvalid: 'El paso debe ser mayor que 0. Los navegadores ignoran cualquier otro valor y avanzan de 1 en 1.',
      },
      options: {
        title: 'Opciones',
        add: 'Añadir opción',
        label: 'Etiqueta',
        value: 'Valor',
        points: 'Puntos',
        pointsHint: 'Se suma al puntaje cuando se elige esta opción. Usa un número negativo para restar.',
        labelHelp: 'Lo que leen los respondientes en la opción. Puedes reescribirlo cuando quieras.',
        valueHelp:
          'Lo que se guarda en la respuesta y se envía a HubSpot o al webhook. Mantenlo estable: cambiarlo rompe las respuestas anteriores y cualquier mapeo que lo use.',
        importer: {
          open: 'Importar opciones',
          title: 'Importar opciones desde una hoja de cálculo',
          intro:
            'Copia una o dos columnas de tu hoja y pégalas aquí. La columna 1 es la opción y la columna 2 (opcional) su puntaje. La fila de encabezado se detecta sola.',
          placeholder: 'SaaS B2B\t10\nE-commerce\t8\nSalud\t7',
          modeReplace: 'Reemplazar opciones',
          modeAppend: 'Agregar al final',
          colOption: 'Opción',
          colScore: 'Puntaje',
          colStatus: 'Estado',
          statusOk: 'ok',
          statusDuplicate: 'duplicada',
          statusInvalid: 'puntaje inválido',
          statusRounded: 'redondeado a {n}',
          summaryValid: '{n} válidas',
          summaryWithScore: '{n} con puntaje',
          summaryHeaderSkipped: 'encabezado omitido',
          summaryExtraColumns: 'columnas extra ignoradas',
          summaryTruncated: '{n} sobre el límite',
          submit: 'Importar {n} opciones',
          replaceIconsNote: 'Reemplazar elimina los íconos de las opciones actuales.',
          noScoresNote: 'Este pegado no trae puntajes. La pregunta conserva sus puntos actuales.',
          cancel: 'Cancelar',
        },
        icon: 'Ícono',
        iconHelp:
          'Un emoji, una o dos letras, o una imagen. Los emoji y las letras se muestran en un círculo; las imágenes reciben una caja donde entran completas, así un logo ancho no se recorta. Las imágenes solo están disponibles en el diseño de tarjetas.',
        iconPlaceholder: '🚀 o https://…',
        iconTabEmoji: 'Emoji',
        iconTabLetters: 'Letras',
        iconTabImage: 'Imagen',
        iconClear: 'Quitar',
        iconEmpty: 'Elige un ícono',
        iconLettersHint: 'Hasta dos letras, por ejemplo HS para HubSpot. Si lo dejas vacío se usan las iniciales de la etiqueta.',
        iconImageHint: 'Una URL de imagen https://. Los logos conservan su forma: entran completos en una caja, no se recortan en un círculo.',
        iconUrlInvalid: 'Este protocolo de URL no está permitido para imágenes.',
        emojiGroups: {
          reactions: 'Reacciones',
          people: 'Personas',
          business: 'Negocio',
          tech: 'Tecnología',
          comms: 'Comunicación',
          status: 'Estado',
          places: 'Lugares',
        },
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
        empty: 'Sin rangos de puntaje. El deslizador no suma.',
        unreachable: 'Fuera del rango {min}–{max} del deslizador. Este rango nunca puede dar puntos.',
        overlapped: 'Se solapa con un rango de más arriba. Cuando ambos coinciden, gana el que está primero.',
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
        scoreField: 'Puntaje hasta aquí',
        scoreHint: 'Los puntos que suman las preguntas anteriores a esta. La respuesta de esta pregunta no cuenta: todavía no la dieron.',
        scoreDead:
          'Esta regla lee el puntaje, pero ninguna pregunta anterior a esta suma puntos: aquí el puntaje siempre es 0 y la regla nunca cambia lo que se muestra. Bórrala, o mueve una pregunta con puntos arriba.',
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
          'Estas reglas de mostrar y ocultar se anulan. Esta pregunta nunca aparecería. Ajusta una de ellas.',
        narrow:
          'La regla de ocultar recorta la de mostrar: esta pregunta solo aparece entre {lo} y {hi}. Si es lo que buscabas, ignora este aviso.',
        neverShowMissing:
          'Esta regla aún no tiene valor, así que nunca coincide. La pregunta queda oculta para todos hasta que lo completes.',
        neverShowEmpty:
          'El mínimo es mayor que el máximo, así que ninguna respuesta cae en ese rango. La pregunta queda oculta para todos.',
        neverShowNoValues:
          'No hay opciones seleccionadas, así que esta regla nunca coincide. La pregunta queda oculta para todos.',
        hideRuleInert: 'Esta regla de ocultar está incompleta, así que nunca aplica. Complétala o bórrala.',
      },
      variants: {
        title: 'Pregunta dinámica',
        hint: 'Haz una pregunta distinta según una respuesta anterior.',
        enable: 'Variar la pregunta según un campo',
        field: 'Según el campo',
        add: 'Añadir variante',
        matchValue: 'Cuando la respuesta sea',
        matchValuePlaceholder: 'p. ej. fundador',
        matchValueMulti: 'Marca todas las opciones a las que responde esta versión',
        matchValueMultiEmpty: 'Elige al menos una opción. Una fila vacía nunca coincide.',
        matchValueMultiLast: 'Deja al menos una opción. Una fila sin ninguna nunca coincide.',
        matchValueMultiDuplicate: 'Otra versión ya responde a esa combinación exacta.',
        matchValueMultiOrphaned: 'Esta fila todavía coincide con {values}, que la pregunta de arriba ya no ofrece.',
        matchValueMultiExact: 'Se activa solo si el respondiente elige exactamente estas opciones: ni más, ni menos.',
        variantQuestion: 'Preguntar en su lugar',
        fallback: 'Alternativa (cualquier otra respuesta)',
        remove: 'Quitar variante',
        interpolationHint: 'Escribe @ (o [campo]) para insertar una respuesta anterior en la pregunta.',
        scopeNote: 'Esto solo cambia el título de la pregunta. No sus opciones. Para enviar a otra pregunta, usa Lógica.',
        sliderLabel: 'Etiqueta de unidad del deslizador',
        tokenPickerLabel: 'Insertar una respuesta anterior',
        tokenPickerEmpty: 'Aún no hay respuestas anteriores. Esta es la primera pregunta.',
        tokenPickerNoMatch: 'Ningún campo coincide.',
        tokenWarnLater: '«{token}» se pregunta después de este paso: quedará vacío.',
        tokenWarnUnknown: '«{token}» no existe en este formulario.',
        tokenWarnRaw: '«{token}» queda como texto literal: solo {fixed} rellena una respuesta. Elige el campo de la lista para insertarlo.',
      },
      behavior: {
        title: 'Comportamiento',
        terminal: 'Termina el formulario',
        terminalHint: 'Completar esta pregunta termina el formulario de inmediato (descalificación).',
        reveal: 'Mostrar pantalla de revelación después',
        revealHint:
          'Añade una tarjeta de revelación justo después de esta pregunta. Al apagarlo se elimina esa tarjeta. Edita su texto seleccionando la tarjeta.',
        hidden: 'Pregunta oculta',
        hiddenHint: 'No se muestra a los respondientes: su respuesta se rellena desde un parámetro de URL coincidente (?clave=valor).',
        fieldKey: 'Clave del campo',
        fieldKeyHint:
          'El nombre con el que se guarda esta respuesta. El parámetro de URL que la rellena y lo que escribes entre corchetes para reutilizarla en una pregunta posterior. Letras, números y guiones bajos, hasta 64 caracteres.',
        fieldKeyTaken: 'Otra pregunta ya usa esa clave.',
        fieldKeyInvalid: 'La clave necesita al menos una letra o número.',
        fieldKeyUrlExample: 'Rellénala con ?{key}=valor',
        fieldKeyMappingFailed:
          'Se renombró la clave del campo, pero no se pudo mover su mapeo de HubSpot. Vuelve a elegir la propiedad en Conectar.',
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
      partial: {
        title: 'Envíos parciales',
        hint: 'Guarda un envío parcial al completar una pregunta, aunque la persona no termine.',
        none: 'Desactivado: solo guardar envíos completos',
        afterStep: 'Tras la pregunta {n}',
      },
      layout: {
        title: 'Diseño',
        subtitle: 'Cómo avanzan los respondientes por el formulario.',
        slides: 'Diapositivas',
        slidesHint: 'Una pregunta por pantalla, paso a paso.',
        vertical: 'Una página',
        verticalHint:
          'Todas las preguntas en una sola página con un solo Enviar. La lógica sigue aplicando en vivo. Las preguntas aparecen y se ocultan según las respuestas.',
        coverCtaNote:
          'En un formulario de una página la portada se muestra como encabezado sobre las preguntas. No hay botón de inicio, así que su texto no se usa.',
        endReveal: 'Pantalla de revelación antes del resultado',
        endRevealHint:
          'Se muestra una vez, después de Enviar y antes del resultado. Edita su texto seleccionando la tarjeta al final de la lista de preguntas.',
      },
      cover: {
        title: 'Portada',
        subtitle: 'La pantalla de introducción antes del primer paso.',
        enabled: 'Mostrar una portada',
        bannerText: 'Texto del banner',
        bannerScope: 'Mostrar el banner en',
        bannerScopeForm: 'Todas las pantallas',
        bannerScopeCover: 'Solo la portada',
        bannerColor: 'Color del banner',
        bannerColorHint: 'Vacío usa un tinte suave del acento; elegí un color para que la franja se note.',
        bannerTextColor: 'Color del texto del banner',
        bannerSize: 'Alto del banner',
        bannerSizeSm: 'Fina',
        bannerSizeMd: 'Normal',
        bannerSizeLg: 'Alta',
        eyebrow: 'Antetítulo',
        badge: 'Insignia',
        headline: 'Titular',
        subheadline: 'Subtítulo',
        ctaText: 'Texto del botón de inicio',
        trustBadge: 'Sello de confianza',
        branding: 'Marca',
        primaryColor: 'Color primario',
        primaryColorHint: 'Define el acento del formulario público. Se ajusta para contraste.',
        logo: 'URL del logo de la portada',
        logoHint: 'Solo en la portada. Vacío = sin logo ahí.',
        logoInvalid: 'Este protocolo de URL no está permitido para imágenes.',
        clientLogos: 'Logos de clientes',
        clientLogosHint: 'Una marquesina de «confían en nosotros». El nombre se muestra si no hay imagen.',
        showClientLogos: 'Mostrar la marquesina',
        clientLogosScope: 'Mostrar la marquesina en',
        clientLogosScopeCover: 'Portada',
        clientLogosScopeReveal: 'Pantalla de carga',
        clientLogosScopeBoth: 'Ambas',
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
        verticalSubmit: 'Enviar',
        step: 'Paso',
        of: 'de',
        device: 'Vista por dispositivo',
        mobile: 'Móvil',
        desktop: 'Escritorio',
        close: 'Cerrar',
        urlLabel: 'Enlace público',
        copyLink: 'Copiar enlace',
        copied: 'Copiado',
        openForm: 'Abrir',
        inert: 'Solo vista previa: nada de esto se envía.',
        previous: 'Pantalla anterior',
        next: 'Pantalla siguiente',
      },
      design: {
        publicTitle: 'Título del formulario',
        publicTitleHint:
          'Lo que ven los visitantes: la pestaña del navegador, las vistas previas al compartir y el encabezado de portada. Déjalo vacío para usar el nombre interno del formulario.',
        presetsTitle: 'Tema',
        presetsSubtitle: 'Un punto de partida editable. Elige uno y luego cambia lo que quieras.',
        presetsCustom: 'Personalizado',
        colorsTitle: 'Colores',
        colorsSubtitle: 'El fondo, el texto encima y el color de marca.',
        background: 'Fondo',
        foreground: 'Texto',
        accent: 'Color de marca',
        themeLockHint:
          'Al elegir un fondo, el formulario queda fijo en esta paleta: deja de seguir el modo claro u oscuro del visitante.',
        backgroundStyle: 'Estilo de fondo',
        bgSolid: 'Plano',
        bgGradient: 'Degradado',
        bgGlow: 'Resplandor',
        bgImage: 'Imagen',
        backgroundImage: 'URL de la imagen',
        backgroundImageHint: 'Pega el enlace de la imagen. Una capa oscura mantiene el texto legible encima.',
        overlay: 'Oscurecer imagen',
        contrast: 'Contraste',
        contrastText: 'Texto sobre fondo',
        contrastButton: 'Texto del botón',
        contrastFail: 'Por debajo de AA: cuesta leerlo.',
        accentLowContrast:
          'Tu color de marca tiene {ratio}:1 contra el fondo. Ningún texto lo usa, así que nada queda ilegible, pero puede costar distinguir una opción seleccionada y el botón.',
        suggestApply: 'Usar {color}',
        typographyTitle: 'Tipografía',
        typographySubtitle:
          'Las ocho tipografías se sirven desde aquí, así que el formulario no carga nada de un CDN de fuentes.',
        font: 'Tipografía',
        fontSans: 'Sans',
        fontSerif: 'Serif',
        fontCustomGroup: 'La tuya',
        customFontName: 'Nombre de la fuente',
        customFontNamePlaceholder: 'p. ej. Söhne',
        customFontUrl: 'URL del archivo (.woff2)',
        customFontHint: 'Hospeda el archivo y pega su enlace. Los dos campos son obligatorios.',
        controlsTitle: 'Forma y controles',
        controlsSubtitle: 'Esquinas, botones y cómo se muestra el progreso.',
        radius: 'Esquinas',
        radiusSharp: 'Rectas',
        radiusSoft: 'Suaves',
        radiusRound: 'Redondas',
        buttonStyle: 'Botón',
        buttonSolid: 'Sólido',
        buttonOutline: 'Contorno',
        buttonSoft: 'Suave',
        buttonFullWidth: 'Botón de ancho completo',
        progress: 'Progreso',
        progressBar: 'Barra',
        progressDots: 'Puntos',
        progressSteps: 'Contador',
        progressNone: 'Oculto',
        layoutTitle: 'Distribución',
        layoutSubtitle: 'Dónde va cada cosa y cómo se mueve el formulario entre pasos.',
        formLogo: 'URL del logo del formulario',
        formLogoHint: 'Se muestra en cada pantalla de pregunta. Vacío = sin logo.',
        logoSize: 'Tamaño del logo',
        sizeSm: 'Pequeño',
        sizeMd: 'Mediano',
        sizeLg: 'Grande',
        logoPosition: 'Posición del logo',
        alignLeft: 'Izquierda',
        alignCenter: 'Centro',
        contentAlign: 'Alineación de la pregunta',
        contentWidth: 'Ancho del contenido',
        widthNarrow: 'Angosto',
        widthWide: 'Amplio',
        transition: 'Transición entre pasos',
        transitionSlide: 'Deslizar',
        transitionFade: 'Desvanecer',
        transitionNone: 'Ninguna',
        shareTitle: 'Tarjeta al compartir',
        shareSubtitle: 'Cómo se ve el enlace cuando alguien lo comparte en chat o redes.',
        ogImage: 'URL de la imagen',
        ogImageHint: 'Tamaño ideal 1200×630.',
        ogFallback: 'Si lo dejas vacío, la tarjeta se genera con los colores y el logo de arriba.',
        reset: 'Restablecer diseño',
        colorSwatches: 'Predefinidos',
        colorCustom: 'Personalizado',
        colorHex: 'Hex',
        colorInvalid: 'Escribe un color como #1f6feb.',
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
        trackingDraftNote:
          'Estos IDs se guardan con el resto de tu borrador: haz clic en Publicar para ponerlos en el formulario público. Las integraciones de arriba se guardan en vivo de inmediato.',
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
      metricTimeToComplete: 'Tiempo para completar',
      metricPartials: 'Envíos parciales',
      metricBookings: 'Reservas',
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
      colAnswered: 'Respondida',
      colDropoff: 'Abandono',
      dropoffSubtitleAnswered: 'Cuántas personas responden cada pregunta y cuántas se detienen ahí.',
      coverRow: 'Portada / inicio',
      landingRow: 'Vistas del formulario',
      emptyRangeTitle: 'Sin actividad en este rango',
      emptyRangeBody: 'Este formulario sí tiene datos, pero no en las fechas que elegiste. Prueba un rango más amplio.',
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
      na: '',
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
      autosaved: 'Cambios guardados automáticamente',
      autosavedPartial: 'Se guardó todo menos el webhook.',
      saveError: 'No se pudieron guardar las integraciones.',
      saveOffline:
        'No se pudo contactar al servidor. Tus cambios se conservan y el guardado se reintentará automáticamente.',
      saveRetrying: 'Se perdió la conexión. Reintentando…',
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
      webhookSecretSetPlaceholder: 'Hay un secreto guardado: déjalo en blanco para conservarlo o escribe uno nuevo.',
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
      formActivity: 'Registrar la respuesta como form submission en HubSpot',
      formActivityHelp:
        'Crea un formulario espejo en tu portal, para que cada respuesta completada aparezca en el contacto como una actividad de form submission con las propiedades que escribió: y no solo como una nota. Necesita los permisos forms y form-submissions-write en tu private app.',
      formActivityError: 'HubSpot no pudo configurarlo: {reason}',
      selectProperty: 'Selecciona una propiedad…',
      noProperty: '(ninguna)',
      addMapping: 'Añadir mapeo',
      remove: 'Quitar',
      stepKey: 'Clave del paso',
      property: 'Propiedad de HubSpot',
      emptyMappings: 'Aún no hay mapeos.',
      valueMaps: 'Mapas de valores: traduce respuestas del formulario a valores del CRM',
      valueMapsHelp:
        'Convierte respuestas concretas en los valores exactos que esperan tus listas de HubSpot. Las respuestas sin traducción se envían sin cambios.',
      valueMapsExample: 'Ej.: cuando la respuesta es “Ventas”, HubSpot recibe “sales”.',
      valueMapAnswer: 'Respuesta en el form',
      valueMapCrmValue: 'Valor en HubSpot',
      addValueMap: 'Añadir traducción de valores',
      addValueMapRow: 'Añadir valor',
      emptyValueMaps: 'Aún no hay traducciones de valores.',
      scorePropertyHelp:
        'Recibe el puntaje total como número, solo en respuestas completadas.',
      datePropertyHelp:
        'Recibe la fecha de envío. Las propiedades de fecha de HubSpot guardan medianoche UTC, así que se pierde la hora. Un webhook recibe la marca de tiempo completa.',
      outcomeProperty: 'Propiedad de resultado',
      outcomePropertyHelp:
        'Recibe el ENCABEZADO que escribiste en el rango de puntaje que coincida, en Resultados. El mismo texto que ve el respondiente. Solo en respuestas completadas y solo si algún rango coincide; con el puntaje apagado no se envía nada.',
      staticProperties: 'Propiedades estáticas',
      staticPropertiesHelp:
        'Valores fijos que se estampan en cada respuesta completada (p. ej. una marca de opt-in). Nunca sobrescriben una respuesta mapeada.',
      staticValue: 'Valor',
      addStaticProperty: 'Añadir propiedad',
      emptyStaticProperties: 'Aún no hay propiedades estáticas.',
      inferCompany: 'Inferir la empresa desde el email',
      inferCompanyHelp:
        'Cuando la persona usa un email de trabajo, rellena las propiedades de empresa y sitio web a partir de su dominio. Los dominios gratuitos (gmail, outlook…) se omiten y los valores mapeados nunca se sobrescriben.',
      bookingSync: 'Sincronización de reservas',
      bookingSyncHelp:
        'Cuando la persona agenda una reunión desde un paso de calendario, estampa estas propiedades del contacto con los datos de la reserva. Deja un campo en blanco para omitirlo.',
      bookingStageProperty: 'Propiedad de etapa',
      bookingStagePropertyHelp:
        'Opcional: escribe este valor fijo en la propiedad elegida cada vez que alguien agenda (ej. Lead Status → Demo agendada).',
      bookingStageValue: 'Valor de etapa',
      bookingDateProperty: 'Propiedad de fecha de reserva',
      bookingDatePropertyHelp:
        'Día calendario en que el lead agendó (no el día de la reunión).',
      bookingHoursProperty: 'Propiedad de hora de la reunión',
      bookingHoursPropertyHelp:
        'Fecha y hora de inicio de la reunión, según el calendario.',
      bookingDateTimezone: 'Zona horaria del día',
      bookingDateTimezoneHelp:
        'Zona horaria IANA para calcular el día de agendado (ej. America/Bogota). Vacío = UTC.',
      bookingDateTimezonePlaceholder: 'America/Bogota',
      bookingDateTimezoneInvalid:
        'No reconocemos ese nombre de zona horaria. El día se calculará en UTC.',
      extraHubspotTitle: 'Este formulario tiene una segunda conexión con HubSpot',
      extraHubspotBody:
        'Esta pantalla solo edita la primera, así que la otra es invisible acá: y cualquier cambio en esta pestaña se guarda al instante y la elimina, junto con las asignaciones que tenga. Para mandar una respuesta a varias propiedades, agrega las propiedades a la misma pregunta de arriba.',
      carriedWebhooksTitle: 'Este formulario tiene {count} webhook(s) más',
      carriedWebhooksBody:
        'Esta tarjeta edita el primero. Los demás siguen funcionando igual y se guardan sin tocarlos: solo que no se editan desde acá. Los ves todos en Integraciones.',
      connectPromptTitle: 'Conecta HubSpot para asignar este formulario',
      connectPromptBody:
        'HubSpot aún no está conectado en tu cuenta. Conéctalo una vez y luego vuelve para asignar cada pregunta a una propiedad de contacto.',
      connectPromptCta: 'Ir a Conexiones',
      emailRequiredTitle: 'Este formulario no tiene correo que sincronizar',
      emailRequiredBody:
        'HubSpot identifica al contacto por su correo: actualiza el que encuentra, o crea uno nuevo. Un envío sin correo llega sin nada con qué identificarlo, así que no se crea ningún contacto y ese lead no se sincroniza. Agrega una pregunta de correo, o un agendador: Calendly pide el correo de quien reserva.',
      emailRequiredCta: 'Agregar una pregunta de correo',
      emailFromScheduler:
        'Los contactos se identificarán con el correo que Calendly pide al reservar. Las respuestas llegan a HubSpot solo cuando alguien agenda.',
      hubspotHowTitle: 'Cómo funciona la sincronización',
      hubspotHowBody:
        'Cada envío se busca en HubSpot por correo: si el contacto existe se actualiza, y si no, se crea uno nuevo. Un formulario que nunca pide correo no se puede sincronizar.',
      hubspotHowBodyScheduler:
        'Cada envío se busca en HubSpot por correo: si el contacto existe se actualiza, y si no, se crea uno nuevo. Este formulario no lo pide: lo recoge la agenda, así que acá no hay que mapear nada a «email».',
      schedulerDisconnected:
        'Calendly no está conectado en esta cuenta, así que no se puede leer el correo del invitado y no va a llegar nada a HubSpot. La reserva igual funciona, por eso falla en silencio. Conectá Calendly en Conexiones.',
      mapQuestionsHelpScheduler:
        'Mandá cada respuesta a una propiedad de contacto de HubSpot. No mapees nada a «email»: lo aporta la agenda, y un mapeo acá lo reemplaza y apaga la sincronización.',
      emailMappingConflictTitle: 'Este mapeo apaga la sincronización',
      emailMappingConflictBody:
        'La agenda ya aporta el correo. Una pregunta mapeada a «email» pasa a ser la llave del contacto, así que las respuestas dejan de llegar a HubSpot después de agendar. Quitá el mapeo en: {keys}.',
      pingWebhook: 'Enviar prueba',
      pingSending: 'Enviando…',
      pingOk: 'Prueba entregada: tu endpoint la aceptó.',
      pingFailed: 'La prueba falló: {reason}',
      pingNeedsUrl: 'Primero guarda una URL de webhook.',
      pingHelp:
        'Manda un cuerpo de ejemplo con la forma real, firmado igual, para que veas qué recibe tu endpoint. Las respuestas son inventadas y van marcadas como prueba.',
      pingStatus: 'Tu endpoint respondió HTTP {status}.',
      pingWeSend: 'Dapta Forms siempre entrega con POST y un cuerpo JSON.',
      pingEndpointSaid: 'Respondió: {detail}',
      pingMethodNotAllowed: 'No acepta POST en esa URL.',
      pingUnsupportedMedia: 'Rechazó el tipo de contenido.',
      pingRejectedBody: 'Leyó la petición y rechazó el cuerpo.',
      pingUnauthorized: 'Rechazó la petición por falta de autorización: revisa el token o secreto que espera.',
      pingNotFound: 'No hay nada en esa URL.',
      pingRateLimited: 'Nos está limitando por frecuencia; probá de nuevo en un momento.',
      pingServerError: 'Falló de su lado.',
      pingRedirect: 'Respondió con una redirección, y nunca las seguimos. Usá la URL final directamente.',
      pingBlocked:
        'Bloqueado antes de enviar: esa dirección es privada, reservada o interna, y nunca publicamos hacia ahí.',
      pingUnreachable: 'Nadie respondió en esa URL: revisá que el host esté accesible y no expire.',
      pingUnknown: 'La entrega falló por un motivo que no pudimos identificar.',
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
        'Envía los metadatos capturados (UTMs, puntuación, resultado y fecha de envío) a propiedades de HubSpot.',
      customMappings: 'Asignaciones personalizadas',
      customMappingsHelp:
        'Envía un dato adicional del form a una propiedad de HubSpot: útil para campos ocultos o UTMs.',
      keyGroupQuestions: 'Preguntas del formulario',
      keyGroupSystem: 'Campos del sistema',
      keyCustomOption: 'Clave personalizada…',
      inviteeName: 'Agenda: nombre completo',
      inviteeFirstName: 'Agenda: nombre',
      inviteeLastName: 'Agenda: apellido',
      inviteePhone: 'Agenda: teléfono',
      bookingStart: 'Agenda: hora de la reunión',
      keyCustomBack: 'Volver a la lista',
      selectKeyPlaceholder: 'Selecciona un campo…',
      selectValue: 'Selecciona un valor…',
      valueCustomOption: 'Valor personalizado…',
      valueCustomBack: 'Volver a la lista',
      valueMapTargets: 'Los valores se escriben en: {properties}',
      valueMapNoTarget: 'Asigna esta pregunta a una propiedad arriba para elegir entre sus valores.',
      valueMapRowCount: '{n} valor(es)',
      expandGroup: 'Desplegar',
      collapseGroup: 'Plegar',
      webhookEvents: 'Disparar en',
      webhookEventsHelp: 'Elige qué respuestas se envían a este webhook. Por defecto se envían ambas.',
      eventPartial: 'Respuestas parciales',
      eventComplete: 'Respuestas completas',
      historyWebhookTitle: 'Historial del webhook',
      historyHubspotTitle: 'Historial de HubSpot',
      historyEmailTitle: 'Historial de correos',
      historyHelp:
        'Las últimas entregas que hizo este formulario, de la más reciente a la más antigua. Abrí una para ver qué se envió.',
      historyPingNote:
        'Las entregas de prueba también aparecen, marcadas como tales: llegan de verdad a tu endpoint, pero llevan respuestas de ejemplo en lugar de las de una persona.',
      historyTestBadge: 'Prueba',
      historyRequest: 'Lo que enviamos',
      historyResponse: 'Lo que respondió',
      historyBodyNotRecorded: 'No se registró para esta entrega.',
      historyBodyEmpty: 'Tu endpoint respondió sin cuerpo.',
      historyEmpty: 'Todavía no se ha entregado nada.',
      historyLoadError: 'No se pudo cargar el historial de entregas.',
      historyRefresh: 'Actualizar',
      historyOpen: 'Ver historial',
      historyClose: 'Cerrar',
      historyCount: '{n} entregas',
      historyFailedCount: '{n} con error',
      historyDelivered: 'Entregada',
      historyRetrying: 'En curso',
      historyFailed: 'Falló',
      historySkipped: 'Omitida',
      historyAttempts: '{n} intentos',
      historyNoReason: 'No se registró un motivo.',
      gsheetsTitle: 'Google Sheets',
      gsheetsDesc: 'Añade cada respuesta como una fila nueva en una hoja de cálculo.',
      comingSoon: 'Muy pronto',
    },
    connections: {
      title: 'Conexiones',
      subtitle:
        'Conecta tu cuenta a HubSpot y Calendly una vez. Luego asigna los campos de cada formulario desde su pestaña de integraciones.',
      hubspotName: 'HubSpot',
      hubspotDesc: 'Sincroniza respuestas con contactos de HubSpot y asigna preguntas a propiedades de contacto.',
      calendlyName: 'Calendly',
      calendlyDesc: 'Permite reservar reuniones desde los resultados de tu formulario.',
      gsheetsName: 'Google Sheets',
      gsheetsDesc: 'Añade cada respuesta como una fila nueva en una hoja de cálculo.',
      comingSoon: 'Muy pronto',
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
      serverProvided: 'La da el servidor',
      serverProvidedTitle: 'Ya funciona, con el token del servidor',
      serverProvidedBody:
        'Este despliegue trae un token para {provider}, así que todas las cuentas de aquí ya pueden sincronizar. Si conectas el tuyo, lo reemplaza solo para esta cuenta.',
      webhooks: {
        title: 'Webhooks',
        subtitle:
          'Todos los formularios que envían sus respuestas (POST) a un endpoint que tú controlas. Añade o cambia uno desde la pestaña Conectar de ese formulario.',
        colForm: 'Formulario',
        colEndpoint: 'Endpoint',
        colEvents: 'Eventos',
        colStatus: 'Estado',
        colHealth: 'Entrega',
        on: 'Activo',
        off: 'Inactivo',
        eventsBoth: 'Parciales y completas',
        eventsPartial: 'Respuestas parciales',
        eventsComplete: 'Respuestas completas',
        signed: 'Firmado con un secreto',
        edit: 'Editar',
        // Sin concordancia de número a propósito: `t()` no pluraliza, y "1
        // fallidas" es peor que una frase que sirve para cualquier cifra.
        failedCount: '{n} sin entregar',
        lastFailure: 'Último fallo: {date}',
        failuresScopeNote:
          'Los fallos se cuentan por formulario, así que un formulario con dos webhooks muestra el mismo número en ambos.',
        emptyTitle: 'Aún no hay webhooks',
        emptyBody:
          'Abre la pestaña Conectar de cualquier formulario y añade una URL de webhook para enviar cada respuesta a tu propio endpoint.',
        emptyCta: 'Ir a formularios',
        loadError: 'No se pudieron cargar tus webhooks.',
      },
    },
    publish: {
      publish: 'Publicar',
      publishing: 'Publicando…',
      published: 'Cambios publicados: tu formulario está en línea.',
      publishError: 'No se pudo publicar. Inténtalo de nuevo.',
      unpublishedChanges: 'Cambios sin publicar',
      noChanges: 'Todos los cambios están publicados',
    },
    onboarding: {
      stages: { account: 'Tu cuenta', profile: 'Conocerte', firstForm: 'Tu primer formulario' },
      next: 'Continuar',
      back: 'Atrás',
      creating: 'Creando tu formulario…',
      creatingSubtitle: 'Preparando tus preguntas. Solo toma un segundo.',
      error: {
        headline: 'No pudimos crear tu formulario',
        body: 'Tus respuestas están guardadas. Inténtalo de nuevo: casi siempre es la conexión.',
        retry: 'Reintentar',
      },
      progress: 'Pregunta {current} de {total}',
      role: {
        question: '¿Cuál es tu rol?',
        helper: 'Elige el más cercano. Cambia lo que te mostramos primero.',
        options: {
          sales: 'Ventas',
          marketing: 'Marketing',
          support: 'Atención al cliente o soporte',
          product: 'Producto, diseño o research',
          founder: 'Fundador o CEO',
          engineering: 'Tecnología o desarrollo',
          hr: 'Recursos humanos',
          operations: 'Operaciones',
          other: 'Otro',
        },
      },
      industry: {
        question: '¿En qué industria estás?',
        helper: 'Empieza a escribir para encontrar la tuya.',
        placeholder: 'Buscar industrias',
        search: 'Buscar',
        empty: 'No hay coincidencias. Elige Otra.',
        options: {
          accounting: 'Contabilidad',
          airlines_aviation: 'Aerolíneas y aviación',
          alternative_dispute_resolution: 'Resolución alternativa de conflictos',
          alternative_medicine: 'Medicina alternativa',
          animation: 'Animación',
          apparel_fashion: 'Ropa y moda',
          architecture_planning: 'Arquitectura y urbanismo',
          arts_crafts: 'Arte y artesanía',
          automotive: 'Automotriz',
          aviation_aerospace: 'Aviación y aeroespacial',
          banking: 'Banca',
          biotechnology: 'Biotecnología',
          broadcast_media: 'Medios de comunicación',
          building_materials: 'Materiales de construcción',
          business_supplies: 'Suministros y equipos de oficina',
          capital_markets: 'Mercados de capitales',
          chemicals: 'Química',
          civic_social: 'Organizaciones cívicas y sociales',
          civil_engineering: 'Ingeniería civil',
          commercial_real_estate: 'Inmobiliaria comercial',
          computer_security: 'Seguridad informática y de redes',
          computer_games: 'Videojuegos',
          computer_hardware: 'Hardware',
          computer_networking: 'Redes informáticas',
          computer_software: 'Software',
          construction: 'Construcción',
          consumer_electronics: 'Electrónica de consumo',
          consumer_goods: 'Bienes de consumo',
          consumer_services: 'Servicios al consumidor',
          education_management: 'Gestión educativa',
          financial_services: 'Servicios financieros',
          health_wellness: 'Salud, bienestar y fitness',
          hospital_healthcare: 'Hospitales y salud',
          hospitality: 'Hotelería',
          it_services: 'Tecnología y servicios de TI',
          insurance: 'Seguros',
          internet: 'Internet',
          law_practice: 'Despachos de abogados',
          legal_services: 'Servicios legales',
          marketing_advertising: 'Marketing y publicidad',
          medical_practice: 'Consultorios médicos',
          nonprofit: 'Organizaciones sin fines de lucro',
          real_estate: 'Inmobiliaria',
          restaurants: 'Restaurantes',
          retail: 'Comercio minorista',
          telecommunications: 'Telecomunicaciones',
          other: 'Otra industria',
          events_services: 'Servicios para eventos',
          higher_education: 'Educación superior',
          human_resources: 'Recursos humanos',
          information_services: 'Servicios de información',
          professional_training_coaching: 'Formación profesional y coaching',
        },
      },
      crm: {
        question: '¿Qué CRM usas?',
        helper: 'Podemos enviar tus respuestas directo ahí.',
        options: {
          none: 'Ninguno',
          hubspot: 'HubSpot',
          odoo: 'Odoo',
          clientify: 'Clientify',
          ghl: 'GoHighLevel',
          bitrix24: 'Bitrix24',
          salesforce: 'Salesforce',
          activecampaign: 'ActiveCampaign',
          pipedrive: 'Pipedrive',
          zoho_crm: 'Zoho CRM',
          escala: 'Escala',
          other: 'Otro',
        },
      },
      phone: {
        question: 'Cuéntanos sobre ti',
        helper: 'Para que podamos adaptar tu experiencia.',
        label: 'Tu número de teléfono',
        placeholder: '000 000 0000',
        invalid: 'Ese número no parece válido. Verifícalo e inténtalo de nuevo.',
      },
      leadVolume: {
        question: '¿Cuántos leads recibes al mes?',
        helper: 'Un número aproximado está bien.',
        unit: 'leads / mes',
      },
      leadSource: {
        question: '¿De dónde vienen tus leads?',
        helper: 'Elige el principal.',
        options: {
          none: 'Todavía no tengo leads',
          facebook_ads: 'Anuncios de Facebook',
          google_ads: 'Anuncios de Google',
          outbound: 'Outbound',
          internal_lists: 'Listas internas',
          other: 'De otro lado',
        },
      },
      useCase: {
        question: '¿Para qué quieres usar Forms?',
        helper: 'Dejamos tu primer formulario listo para eso.',
        options: {
          leads: 'Captar clientes o leads',
          feedback: 'Recibir feedback',
          event: 'Registrar gente a un evento',
          application: 'Recibir postulaciones o solicitudes',
          other: 'Otra cosa',
        },
      },
      templates: {
        question: 'Aquí está tu primer formulario',
        helper: 'Empieza con uno de estos. Cada pregunta es tuya para cambiarla.',
        recommended: 'Recomendado para ti',
        cta: 'Crear mi formulario',
        options: {
          'lead-qualifier': {
            name: 'Calificador de leads',
            description: 'Puntúa cada respuesta y separa los resultados en calientes y tibios.',
            formName: 'Calificador de leads',
          },
          'customer-feedback': {
            name: 'Opiniones de clientes',
            description: 'Una encuesta corta de satisfacción con una pregunta NPS.',
            formName: 'Opiniones de clientes',
          },
          'event-registration': {
            name: 'Registro a evento',
            description: 'Recoge quién viene, cómo y qué necesita.',
            formName: 'Registro a evento',
          },
          application: {
            name: 'Postulaciones y solicitudes',
            description: 'Sirve igual para vacantes que para pedidos de trabajo.',
            formName: 'Postulaciones y solicitudes',
          },
          blank: {
            name: 'Empezar desde cero',
            description: 'Un formulario vacío. Tú escribes cada pregunta.',
            formName: 'Formulario sin título',
          },
        },
      },
      tour: {
        next: 'Siguiente',
        done: 'Entendido',
        dismiss: 'Cerrar',
        step: '{current} de {total}',
        edit: {
          title: 'Edita cualquier pregunta',
          body: 'Haz clic en una pregunta para cambiar su texto, sus opciones o lo que pide.',
        },
        preview: {
          title: 'Mira lo que ellos ven',
          body: 'La vista previa abre el formulario tal como lo encontrará quien lo responda.',
        },
        publish: {
          title: 'Publica cuando estés listo',
          body: 'Nada está en línea hasta que publiques. Ahí obtienes el enlace para compartir.',
        },
      },
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
