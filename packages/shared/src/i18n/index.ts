/**
 * i18n message catalog (EN/ES). Deliberately minimal for the skeleton: only the
 * message groups the current surfaces use (login + growth badge). Phase 1 grows
 * this catalog alongside the real admin/editor/renderer UI — same mechanism as
 * before: typed catalog, `getMessages(locale)`, `{var}` interpolation via `t()`.
 */

import type {
  ApiArea,
  ApiErrorCode,
  ApiIssueCode,
  ApiNotAllowed,
  ApiParamDoc,
  ApiParamIn,
  ApiRoute,
} from '../api-reference';

export type Locale = 'en' | 'es';

export interface FormsMessages {
  /** The growth badge + SEO copy on public form pages. */
  growth: {
    madeWith: string;
    ctaQuestion: string;
    ctaAction: string;
    /** The button under the notification emails' card; `ctaQuestion` sits above it. */
    emailCtaAction: string;
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
    /** The public error boundary and the 404, in the visitor's language. */
    errorTitle: string;
    errorBody: string;
    errorRetry: string;
    notFoundTitle: string;
    notFoundBody: string;
    notFoundHome: string;
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
      url: string;
      phone: string;
      number: string;
      too_low: string;
      too_high: string;
      /** Long text under its configured `minChars`. */
      too_short: string;
      /** Long text over its configured `maxChars`. */
      too_long: string;
      option: string;
      file: string;
      submit: string;
      /**
       * The final submit's human check did not pass (spam protection), or the
       * form started checking after this page loaded. Keyed by the API's
       * `CAPTCHA_FAILED` / `CAPTCHA_REQUIRED` codes, never by its message.
       */
      captcha: string;
      /**
       * The API's `CAPTCHA_REQUIRED` reaching a page loaded before the owner
       * turned protection on: it has no check to run, so only a reload helps.
       */
      captcha_required: string;
      /** The API's `RATE_LIMITED`: too many requests from this connection. */
      rate_limited: string;
      /** The API's `ANSWER_TOO_LONG`: an answer over its question's ceiling. */
      answer_too_long: string;
      /**
       * The API's `INVALID_ANSWERS`: a complete whose answers the form could not
       * have produced (a missing required answer, an option that no longer
       * exists). In practice a page loaded before the owner changed the form.
       */
      invalid_answers: string;
    };
    /**
     * Spam protection on the submitting screen: the human check that runs before
     * the final submit of a form whose owner turned it on.
     */
    captcha: {
      /** Shown above the check when it needs the person to act (a checkbox). */
      prompt: string;
      /** The check could not run or be verified; the answers were kept as a partial. */
      unavailable: string;
      /** Runs the check and the submit again. */
      retry: string;
    };
    /**
     * The live character counter on a long-text question. Rendered ONLY when
     * the step configures a minimum or a maximum, so a question with no limits
     * shows nothing at all.
     */
    charCounter: {
      /** No maximum configured, so only the running count. `{count}`. */
      characters: string;
      /** Trailing hint, shown until the floor is met. `{min}` is the floor. */
      minimum: string;
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
    /** The `file` step's upload control. */
    upload: {
      /** The idle drop zone's own call to action. */
      choose: string;
      /** Sub-line under it: what is accepted and how big. `{types}` and `{max}`. */
      accepts: string;
      /** Progress label while the bytes are moving. `{percent}`. */
      uploading: string;
      /** Removes the uploaded file and returns the control to idle. */
      remove: string;
      /** The upload did not finish. Offers another try. */
      failed: string;
      retry: string;
      /** Refused before anything was sent. `{max}` is the limit in MB. */
      tooLarge: string;
      wrongType: string;
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
  /** The workspace link page (`/[accountCode]`). */
  linkPage: {
    /** Accessible name of the button list and of the icon row. */
    buttonsLabel: string;
    socialsLabel: string;
    /** Accessible name of each network's icon. */
    social: { instagram: string; x: string; youtube: string; tiktok: string; whatsapp: string };
    /** Meta description when the page has no bio. `{name}` is the page name. */
    seoDescription: string;
  };
  admin: {
    /** Account settings, Public page: the workspace link page editor. */
    linkPage: {
      heading: string;
      subtitle: string;
      anyMember: string;
      enable: string;
      offNote: string;
      copy: string;
      copied: string;
      open: string;
      qr: string;
      qrTitle: string;
      qrIntro: string;
      qrAlt: string;
      qrDownloadPng: string;
      qrDownloadSvg: string;
      qrPngFailed: string;
      headerSection: string;
      logo: string;
      logoHint: string;
      logoUpload: string;
      logoUseKit: string;
      logoNone: string;
      logoFromKit: string;
      logoNoKit: string;
      logoInitials: string;
      logoUrl: string;
      logoUrlPlaceholder: string;
      logoInvalid: string;
      logoTooBig: string;
      name: string;
      bio: string;
      bioPlaceholder: string;
      buttonsSection: string;
      buttonsHint: string;
      addForm: string;
      addFormPlaceholder: string;
      addLink: string;
      noForms: string;
      allFormsAdded: string;
      empty: string;
      formTag: string;
      linkTag: string;
      linkLabel: string;
      linkLabelPlaceholder: string;
      linkUrl: string;
      linkUrlPlaceholder: string;
      linkInvalid: string;
      moveUp: string;
      moveDown: string;
      remove: string;
      maxItems: string;
      socialsSection: string;
      socialsHint: string;
      socialPlaceholders: { instagram: string; x: string; youtube: string; tiktok: string; whatsapp: string };
      socialInvalid: string;
      whatsappInvalid: string;
      whatsappHint: string;
      preview: string;
      save: string;
      saving: string;
      saved: string;
      error: string;
      fixErrors: string;
      /** Several pages per workspace: which page this editor is on. */
      back: string;
      pageSection: string;
      pageName: string;
      pageNameHint: string;
      pageNamePlaceholder: string;
      slug: string;
      /** // {base} is the address up to `/p/`. */
      slugHint: string;
      slugInvalid: string;
      slugReserved: string;
      slugTaken: string;
      defaultBadge: string;
      /** // {url} */
      defaultHint: string;
      makeDefault: string;
      madeDefault: string;
      /** Why "Make main page" is off on an unpublished page. */
      makeDefaultNeedsPublish: string;
      colorsSection: string;
      colorsHint: string;
      colorPrimary: string;
      colorBackground: string;
      colorForeground: string;
      colorFromKit: string;
      colorReset: string;
    };
    /** Account settings, Public page: the list of the workspace's link pages. */
    linkPages: {
      heading: string;
      subtitle: string;
      anyMember: string;
      newPage: string;
      /** // {n} {max} */
      count: string;
      /** // {max} */
      limitReached: string;
      emptyTitle: string;
      emptyBody: string;
      defaultName: string;
      defaultBadge: string;
      live: string;
      off: string;
      /** Accessible name of a row's publish switch. // {name} */
      toggleLabel: string;
      /** // {n} */
      buttons: string;
      /** The same, for exactly one button. */
      buttonsOne: string;
      /** // {date} */
      edited: string;
      edit: string;
      duplicate: string;
      duplicated: string;
      /** The copy's name. // {name} */
      copyName: string;
      copyLink: string;
      copied: string;
      qr: string;
      makeDefault: string;
      madeDefault: string;
      /** Why "Make main page" is off on an unpublished page. */
      makeDefaultNeedsPublish: string;
      remove: string;
      removeTitle: string;
      /** // {name} */
      removeBody: string;
      removeConfirm: string;
      removed: string;
      cannotRemoveDefault: string;
      published: string;
      unpublished: string;
      createTitle: string;
      createName: string;
      createNamePlaceholder: string;
      createSlug: string;
      create: string;
      creating: string;
      cancel: string;
      error: string;
    };
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
      /** Toast when the first admin's browser seeds the workspace zone. // {zone} */
      timezoneAutoSet: string;
      /** The colour-scheme toggle. `next` names what one more click will do, so an
       *  icon-only control still announces its effect rather than only its state. */
      theme: {
        label: string;
        dark: string;
        light: string;
        next: string;
      };
      /**
       * Where the "Docs" nav item goes: the Forms documentation in THIS
       * language. Lives in the catalog because the shell only receives the
       * localized messages, never the locale itself. Always an absolute URL.
       */
      docsHref: string;
      /** Left-nav item labels (icon + label). */
      nav: {
        home: string;
        forms: string;
        submissions: string;
        analytics: string;
        integrations: string;
        /**
         * "Connect your agent" (/admin/developers/connect), between
         * Integrations and Docs, set apart with the AI apps' logos. The key
         * keeps its old name; the addresses do too, because skill zips already
         * handed out links there.
         */
        developers: string;
        /** The Tools page (/admin/developers/tools): what an agent can do with dForms. */
        tools: string;
        /** The product documentation, an EXTERNAL link (see `docsHref`). */
        docs: string;
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
        searchClear: string;
        /** Marks a workspace the person is in by access grant (deployment staff), or an estate row. */
        staff: string;
        /** Eyebrow over estate rows the person never opened here (staff only). */
        estate: string;
        /** Staff search: why a row matched when its name did not. `{name}` is the form. */
        hintForm: string;
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
      /** Heading of the list of forms, most recently touched first. */
      recent: string;
      viewAll: string;
      /** Heading of the quick links beside it. */
      shortcuts: string;
      noSubmissions: string;
      /** The caption under the completion figure: what the rate is a share OF. */
      statCompletionNote: string;
      publicPageDesc: string;
      /** "Updated {when}" without the verb, for a narrow column. */
      colUpdated: string;
      /** The banner at the top of the home: control dForms from an AI agent. */
      agentBanner: {
        title: string;
        body: string;
        cta: string;
      };
      /**
       * The big "Connect your agent" card: a prompt typed into an AI app and
       * the form it creates, cycling through `prompts` and the apps.
       */
      agentCard: {
        eyebrow: string;
        title: string;
        body: string;
        cta: string;
        /** Accessible name of the animation. */
        label: string;
        /** What the user asks, one per turn. Written for a person, not a parser. */
        prompts: string[];
        /** The app's answer once the form exists. */
        done: string;
        /** The composer's placeholder before the prompt starts. // {app} */
        placeholder: string;
        connected: string;
      };
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
      /** The same, short enough to sit inside a colour swatch or beside a toggle. */
      notSetShort: string;
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
      /** The shared IANA zone every date in this workspace is read in. */
      workspaceTimezone: string;
      workspaceTimezoneHelp: string;
      workspaceTimezoneSaved: string;
      workspaceTimezoneError: string;
      workspaceTimezoneUnset: string;
      workspaceTimezoneUtc: string;
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
      /** Staff opening a workspace where their own membership is disabled or pending: never replaced by staff access. */
      manageErrorMembershipNotActive: string;
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
        /**
         * Personal preferences. The one account entry that is per-PERSON rather
         * than per-workspace, which is why it sits last: the four before it
         * describe the workspace everyone in it shares.
         */
        preferences: string;
      };
      /** Personal preferences (currently: the language this person reads the app in). */
      preferences: {
        title: string;
        subtitle: string;
        languageLabel: string;
        /** Says what the choice does and does not reach. */
        languageHelp: string;
        /** The write failed, so the app is still in the previous language. */
        languageError: string;
      };
      /** The workspace list (cards). */
      workspaces: {
        title: string;
        subtitle: string;
        search: string;
        searchEmpty: string;
        searchClear: string;
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
        /** The id the Dapta estate knows the workspace by, with a copy control. */
        idLabel: string;
        copyId: string;
        copied: string;
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
      /** The button that opens the preview as an inbox mock. */
      previewExpand: string;
      /** The inbox mock: a window around the email, as it lands for a person. */
      previewMock: {
        title: string;
        inbox: string;
        toMe: string;
        justNow: string;
        reply: string;
        forward: string;
        close: string;
        note: string;
      };
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
      tokenRespondentName: string;
      tokenRespondentEmail: string;
      tokenScore: string;
      tokenOutcomeLabel: string;
      tokenFormLink: string;
      tokenAnswers: string;
      /** Permanent warning when the owner notice body lacks `{{answers}}`. */
      answersMissing: string;
      /** Muted pointer: forms can override these from their Connect tab. */
      formOverrideNote: string;
      /** The owner notice's recipient list (owner notice only). */
      recipientsLabel: string;
      recipientsHint: string;
      /** Shown with no addresses listed: the notice falls back to the owner. */
      recipientsEmpty: string;
      recipientsAdd: string;
      /** Accessible name of the per-row remove button. */
      recipientsRemove: string;
      recipientsPlaceholder: string;
      /** Per-row validation, so the editor can point at WHICH address is wrong. */
      recipientsInvalid: string;
      /** Per-form card: this form has no list of its own and follows the account. */
      recipientsFollowingAccount: string;
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
      /** Search box over the loaded list (name or slug, no case, no accents). */
      searchPlaceholder: string;
      searchLabel: string;
      searchClear: string;
      searchEmpty: string;
      /** "{count} results" live announcement. */
      searchResults: string;
      /** The keyboard hint shown inside the search box. */
      searchShortcut: string;
      /** Folders: sections of the list. */
      unfiled: string;
      folderCount: string; // {count}
      folderCountOne: string;
      newFolder: string;
      newFolderTitle: string;
      folderCreate: string;
      renameFolder: string;
      renameFolderTitle: string;
      folderSave: string;
      folderNameLabel: string;
      folderNamePlaceholder: string;
      folderNameRequired: string;
      folderNameTaken: string;
      deleteFolder: string;
      deleteFolderConfirm: string; // {name} {forms} (the already-pluralised count label)
      folderMenu: string;
      collapse: string;
      expand: string;
      /** "New form" on a folder header, creating straight into it. */
      createIn: string;
      folderLabel: string;
      folderNone: string;
      moveTo: string;
      moveBack: string;
      moveFailed: string;
      dragHandle: string;
      dropHere: string;
      actionFailed: string;
      /** The list as a table: its column headings. */
      colForm: string;
      colStatus: string;
      colSubmissions: string;
      colCompletion: string;
      colUpdated: string;
      /** Publish state of a row. A form is live from creation, so there are two. */
      statusLive: string;
      statusLiveHint: string;
      statusUnpublished: string;
      statusUnpublishedHint: string;
      /** Completion cell when nobody has started the form yet (no rate to compute). */
      noCompletion: string;
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
        file: string;
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
        /** File step: the extensions this question accepts. */
        fileAllowedTypes: string;
        fileAllowedTypesHint: string;
        /** File step: preset groups the owner picks from instead of typing extensions. */
        filePresetDocuments: string;
        filePresetImages: string;
        filePresetSheets: string;
        filePresetArchives: string;
        /** File step: the owner's own size limit, capped by the deployment. */
        fileMaxSize: string;
        fileMaxSizeHint: string;
        fileNoTypes: string;
        phoneMinDigits: string;
        /** Phone step: label for the per-form default-country picker (V4-14). */
        phoneDefaultCountry: string;
        /** The "auto (locale-based)" option in the default-country picker. */
        phoneDefaultCountryAuto: string;
        /** Explains what the minimum-digit floor is for (V5-B5). */
        phoneMinDigitsHelp: string;
        /** Long text: the shortest answer accepted, in characters (GF-32). */
        minChars: string;
        /** Long text: the longest answer accepted, in characters (GF-32). */
        maxChars: string;
        /** Section header over the long-text length pair. */
        charLimits: string;
        /** What the pair does, and that leaving one empty removes that end. */
        charLimitsHelp: string;
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
        /** Discloses the stored values, which fill themselves from the labels. */
        advanced: string;
        /** The typed value is already another option's on this question. */
        valueTaken: string;
        /** Why values already in use stay put while their labels change. */
        valueLocked: string;
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
        /** Under the picker on One page, when the form has screens (#200): they are kept, not applied. */
        screensIgnored: string;
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
        /** Form language (Auto / English / Spanish) and the button copy overrides. */
        languageTitle: string;
        languageHint: string;
        languageAuto: string;
        languageEn: string;
        languageEs: string;
        labelsTitle: string;
        labelsHint: string;
        labelBack: string;
        labelNext: string;
        labelSubmit: string;
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
        badgeSize: string;
        badgeSizeHint: string;
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
        /**
         * Spam protection: the per-form human check before the final submit, at
         * the top of the tab. Staged with the draft like Tracking.
         */
        spamTitle: string;
        spamToggle: string;
        spamHelp: string;
        spamPartialNote: string;
        /** Why the switch is disabled: this deployment has no challenge keys. */
        spamUnavailable: string;
        /** The switch is saved on, but this deployment cannot run the check. */
        spamInactiveHere: string;
        spamDraftNote: string;
        /** Accessible name of the Automatic / Strict choice. */
        spamModeGroup: string;
        spamModeAuto: string;
        spamModeStrict: string;
        spamModeStrictHelp: string;
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
      /** Under the trends chart: which zone the days are cut in. // {zone} */
      timezoneNote: string;
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
      /** The shared workspace zone, editable from the table by admins. */
      timezoneLabel: string;
      timezoneHint: string;
      timezoneReadOnly: string;
      badgeCompleted: string;
      badgePartial: string;
      colSubmitted: string;
      colStatus: string;
      colScore: string;
      /** CSV-only headers (the table shows the date under `colSubmitted` and the name joined). */
      colSubmittedAt: string;
      colSubmissionId: string;
      /** CSV-only: the page the response was given on (#199). */
      colPageUrl: string;
      colFirstName: string;
      colLastName: string;
      export: string;
      delete: string;
      deleteConfirm: string;
      /** File answer: the control on the cell, and the dialog behind it. */
      download: string;
      downloadFailed: string;
      /** Between the click and the first pixel of the file. */
      previewLoading: string;
      previewFailed: string;
      previewReload: string;
      /** A type with no viewer. Reachable only if one is ever added. */
      previewUnavailable: string;
      /** Word: the conversion is readable, not the document. Say so. */
      previewApprox: string;
      previewClose: string;
      emptyTitle: string;
      emptyBody: string;
      prev: string;
      next: string;
      /** "{from}–{to} of {total}" */
      showing: string;
      na: string;
      error: string;
      retry: string;
      /** The Summary tab: the form's responses read question by question. */
      summary: {
        tabSummary: string;
        tabResponses: string;
        /** The Summary | Responses switch, for screen readers. */
        tabsLabel: string;
        /** Under a multi-select's bars: why they can add past 100%. */
        multiNote: string;
        average: string;
        /** A range bar of a slider's distribution: "{from}–{to}". */
        range: string;
        filesUploaded: string;
        meetingsBooked: string;
        noAnswers: string;
        latest: string;
        searchLabel: string;
        searchPlaceholder: string;
        searchClear: string;
        /** "Matches: {n}" */
        matches: string;
        /** "{query}" is what was typed. */
        noMatches: string;
        showMore: string;
        /** Who answered, when the form asked no name, email or phone. */
        anonymous: string;
        openAnswer: string;
        openFailed: string;
        searchFailed: string;
      };
      /** The side panel that shows one response in full. */
      viewResponse: string;
      /** The panel title when the form asked for no name, email or phone. */
      responseTitle: string;
      prevResponse: string;
      nextResponse: string;
      closeResponse: string;
      /** "{n} of {total}": where the open response sits in the current page. */
      responsePosition: string;
      answersTitle: string;
      detailsTitle: string;
      /** A step the respondent never reached (a partial response). */
      noAnswer: string;
      colStarted: string;
      responseId: string;
      /** The page the response was given on: the landing that embeds the form, or the form's own link. */
      pageRow: string;
      /**
       * Beside the page: the visitor's HubSpot tracking cookie arrived with the
       * response. Received, not accepted: it does not say HubSpot took the visit.
       */
      hubspotCookie: string;
      utmTitle: string;
      /** "{n} of {total} answered": how much of the form this response covers. */
      answeredCount: string;
      /** The table as a full-screen sheet, over the whole app. */
      sheetOpen: string;
      sheetClose: string;
      /** First column header when the form collects a contact: who answered, then when. */
      colResponse: string;
      /** The row actions column, for screen readers (it has no visible heading). */
      colActions: string;
      /** "Score {score}": the score chip in the response panel header. */
      scoreValue: string;
      /** Table tools: how many rows a page shows (25, 50, 100). */
      pageSize: string;
      /** The checkbox on one row, and the one in the header that takes the whole page. */
      selectResponse: string;
      selectPage: string;
      /**
       * The button that brings the checkboxes in, and the one that puts them
       * away again (dropping whatever was ticked).
       */
      selectMode: string;
      selectModeDone: string;
      /** "{n} selected", on the bar that appears with a selection. `One` is n = 1. */
      selectedCount: string;
      selectedCountOne: string;
      /** Download only the selected rows, same CSV as the full export. */
      exportSelected: string;
      clearSelection: string;
      /** "Delete {n} responses?": the confirm for a bulk delete. `One` is n = 1. */
      bulkDeleteTitle: string;
      bulkDeleteTitleOne: string;
      /** Worded to read the same for one response or many. */
      bulkDeleteBody: string;
      bulkDeleteFailed: string;
      /** Tooltip on a question column's resize handle. */
      resizeColumn: string;
      /** The filters and sort in the table's column headings, and the chips above it. */
      filters: {
        /** The funnel button's name: "Filter by {column}". */
        filterColumn: string;
        /** The same with a filter on: "Filter by {column}, {n} active". `One` is n = 1. */
        filterColumnActive: string;
        filterColumnActiveOne: string;
        /** Search box on top of a long option list. */
        searchOptions: string;
        /**
         * The table's own search box (its placeholder, and its fuller name for
         * a screen reader), the x that empties it, and its chip's name.
         */
        searchResponses: string;
        searchResponsesLabel: string;
        searchResponsesClear: string;
        searchChip: string;
        noOptions: string;
        /** Removes this column's filter (and sort). */
        clear: string;
        clearAll: string;
        close: string;
        sortTitle: string;
        sortNewest: string;
        sortOldest: string;
        sortScoreDesc: string;
        sortScoreAsc: string;
        /** The date window's section in the menu. */
        rangeTitle: string;
        rangeToday: string;
        range7d: string;
        range30d: string;
        rangeCustom: string;
        rangeFrom: string;
        rangeTo: string;
        scoreRange: string;
        scoreMin: string;
        scoreMax: string;
        /** "{n} of {total} responses": how many the filters leave. */
        showing: string;
        /** The chip list, for screen readers. */
        chipsLabel: string;
        /** "Remove filter: {filter}" on a chip's x. */
        removeChip: string;
        /** Chip values. `{from}–{to}` is a range. */
        chipBetween: string;
        chipAtLeast: string;
        chipAtMost: string;
        chipFrom: string;
        chipUntil: string;
        noMatchesTitle: string;
        noMatchesBody: string;
        /** Title on a Summary bar: "See the responses that chose {option}". */
        showResponses: string;
      };
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
      /** The picker's empty option, i.e. what a blank zone means. */
      bookingDateTimezoneUtc: string;
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
      /** Beside the partial trigger while the form's spam protection holds partials. */
      eventPartialHeld: string;
      /** A webhook that ONLY listens to partials, on a form whose partials are held. */
      webhookPartialOnlyHeld: string;
      /** The HubSpot card while partials are held: contacts sync on complete. */
      hubspotPartialHeld: string;
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
      /** Calendly only: the picker lists what the connected user owns or hosts. */
      calendlyScopeNote: string;
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
        /** Both triggers, on a form whose spam protection holds partials. */
        eventsCompleteHeld: string;
        /** Partial-only, on such a form: it fires on nothing until protection is off. */
        eventsPartialHeld: string;
        /** Tooltip on either held label: why. */
        partialsHeldNote: string;
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
    /**
     * The MCP page under the rail's MCP item (/admin/developers/connect): the
     * connector guide, then the workspace's existing API keys.
     */
    developers: {
      /** The section's name, "MCP": the eyebrow above the connect page heading. */
      title: string;
      /**
       * The connect page (/admin/developers/connect): connect an AI app to the
       * dForms MCP by logging in to the person's account (OAuth), no key. In
       * step bodies, `**text**` renders bold and text between backticks renders
       * as inline code. Product and button names inside other apps stay in
       * English, as those apps show them. Never names the identity provider.
       */
      connect: {
        heading: string;
        intro: string;
        signinTitle: string;
        /** The tag beside the sign-in card's title. */
        recommended: string;
        signinIntro: string;
        benefits: {
          noKey: { title: string; body: string };
          workspaces: { title: string; body: string };
          members: { title: string; body: string };
        };
        /** Accessible name of the app tabs. */
        appsLabel: string;
        urlLabel: string;
        promptLabel: string;
        /** A first request to paste into the app. */
        prompt: string;
        copy: string;
        copied: string;
        copyFailed: string;
        copyUrl: string;
        copyCommand: string;
        copyConfig: string;
        copyPrompt: string;
        addToCursor: string;
        /**
         * The way into each app from its first step, fitted to the device: a
         * web link for Claude and ChatGPT, Claude Desktop's own link on a
         * computer, a one-click copy of the add command for the CLIs, and on a
         * phone a note for what only a computer can do. // {app} in `phoneNote`
         */
        open: {
          claude: string;
          claudeDesktop: string;
          /** The button to dForms' page in Claude's connectors directory. */
          claudeDirectory: string;
          chatgpt: string;
          copyCommand: string;
          copied: string;
          pasteHint: string;
          phoneNote: string;
        };
        /** One numbered list per app, in the order the app asks for things. */
        apps: {
          claude: { steps: { title: string; body: string }[] };
          /**
           * Claude where dForms is listed in its connectors directory (the
           * deployment sets `MCP_CLAUDE_DIRECTORY_URL`): the listing first, the
           * custom connector folded under it for organizations that turned the
           * directory off.
           */
          claudeDirectory: { steps: { title: string; body: string }[]; fallbackTitle: string; fallbackBody: string };
          chatgpt: { steps: { title: string; body: string }[] };
          /** `directoryTitle`/`directoryBody`: the card above the steps when the directory listing is on. */
          claudeCode: { steps: { title: string; body: string }[]; note: string; directoryTitle: string; directoryBody: string };
          codex: { steps: { title: string; body: string }[]; note: string };
          cursor: { steps: { title: string; body: string }[] };
          openclaw: { steps: { title: string; body: string }[] };
          hermes: { steps: { title: string; body: string }[] };
        };
        /** Under the steps: one connector reaches every workspace. */
        tip: string;
        unavailableTitle: string;
        unavailableBody: string;
        /** The animated walkthrough above the steps. */
        media: {
          /** // {app} */
          terminalLabel: string;
          play: string;
          pause: string;
        };
        /**
         * The animated walkthroughs. `ui` is the CLIs' own output (Claude Code,
         * Codex, OpenClaw), kept in English in both locales the way those tools
         * print it; `signIn` and `answer` are dForms and speak the reader's
         * language.
         */
        walkthrough: {
          ui: {
            ccWelcome: string;
            ccHelp: string;
            /** // {url} */
            ccAdded: string;
            ccManage: string;
            needsAuth: string;
            authenticate: string;
            ccBrowser: string;
            ccAuthOk: string;
            codexAdded: string;
            codexAuthorize: string;
            codexLoggedIn: string;
            codexModel: string;
            called: string;
            working: string;
            ocSaved: string;
            ocLogin: string;
            ocLoggedIn: string;
            hmSaved: string;
            hmLogin: string;
            hmLoggedIn: string;
          };
          /** The dForms sign-in the apps open: email, then the code by email. */
          signIn: {
            title: string;
            emailLabel: string;
            email: string;
            continue: string;
            checkEmail: string;
            codeSentTo: string;
            noCode: string;
            /** // {app} */
            connected: string;
            /** // {app} */
            consentTitle: string;
            redirectNote: string;
            warning: string;
            allow: string;
            cancel: string;
          };
          answer: {
            intro: string;
            forms: { name: string; stat: string }[];
            colForm: string;
            colResponses: string;
            colStatus: string;
            live: string;
          };
        };
        /** The short card that points to the Tools page. // {count} in `intro` */
        toolsTitle: string;
        toolsIntro: string;
        toolsLink: string;
      };
      /**
       * The Tools page (/admin/developers/tools): what an agent can do with
       * dForms, in plain words, grouped. `items` is keyed by the MCP tool's
       * name; a spec holds it to the server's catalog in both languages.
       */
      tools: {
        title: string;
        /** // {count} */
        intro: string;
        /** Before each example request. */
        askLabel: string;
        /** // {n} */
        count: string;
        groups: {
          forms: { title: string; body: string };
          responses: { title: string; body: string };
          analytics: { title: string; body: string };
          folders: { title: string; body: string };
          brandKit: { title: string; body: string };
          linkPage: { title: string; body: string };
          notifications: { title: string; body: string };
          integrations: { title: string; body: string };
          account: { title: string; body: string };
        };
        items: Record<string, { what: string; ask: string }>;
        connectCta: string;
      };
    };
    /**
     * The API reference prose: what an API key can call. No page shows it any
     * more (the dashboard's API docs gave way to the Tools page); the REST API's
     * reference specs still hold every route to its text. The routes, parameters and examples come from
     * `API_REFERENCE` (api-reference.ts); this is only the prose, keyed by the
     * same route strings and parameter docs, so the compiler refuses a route
     * or a parameter without its text in either language. Text between
     * backticks renders as inline code.
     */
    apiDocs: {
      title: string;
      subtitle: string;
      /** The index on the left (a selector at the top on a phone). */
      toc: {
        /** Accessible name of the index. */
        label: string;
        /** Label of the phone selector. */
        jumpLabel: string;
        gettingStarted: string;
        errors: string;
        limits: string;
        reference: string;
        notAllowed: string;
      };
      search: {
        /** Accessible name of the search box. */
        label: string;
        placeholder: string;
        /** No endpoint matches. // {query} */
        empty: string;
        clear: string;
      };
      errors: {
        title: string;
        intro: string;
        /** Over the example 400. */
        exampleTitle: string;
        /** What `issues[]` and its `path` are. */
        issuesBody: string;
        codesTitle: string;
        colStatus: string;
        colCode: string;
        colMeaning: string;
        codes: Record<ApiErrorCode, string>;
        issueCodesTitle: string;
        issueCodes: Record<ApiIssueCode, string>;
      };
      limits: {
        title: string;
        /** // {count} */
        rate: string;
        rateBody: string;
        /** // {count} */
        keys: string;
        keysBody: string;
      };
      reference: {
        title: string;
        intro: string;
        /** Badge: needs an owner or admin key. */
        adminOnly: string;
        adminOnlyHint: string;
        /** Badge: deletes something. */
        destructive: string;
        destructiveHint: string;
        params: string;
        colName: string;
        colDescription: string;
        required: string;
        in: Record<ApiParamIn, string>;
        request: string;
        /** Over the example answer. // {status} */
        response: string;
        /** A 204 answers nothing. */
        noContent: string;
        copy: string;
        copied: string;
        copyFailed: string;
        /** Accessible name of an endpoint's own link. // {route} */
        anchorLabel: string;
      };
      /** One heading and one line per area of the reference. */
      areas: Record<ApiArea, { title: string; intro: string }>;
      /** What each endpoint is for, one or two sentences. */
      endpoints: Record<ApiRoute, string>;
      /** What each parameter means. */
      params: Record<ApiParamDoc, string>;
      notAllowed: {
        title: string;
        intro: string;
        items: Record<ApiNotAllowed, string>;
      };
    };
    /** Draft → publish controls in the form editor (publish button + badge). */
    publish: {
      publish: string;
      publishing: string;
      published: string;
      publishError: string;
      /** The pending autosave failed, so nothing was published. */
      saveFirst: string;
      unpublishedChanges: string;
      noChanges: string;
      /** The publish menu (the chevron beside Publish), and what it holds: revert. */
      moreOptions: string;
      revert: string;
      /** Under the revert item: when the version it brings back went live. `{date}`. */
      revertAvailable: string;
      /** Under the revert item, greyed out: there is no earlier published version. */
      revertUnavailable: string;
      revertTitle: string;
      /** The confirmation: which version goes live, and that the draft stays. `{date}`. */
      revertBody: string;
      revertConfirm: string;
      reverting: string;
      reverted: string;
      revertError: string;
      /** The pending autosave failed, so nothing was reverted. */
      revertSaveFirst: string;
      nothingToRevert: string;
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
    deleteFolderTitle: string;
    deleteQuestionTitle: string;
    deleteSubmissionTitle: string;
    removeMemberTitle: string;
    resetEmailTitle: string;
    disconnectIntegrationTitle: string; // {provider}
  };
}

export const en: FormsMessages = {
  growth: {
    madeWith: 'Made with dForms',
    ctaQuestion: 'Want your own form?',
    ctaAction: 'Get dForms, free',
    emailCtaAction: 'Create your form, free',
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
    ctaAction: 'Get dForms, free',
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
    errorTitle: 'This page didn\u2019t load',
    errorBody: 'Something went wrong reaching the forms service.',
    errorRetry: 'Try again',
    notFoundTitle: 'Not found',
    notFoundBody: 'This page doesn\u2019t exist.',
    notFoundHome: 'Go home',
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
      url: 'Enter a valid website address.',
      phone: 'Enter a valid phone number.',
      number: 'Enter a number.',
      too_low: 'Value is too low.',
      too_high: 'Value is too high.',
      too_short: 'Your answer is too short.',
      too_long: 'Your answer is too long.',
      option: 'Choose one of the available options.',
      file: 'Upload a file to continue.',
      submit: 'Could not submit. Please try again.',
      captcha: 'We couldn’t verify that you’re human. Please try again.',
      captcha_required: 'This form now checks that you’re human. Refresh the page and submit again.',
      rate_limited: 'Too many attempts from your connection. Wait a moment and try again.',
      answer_too_long: 'One of your answers is longer than this form allows. Shorten it and try again.',
      invalid_answers: 'Some answers are missing or no longer match this form. Reload the page and try again.',
    },
    captcha: {
      prompt: 'Confirm you’re human to send your answers.',
      unavailable: 'We couldn’t complete the security check. Your answers are saved. Please try again.',
      retry: 'Try again',
    },
    charCounter: {
      characters: '{count} characters',
      minimum: '{min} minimum',
    },
    phonePicker: {
      countryLabel: 'Select country code',
      search: 'Search country or code',
      noResults: 'No countries found',
      invalid: 'Enter a valid phone number.',
    },
    upload: {
      choose: 'Choose a file',
      accepts: '{types}, up to {max} MB',
      uploading: 'Uploading {percent}%',
      remove: 'Remove',
      failed: 'That upload did not finish.',
      retry: 'Try again',
      tooLarge: 'That file is bigger than {max} MB.',
      wrongType: 'That kind of file is not accepted here.',
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
  linkPage: {
    buttonsLabel: 'Links',
    socialsLabel: 'Social profiles',
    social: { instagram: 'Instagram', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', whatsapp: 'WhatsApp' },
    seoDescription: 'Forms and links from {name}.',
  },
  admin: {
    linkPage: {
      heading: 'Your workspace page',
      subtitle: 'One page with your logo, your forms and your links, at a link you can share or print as a QR code.',
      anyMember: 'Anyone in this workspace can edit this page.',
      enable: 'Published',
      offNote: 'Not published. Visitors get a page not found until you turn it on.',
      copy: 'Copy link',
      copied: 'Copied',
      open: 'Open',
      qr: 'QR code',
      qrTitle: 'QR code for your page',
      qrIntro: 'Print it on a card, a banner or a booth. Scanning it opens this page.',
      qrAlt: 'QR code that opens your workspace page',
      qrDownloadPng: 'Download PNG',
      qrDownloadSvg: 'Download SVG',
      qrPngFailed: 'Could not make the PNG in this browser. Download the SVG instead.',
      headerSection: 'Header',
      logo: 'Photo or logo',
      logoHint: 'Shown at the top of the page and on the link preview.',
      logoUpload: 'Upload image',
      logoUseKit: 'Use brand kit logo',
      logoNone: 'No logo',
      logoFromKit: 'From your brand kit.',
      logoNoKit: 'Your brand kit has no logo, so your initials show instead.',
      logoInitials: 'No logo: your initials show instead.',
      logoUrl: 'Or paste an image link',
      logoUrlPlaceholder: 'https://example.com/logo.png',
      logoInvalid: 'Use a PNG, JPEG, WebP or GIF image, or a link that starts with https://.',
      logoTooBig: 'That image is too large even after resizing. Try a smaller one.',
      name: 'Name',
      bio: 'Bio',
      bioPlaceholder: 'One line about what you do.',
      buttonsSection: 'Buttons',
      buttonsHint: 'Your forms and links, in the order they show on the page.',
      addForm: 'Add a form',
      addFormPlaceholder: 'Choose a form',
      addLink: 'Add a link',
      noForms: 'This workspace has no forms yet.',
      allFormsAdded: 'Every form is already on the page.',
      empty: 'No buttons yet. Add a form or a link.',
      formTag: 'Form',
      linkTag: 'Link',
      linkLabel: 'Label',
      linkLabelPlaceholder: 'Our website',
      linkUrl: 'URL',
      linkUrlPlaceholder: 'https://example.com',
      linkInvalid: 'Give the link a label and a full URL that starts with https://.',
      moveUp: 'Move up',
      moveDown: 'Move down',
      remove: 'Remove',
      maxItems: 'A page holds up to {max} buttons.',
      socialsSection: 'Social links',
      socialsHint: 'Only the ones you fill in show on the page. Each opens in a new tab.',
      socialPlaceholders: {
        instagram: 'instagram.com/yourbrand',
        x: 'x.com/yourbrand',
        youtube: 'youtube.com/@yourbrand',
        tiktok: 'tiktok.com/@yourbrand',
        whatsapp: '+57 300 123 4567',
      },
      socialInvalid: 'Enter a {network} link or handle, like @yourbrand.',
      whatsappInvalid: 'Add the country code at the start, with a +, like +57 300 123 4567.',
      whatsappHint: 'Visitors open a WhatsApp chat with this number.',
      preview: 'Preview',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Page saved.',
      error: 'Could not save the page.',
      fixErrors: 'Fix the highlighted fields first.',
      back: 'All pages',
      pageSection: 'Page',
      pageName: 'Internal name',
      pageNameHint: 'To tell your pages apart. Visitors never see it.',
      pageNamePlaceholder: 'Expo 2026',
      slug: 'Address',
      slugHint: 'The page lives at {base}/ followed by this.',
      slugInvalid: 'Use 3 to 30 lowercase letters, numbers or single hyphens, starting and ending with a letter or number.',
      slugReserved: 'That address is reserved. Pick another one.',
      slugTaken: 'Another of your pages already uses that address.',
      defaultBadge: 'Main page',
      defaultHint: 'This is your main page: it opens at {url}.',
      makeDefault: 'Make main page',
      madeDefault: 'This is now your main page.',
      makeDefaultNeedsPublish: 'Publish this page first. Your main page opens at your workspace link, so it has to be published.',
      colorsSection: 'Colors',
      colorsHint: 'By default the page uses your brand kit. Pick a color here to use another one on this page only.',
      colorPrimary: 'Buttons',
      colorBackground: 'Background',
      colorForeground: 'Text',
      colorFromKit: 'From your brand kit',
      colorReset: 'Use brand kit',
    },
    linkPages: {
      heading: 'Your workspace pages',
      subtitle: 'Pages with your logo, your forms and your links: one for each event, channel or country, each with its own link and QR code.',
      anyMember: 'Anyone in this workspace can create and edit these pages.',
      newPage: 'New page',
      count: '{n} of {max} pages',
      limitReached: 'A workspace holds up to {max} pages. Delete one to add another.',
      emptyTitle: 'No pages yet',
      emptyBody: 'Create a page to share your forms and links from one place, with its own link and QR code.',
      defaultName: 'Main page',
      defaultBadge: 'Main',
      live: 'Published',
      off: 'Not published',
      toggleLabel: 'Publish {name}',
      buttons: '{n} buttons',
      buttonsOne: '1 button',
      edited: 'Edited {date}',
      edit: 'Edit',
      duplicate: 'Duplicate',
      duplicated: 'Page duplicated. The copy is not published yet.',
      copyName: '{name} (copy)',
      copyLink: 'Copy link',
      copied: 'Copied',
      qr: 'QR code',
      makeDefault: 'Make main page',
      madeDefault: 'This is now your main page.',
      makeDefaultNeedsPublish: 'Publish this page first. Your main page opens at your workspace link, so it has to be published.',
      remove: 'Delete',
      removeTitle: 'Delete this page?',
      removeBody: '“{name}” and its link stop working, printed QR codes included. This cannot be undone.',
      removeConfirm: 'Delete page',
      removed: 'Page deleted.',
      cannotRemoveDefault: 'Your main page cannot be deleted. Make another page the main one first.',
      published: 'Page published.',
      unpublished: 'Page unpublished.',
      createTitle: 'New page',
      createName: 'Internal name',
      createNamePlaceholder: 'Expo 2026',
      createSlug: 'Address',
      create: 'Create page',
      creating: 'Creating…',
      cancel: 'Cancel',
      error: 'Something went wrong. Try again.',
    },
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
      timezoneAutoSet: 'Workspace timezone set to {zone}. Change it in Account settings or on the submissions page.',
      expand: 'Expand sidebar',
      openNav: 'Open navigation',
      theme: {
        label: 'Theme',
        dark: 'Dark',
        light: 'Light',
        next: 'Switch to',
      },
      docsHref: 'https://docs.dapta.ai/dapta-forms/forms',
      nav: {
        home: 'Home',
        forms: 'Forms',
        submissions: 'Submissions',
        analytics: 'Analytics',
        integrations: 'Integrations',
        developers: 'Connect your agent',
        tools: 'Tools',
        docs: 'Docs',
        agents: 'Sales AI Agents',
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
        dapta: 'Sales AI Agents',
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
        searchClear: 'Clear search',
        staff: 'Staff',
        estate: 'All workspaces',
        hintForm: 'Form: {name}',
      },
    },
    home: {
      welcome: 'Welcome',
      welcomeNamed: 'Welcome, {name}',
      subtitle: 'Your forms at a glance.',
      publicLink: 'Your public page',
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
      recent: 'Recent activity',
      viewAll: 'View all',
      shortcuts: 'Shortcuts',
      noSubmissions: 'No responses yet',
      statCompletionNote: 'of those who start',
      publicPageDesc: 'The forms you want people to find.',
      colUpdated: 'Updated',
      agentBanner: {
        title: 'Control your forms, logic and design from your AI agent',
        body: 'Connect Claude, ChatGPT, Claude Code, Codex, Cursor, OpenClaw or Hermes with your account. No API key.',
        cta: 'Connect your agent',
      },
      agentCard: {
        eyebrow: 'Made for agents',
        title: 'Connect your agent',
        body: 'Ask in your own words. Your agent builds the form, sets up the logic and the design, publishes it and reads every response.',
        cta: 'Connect your agent',
        label: 'An AI agent creating a dForms form from a prompt',
        prompts: [
          'Connect to the dForms MCP and build me a form that filters the best projects for my agency.',
          'Make a lead form for my studio and let anyone with a budget over $5k book a call.',
          'Build a job application form and score candidates by years of experience.',
          'Create an RSVP form for our launch event and give me a QR code for the door.',
          'Send every new lead from my contact form to HubSpot, with the score.',
          'Which question is costing my signup form the most responses this week?',
        ],
        done: 'Done. It is live in dForms.',
        placeholder: 'Ask {app}…',
        connected: 'dForms connected',
      },
    },
    brandKit: {
      title: 'Brand kit',
      subtitle:
        'New forms start with it. You can apply it to the ones that already exist.',
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
      notSetShort: 'Not set',
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
      workspaceTimezone: 'Workspace timezone',
      workspaceTimezoneHelp:
        'Shared by everyone in this workspace. Every date in the dashboard, the analytics day cuts and the local columns of the CSV export are read in this zone.',
      workspaceTimezoneSaved: 'Workspace timezone saved.',
      workspaceTimezoneError: 'Could not save the timezone. Please try again.',
      workspaceTimezoneUnset: 'Not set (UTC)',
      workspaceTimezoneUtc: 'UTC',
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
      manageErrorMembershipNotActive:
        'Your own membership in this workspace is not active (its owner disabled it, or it is still an invitation), so staff access cannot open it.',
      manageErrorUpstream: 'The identity service could not apply this change.',
      manageErrorOwnership: 'Ownership is transferred from the Dapta app.',
    },
    account: {
      title: 'Account settings',
      subtitle: 'Workspaces, brand, emails and preferences.',
      managing: 'Managing',
      nav: {
        workspaces: 'Workspaces',
        brandKit: 'Brand kit',
        notifications: 'Notifications',
        publicPage: 'Public page',
        preferences: 'Preferences',
      },
      preferences: {
        title: 'Preferences',
        subtitle: 'Settings that follow you rather than the workspace.',
        languageLabel: 'Language',
        languageHelp:
          'The language you read the app in, and the one your submission emails are written in. It follows your account, so it applies wherever you sign in. Teammates keep their own choice, and people filling in your forms are answered in their own language.',
        languageError: 'Your language could not be saved. Please try again.',
      },
      workspaces: {
        title: 'Workspaces',
        subtitle: 'Every workspace you belong to. Open one to work in it, or manage its members and invitations.',
        search: 'Search workspaces',
        searchEmpty: 'No workspace matches that.',
        searchClear: 'Clear search',
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
        idLabel: 'Workspace ID',
        copyId: 'Copy ID',
        copied: 'Copied',
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
      previewExpand: 'Expand preview',
      previewMock: {
        title: 'How the email arrives',
        inbox: 'Inbox',
        toMe: 'to me',
        justNow: 'Just now',
        reply: 'Reply',
        forward: 'Forward',
        close: 'Close',
        note: 'A mock of how the email looks in an inbox. Each email app draws it a little differently.',
      },
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
      tokenRespondentName: 'Respondent name',
      tokenRespondentEmail: 'Respondent email',
      tokenScore: 'Score',
      tokenOutcomeLabel: 'Outcome',
      tokenFormLink: 'Submissions link',
      tokenAnswers: 'Answers',
      answersMissing:
        'This email does not include {{answers}}, so the answers will not be in it. Insert the Answers variable to add them.',
      formOverrideNote: 'Each form can override these emails from its Connect tab in the editor.',
      recipientsLabel: 'Send to',
      recipientsHint:
        'Each address receives its own copy of this email. Up to five addresses.',
      recipientsEmpty: 'No addresses yet, so this email goes to the workspace owner, or to the first admin when there is no owner with an email.',
      recipientsAdd: 'Add address',
      recipientsRemove: 'Remove address',
      recipientsPlaceholder: 'name@example.com',
      recipientsInvalid: 'Enter a valid email address.',
      recipientsFollowingAccount: 'Following the account list. Editing it here sets one for this form only.',
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
      layoutSlidesDesc: 'One screen at a time. Group questions to show several on one screen.',
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
      searchPlaceholder: 'Search forms',
      searchLabel: 'Search forms by name or link',
      searchClear: 'Clear search',
      searchEmpty: 'No forms match your search.',
      searchResults: '{count} forms match',
      searchShortcut: 'Ctrl K',
      unfiled: 'Unfiled',
      folderCount: '{count} forms',
      folderCountOne: '1 form',
      newFolder: 'New folder',
      newFolderTitle: 'Create a folder',
      folderCreate: 'Create folder',
      renameFolder: 'Rename',
      renameFolderTitle: 'Rename folder',
      folderSave: 'Save',
      folderNameLabel: 'Folder name',
      folderNamePlaceholder: 'e.g. Sales',
      folderNameRequired: 'Give the folder a name.',
      folderNameTaken: 'A folder with that name already exists.',
      deleteFolder: 'Delete folder',
      deleteFolderConfirm: 'Delete “{name}”? The forms inside ({forms}) are kept and move to Unfiled.',
      folderMenu: 'Folder actions',
      collapse: 'Collapse',
      expand: 'Expand',
      createIn: 'New form',
      folderLabel: 'Folder',
      folderNone: 'No folder',
      moveTo: 'Move to folder',
      moveBack: 'No folder',
      moveFailed: 'Could not move the form. Please try again.',
      dragHandle: 'Drag to a folder',
      dropHere: 'Drop to move here',
      actionFailed: 'Something went wrong. Please try again.',
      colForm: 'Form',
      colStatus: 'Status',
      colSubmissions: 'Submissions',
      colCompletion: 'Completion',
      colUpdated: 'Updated',
      statusLive: 'Published',
      statusLiveHint: 'What the public sees is the latest version.',
      statusUnpublished: 'Unpublished changes',
      statusUnpublishedHint: 'It has edits the public does not see yet.',
      noCompletion: 'No data',
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
          'Leave empty to show the thank-you screen. If set, respondents are sent here instead. Use [field] to add an answer to the URL, such as ?name=[name]. When the form is embedded, answers are not sent and those parameters are left out.',
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
        redirectHint:
          'Leave empty to show the thank-you screen. If set, everyone is sent here. Use [field] to add an answer to the URL, such as ?name=[name]. When the form is embedded, answers are not sent and those parameters are left out.',
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
        file: 'File upload',
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
        fileAllowedTypes: 'Accepted files',
        fileAllowedTypesHint:
          'Pick the groups you accept, or type extensions separated by commas. Programs and web pages are never accepted.',
        filePresetDocuments: 'Documents',
        filePresetImages: 'Images',
        filePresetSheets: 'Spreadsheets',
        filePresetArchives: 'Archives',
        fileMaxSize: 'Largest file (MB)',
        fileMaxSizeHint: 'Up to {max} MB on this deployment. Leave empty to allow the full {max} MB.',
        fileNoTypes: 'Choose at least one kind of file, or nobody can answer this question.',
        phoneMinDigits: 'Minimum digits',
        phoneMinDigitsHelp:
          'The shortest number accepted, not counting the country code. Phone lengths vary by country, so this is the floor that catches an obviously incomplete number.',
        charLimits: 'Answer length',
        charLimitsHelp:
          'Respondents see a live counter and cannot continue until the minimum is met. Leave a box empty to drop that end.',
        minChars: 'Minimum characters',
        maxChars: 'Maximum characters',
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
        iconLettersHint: 'Up to two letters, e.g. HS for HubSpot. Leave it empty and the option shows no icon.',
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
          'What gets stored in the response and sent to HubSpot or a webhook. It follows the label until you write one yourself, and then it stays as you left it.',
        advanced: 'Stored values',
        valueTaken: 'Another option on this question already stores that value.',
        valueLocked:
          'These values are already in use, so they stay as they are while you reword the labels. Answers collected on the live form carry them, and so does any HubSpot mapping pointing at them.',
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
        slidesHint: 'One screen at a time. Group questions to show several on one screen.',
        vertical: 'One page',
        verticalHint:
          'Every question on a single page with one Submit. Logic still applies live: questions show and hide as answers change.',
        screensIgnored: 'Screens only apply to Slides. On One page every question is already on one page.',
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
        languageTitle: 'Language',
        languageHint:
          'The language of the buttons, progress and thank-you copy visitors see. Auto follows each visitor\u2019s browser. A ?lang= link still wins.',
        languageAuto: 'Auto (visitor\u2019s browser)',
        languageEn: 'English',
        languageEs: 'Spanish',
        labelsTitle: 'Button text',
        labelsHint: 'Replace the default button copy for this form. Leave empty to keep the default for the language. A question\u2019s own button text still wins on that question.',
        labelBack: 'Back',
        labelNext: 'Next',
        labelSubmit: 'Submit',
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
        badgeSize: 'Attribution badge',
        badgeSizeHint: 'The "Made with" pill under the form.',
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
        spamTitle: 'Spam protection (captcha)',
        spamToggle: 'Check that respondents are human before the final submit',
        spamHelp:
          'Adds a captcha that stops automated bot submissions. Most people see nothing: a checkbox appears only when traffic looks suspicious. Only complete, verified responses reach your integrations.',
        spamPartialNote:
          'Partial answers are still saved in Submissions, but they are not sent to webhooks or HubSpot while protection is on.',
        spamUnavailable: 'Spam protection is not set up on this deployment.',
        spamInactiveHere:
          'It is switched on for this form, but it does not run on this deployment until spam protection is set up.',
        spamDraftNote: 'Staged with your draft: click Publish to apply it to the live form.',
        spamModeGroup: 'Protection mode',
        spamModeAuto: 'Automatic: only suspicious visitors see a check (recommended)',
        spamModeStrict: 'Strict: everyone sees the verification before sending, plus extra checks',
        spamModeStrictHelp: 'Use it if spam still gets through. It adds a visible step for everyone.',
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
        gtmHelp:
          'Loads your GTM container so your tags fire, and pushes a form_lead event when someone completes the form.',
        metaLabel: 'Meta Pixel ID',
        metaHelp:
          'Fires a PageView when the form loads, and a Lead when someone completes it.',
        posthogKeyLabel: 'PostHog project key',
        posthogKeyHelp: 'Captures a pageview in PostHog for product analytics.',
        posthogHostLabel: 'PostHog host (optional)',
        posthogHostHelp: 'Defaults to PostHog US cloud; set your EU or self-hosted ingestion URL.',
        posthogHostInvalid: 'Enter a full http(s) URL, e.g. https://eu.i.posthog.com.',
        hubspotLabel: 'HubSpot tracking ID',
        hubspotHelp:
          'Loads the HubSpot tracking code for your portal on the form page. If you embed this form in pages that already load your HubSpot tracking code, leave it empty: the embed passes the visit from those pages.',
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
      timezoneNote: 'Days in {zone}',
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
      timezoneLabel: 'Workspace timezone',
      timezoneHint: 'Dates below are read in this zone. It is shared by the whole workspace.',
      timezoneReadOnly: 'Only an admin can change it.',
      badgeCompleted: 'Completed',
      badgePartial: 'Partial',
      colSubmitted: 'Submitted',
      colStatus: 'Status',
      colScore: 'Score',
      colSubmittedAt: 'Submitted at',
      colSubmissionId: 'Submission id',
      colPageUrl: 'Page URL',
      colFirstName: 'First name',
      colLastName: 'Last name',
      export: 'Download CSV',
      delete: 'Delete',
      deleteConfirm: 'Delete this submission? This cannot be undone.',
      download: 'Download',
      downloadFailed: 'That file could not be opened.',
      previewLoading: 'Opening the file',
      previewFailed: 'The preview could not load.',
      previewReload: 'Try again',
      previewUnavailable: 'This kind of file cannot be shown here. Download it to open it.',
      previewApprox: 'Approximate view. Download the file to see its exact layout.',
      previewClose: 'Close',
      emptyTitle: 'No submissions yet',
      emptyBody: 'Responses will show up here as people complete the form.',
      prev: 'Previous',
      next: 'Next',
      showing: '{from}–{to} of {total}',
      na: '',
      error: 'Couldn’t load submissions.',
      retry: 'Try again',
      summary: {
        tabSummary: 'Summary',
        tabResponses: 'Responses',
        tabsLabel: 'Submissions views',
        multiNote: 'People could choose more than one option, so the percentages can add up to more than 100%.',
        average: 'Average',
        range: '{from}–{to}',
        filesUploaded: 'Files uploaded',
        meetingsBooked: 'Meetings booked',
        noAnswers: 'Nobody has answered this question yet.',
        latest: 'Latest answers',
        searchLabel: 'Search the answers to this question',
        searchPlaceholder: 'Search answers',
        searchClear: 'Clear search',
        matches: 'Matches: {n}',
        noMatches: 'No answer contains “{query}”.',
        showMore: 'Show more',
        anonymous: 'Anonymous',
        openAnswer: 'Open this response',
        openFailed: 'That response could not be opened. It may have been deleted.',
        searchFailed: 'The search did not finish. Try again.',
      },
      viewResponse: 'View response',
      responseTitle: 'Anonymous response',
      prevResponse: 'Previous response',
      nextResponse: 'Next response',
      closeResponse: 'Close',
      responsePosition: '{n} of {total}',
      answersTitle: 'Answers',
      detailsTitle: 'Details',
      noAnswer: 'No answer',
      colStarted: 'Started',
      responseId: 'Response ID',
      pageRow: 'Page',
      hubspotCookie: 'HubSpot cookie received',
      utmTitle: 'Campaign (UTM)',
      answeredCount: '{n} of {total} answered',
      sheetOpen: 'Full screen',
      sheetClose: 'Exit full screen',
      colResponse: 'Response',
      colActions: 'Actions',
      scoreValue: 'Score {score}',
      pageSize: 'Rows per page',
      selectResponse: 'Select this response',
      selectPage: 'Select every response on this page',
      selectMode: 'Select',
      selectModeDone: 'Done',
      selectedCount: '{n} selected',
      selectedCountOne: '1 selected',
      exportSelected: 'Export CSV',
      clearSelection: 'Clear',
      bulkDeleteTitle: 'Delete {n} responses?',
      bulkDeleteTitleOne: 'Delete 1 response?',
      bulkDeleteBody: 'This cannot be undone.',
      bulkDeleteFailed: 'Could not delete. Try again.',
      resizeColumn: 'Drag to resize. Double-click to reset.',
      filters: {
        filterColumn: 'Filter by {column}',
        filterColumnActive: 'Filter by {column}, {n} active',
        filterColumnActiveOne: 'Filter by {column}, 1 active',
        searchOptions: 'Search options',
        searchResponses: 'Search responses',
        searchResponsesLabel: 'Search in the written answers',
        searchResponsesClear: 'Clear search',
        searchChip: 'Search',
        noOptions: 'No option matches.',
        clear: 'Clear',
        clearAll: 'Clear all',
        close: 'Close',
        sortTitle: 'Sort',
        sortNewest: 'Newest first',
        sortOldest: 'Oldest first',
        sortScoreDesc: 'Highest first',
        sortScoreAsc: 'Lowest first',
        rangeTitle: 'Date',
        rangeToday: 'Today',
        range7d: 'Last 7 days',
        range30d: 'Last 30 days',
        rangeCustom: 'Custom range',
        rangeFrom: 'From',
        rangeTo: 'To',
        scoreRange: 'Score range',
        scoreMin: 'Min',
        scoreMax: 'Max',
        showing: '{n} of {total} responses',
        chipsLabel: 'Active filters',
        removeChip: 'Remove filter: {filter}',
        chipBetween: '{from}–{to}',
        chipAtLeast: '{min} or more',
        chipAtMost: '{max} or less',
        chipFrom: 'From {from}',
        chipUntil: 'Until {to}',
        noMatchesTitle: 'No responses match these filters',
        noMatchesBody: 'Remove a filter, or clear them all, to see more.',
        showResponses: 'See the responses that chose {option}',
      },
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
        'Creates a matching form in your portal, so each completed submission shows on the contact as a form submission activity listing the properties it set. Not just a note. It is also what joins the contact to its visits on the page that embeds the form, so turn it on to attribute them. Needs the forms and form-submissions-write scopes on your private app.',
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
        'Receives the submission date. A date-type property gets the calendar day (named in the Day timezone beside it); a datetime property keeps the exact time.',
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
      bookingHoursPropertyHelp:
        'Date and time the meeting starts, from the scheduler. A date-type property gets the meeting day instead (named in the Day timezone).',
      bookingDateTimezone: 'Day timezone',
      bookingDateTimezoneHelp:
        'Decides which calendar day a date-type property records (e.g. a 9pm submission is still "today" locally, but already tomorrow in UTC). Shared by every date-type property of this integration. Blank = UTC. Datetime properties keep the exact time and are shown in your portal\u2019s timezone instead.',
      bookingDateTimezonePlaceholder: 'America/Bogota',
      bookingDateTimezoneUtc: 'UTC (default)',
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
      pingWeSend: 'dForms always delivers with POST and a JSON body.',
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
      eventPartialHeld: 'Paused while spam protection is on',
      webhookPartialOnlyHeld:
        'This webhook will not fire: it only listens to partial answers, which are paused while spam protection is on.',
      hubspotPartialHeld:
        'Spam protection is on: contacts are created or updated when a respondent completes the form, not from partial answers.',
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
      calendlyScopeNote:
        'Forms can pick the event types this account owns or hosts. To use a team event, connect an account that is one of its hosts.',
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
        eventsCompleteHeld: 'Complete (partials paused)',
        eventsPartialHeld: 'Partial submissions (paused)',
        partialsHeldNote: 'Spam protection is on for this form: partial answers are saved but not sent.',
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
    developers: {
      title: 'MCP',
      connect: {
        heading: 'Connect Claude, ChatGPT, Codex or Cursor to dForms',
        intro: 'Ask your AI assistant to build, edit and publish forms, read responses and check analytics, right from a chat. Log in once with your account and it can work in every workspace you can open.',
        signinTitle: 'Connect with your account',
        recommended: 'Recommended',
        signinIntro: 'Pick your app and follow the steps.',
        benefits: {
          noKey: { title: 'No API key.', body: 'Simply log in to your account. Nothing to create or store.' },
          workspaces: { title: 'One connector, all your workspaces.', body: 'Work in any workspace you can open in dForms.' },
          members: { title: 'Any member can connect.', body: 'No need to ask the workspace owner.' },
        },
        appsLabel: 'Your AI app',
        urlLabel: 'MCP URL',
        promptLabel: 'Try it',
        prompt: 'List my forms in dForms',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Could not copy. Select the text and copy it by hand.',
        copyUrl: 'Copy URL',
        copyCommand: 'Copy command',
        copyConfig: 'Copy configuration',
        copyPrompt: 'Copy prompt',
        addToCursor: 'Add to Cursor',
        open: {
          claude: 'Open Claude',
          claudeDesktop: 'Open Claude Desktop',
          claudeDirectory: 'Open in the Claude directory',
          chatgpt: 'Open ChatGPT',
          copyCommand: 'Copy command',
          copied: 'Copied',
          pasteHint: 'Paste it in your terminal.',
          phoneNote: 'Open this page on your computer to connect {app}.',
        },
        apps: {
          claude: {
            steps: [
              {
                title: 'Open Connectors in Claude',
                body: 'In claude.ai, Claude Desktop or Cowork, click **+** in the chat box, then **Connectors → Add connector → Add custom connector**.',
              },
              {
                title: 'Name it dForms and paste this URL',
                body: 'Use `dForms` as the name and paste the URL below. Leave the advanced settings empty and click **Add**.',
              },
              {
                title: 'Log in to your account',
                body: 'Your browser opens the sign-in page. Enter your email and type the 6-digit code we send you. Back in Claude, dForms shows as **Connected**.',
              },
              {
                title: 'Ask',
                body: 'Open a new chat and ask, for example:',
              },
            ],
          },
          claudeDirectory: {
            steps: [
              {
                title: 'Open dForms in the Claude directory',
                body: 'Click the button below. Or, in Claude, click **+** in the chat box, then **Connectors → Browse connectors**, and search for `dForms`.',
              },
              {
                title: 'Click Connect',
                body: 'On the dForms page of the directory, click **Connect**. Claude opens the dForms sign-in.',
              },
              {
                title: 'Log in to your account',
                body: 'Enter your email and type the 6-digit code we send you. Back in Claude, dForms shows as **Connected**.',
              },
              {
                title: 'Ask',
                body: 'Open a new chat and ask, for example:',
              },
            ],
            fallbackTitle: 'Your organization does not allow the directory?',
            fallbackBody: 'Add dForms as a custom connector instead: in Claude click **+**, then **Connectors → Add connector → Add custom connector**. Use `dForms` as the name, paste this URL and click **Add**.',
          },
          chatgpt: {
            steps: [
              {
                title: 'Create the app in ChatGPT',
                body: 'In the ChatGPT desktop app, switch to **Work** mode. Open **Plugins**, click **Add** and choose **Create MCP App**.',
              },
              {
                title: 'Fill in the form',
                body: 'Name: `dForms`. Server URL: paste the address below. Leave Authentication on **OAuth**. Check **I understand and want to continue** and create it.',
              },
              {
                title: 'Log in to your account',
                body: 'Click **Continue**. Your browser opens: log in if it asks, then click **Open ChatGPT** to come back.',
              },
              {
                title: 'Install the plugin',
                body: 'In **Plugins**, open the **Personal** tab, choose **dForms** and click **Install plugin**. The browser opens once more to link your account: click **Open ChatGPT** again. That second sign-in is expected.',
              },
              {
                title: 'Ask',
                body: 'Click **Try now**, type `@dForms` and ask, for example:',
              },
            ],
          },
          claudeCode: {
            steps: [
              {
                title: 'Add dForms to Claude Code',
                body: 'In a terminal, run:',
              },
              {
                title: 'Log in to your account',
                body: 'Open Claude Code, run `/mcp`, choose **dforms** and then **Authenticate**. Log in in the browser and come back to the terminal.',
              },
              {
                title: 'Ask',
                body: 'Ask, for example:',
              },
            ],
            note: 'Already connected dForms in Claude? Claude Code logged in with the same Claude account uses that connector too: run `/mcp` to check.',
            directoryTitle: 'Already connected dForms in Claude?',
            directoryBody: 'Claude Code logged in with the same Claude account brings the dForms connector with it. Run `/mcp` and look for **dForms**. Not there yet? Connect it from the Claude directory, or follow the steps below.',
          },
          codex: {
            steps: [
              {
                title: 'Add dForms to Codex',
                body: 'In a terminal, run:',
              },
              {
                title: 'Log in to your account',
                body: 'Run this command. Your browser opens: log in and come back to the terminal.',
              },
              {
                title: 'Ask',
                body: 'Open Codex and ask, for example:',
              },
            ],
            note: 'Using the Codex or ChatGPT desktop app? Follow the **ChatGPT** tab.',
          },
          cursor: {
            steps: [
              {
                title: 'Add dForms to Cursor',
                body: 'With Cursor installed, click **Add to Cursor**. Or open **Customize → MCPs → New MCP Server**, choose **User** and paste this into `mcp.json`:',
              },
              {
                title: 'Log in to your account',
                body: '**dforms** shows up with **Needs authentication**. Click **Authenticate**, log in in the browser, click **Allow access** and then **Open Cursor**.',
              },
              {
                title: 'Ask',
                body: 'Open a **New Chat** and ask, for example. Cursor asks before it runs a tool: click **Run**.',
              },
            ],
          },
          openclaw: {
            steps: [
              {
                title: 'Add dForms to OpenClaw',
                body: 'In a terminal, save dForms as a remote MCP server that logs in with your account:',
              },
              {
                title: 'Log in to your account',
                body: 'Run this command. Your browser opens: log in and come back to the terminal. `openclaw mcp status --verbose` then shows dforms as authorized.',
              },
              {
                title: 'Ask',
                body: 'Ask your OpenClaw agent, for example:',
              },
            ],
          },
          hermes: {
            steps: [
              {
                title: 'Add dForms to Hermes',
                body: 'Open `~/.hermes/config.yaml` (or run `hermes config edit`) and add dForms under `mcp_servers`:',
              },
              {
                title: 'Log in to your account',
                body: 'Run this command. Your browser opens: log in and come back to the terminal. Then start a new session, or run `/reload-mcp` in the one you have open.',
              },
              {
                title: 'Ask',
                body: 'Ask your Hermes agent, for example:',
              },
            ],
          },
        },
        tip: '**One connector for every workspace.** If you have several, your AI app asks which one to use. To change, just say “switch to <workspace>”. Every answer says which workspace it used.',
        unavailableTitle: 'The connector is not available on this deployment',
        unavailableBody: 'This deployment’s MCP server does not take a sign-in yet, so AI apps cannot connect here. Ask whoever runs it to set `MCP_OAUTH_PROVIDER` and `MCP_PUBLIC_URL`.',
        media: {
          terminalLabel: 'Animation: how to connect dForms in {app}',
          play: 'Play the walkthrough',
          pause: 'Pause the walkthrough',
        },
        walkthrough: {
          ui: {
            ccWelcome: 'Welcome to Claude Code!',
            ccHelp: '/help for help, /status for your current setup',
            ccAdded: 'Added HTTP MCP server dforms with URL: {url} to user config',
            ccManage: 'Manage MCP servers',
            needsAuth: 'needs authentication',
            authenticate: 'Authenticate',
            ccBrowser: 'Opening your browser to authenticate…',
            ccAuthOk: 'Authentication successful. Connected to dforms.',
            codexAdded: "Added global MCP server 'dforms'.",
            codexAuthorize: 'Authorize dforms in your browser to continue.',
            codexLoggedIn: "Successfully logged in to MCP server 'dforms'.",
            codexModel: 'model: gpt-5-codex  directory: ~/studio',
            called: 'Called',
            working: 'Working',
            ocSaved: 'Saved MCP server "dforms" (streamable-http, auth: oauth).',
            ocLogin: 'Opening the browser to sign in to dforms…',
            ocLoggedIn: 'dforms: authorized. 49 tools available.',
            hmSaved: 'Saved. Run hermes mcp login dforms to sign in.',
            hmLogin: 'Opening your browser to authorize dforms…',
            hmLoggedIn: 'dforms: authorized. Tokens saved.',
          },
          signIn: {
            title: 'Log in to your account',
            emailLabel: 'Email',
            email: 'alex@example.com',
            continue: 'Continue with email',
            checkEmail: 'Check your email',
            codeSentTo: 'Enter the code sent to',
            noCode: 'Didn’t receive a code? You can request a new one in 30 seconds.',
            connected: 'dForms is connected to {app}',
            consentTitle: '{app} would like access to your account',
            redirectNote: 'After allowing access, you will be redirected to:',
            warning: 'This redirect points to an application running on your machine. Only allow access if you started this from {app}.',
            allow: 'Allow access',
            cancel: 'Cancel',
          },
          answer: {
            intro: 'Here are the forms in your workspace:',
            forms: [
              { name: 'Lead qualifier', stat: '128 responses' },
              { name: 'Launch RSVP', stat: '64 responses' },
              { name: 'Job application', stat: '23 responses' },
            ],
            colForm: 'Form',
            colResponses: 'Responses',
            colStatus: 'Status',
            live: 'Live',
          },
        },
        toolsTitle: 'What you can do with the MCP',
        toolsIntro: '{count} tools, the same things you do in the dashboard. Ask in your own words: your AI app picks the tool.',
        toolsLink: 'See every tool',
      },
      tools: {
        title: 'Tools',
        intro: 'Everything your agent can do in dForms once it is connected: {count} tools. You never call them yourself. Ask in your own words and your agent picks the right one.',
        askLabel: 'Ask:',
        count: '{n} tools',
        groups: {
          forms: { title: 'Forms', body: 'Create, edit, publish, revert, duplicate and delete forms, and change their link.' },
          responses: { title: 'Responses and CSV', body: 'List, search and read responses, open their files and export them to CSV.' },
          analytics: { title: 'Analytics', body: 'Views, starts, completions, drop-off by step and a summary of each form.' },
          folders: { title: 'Folders', body: 'Create, rename and delete folders, and move forms between them.' },
          brandKit: { title: 'Brand kit', body: 'Read and edit the brand kit and apply it to your forms.' },
          linkPage: { title: 'Link pages', body: 'Read, add and edit the workspace’s public pages with your forms and links.' },
          notifications: { title: 'Emails', body: 'Edit the notification emails of the workspace and of each form.' },
          integrations: { title: 'Integrations', body: 'Webhooks, HubSpot and Calendly: where responses go, tests and deliveries.' },
          account: { title: 'Account and workspaces', body: 'Who is connected, the workspaces you can work in and your profile.' },
        },
        items: {
          list_forms: { what: 'See every form in the workspace, with its link and status.', ask: 'Which forms do I have?' },
          get_form: { what: 'Open one form and read all its questions, logic and design.', ask: 'Show me the questions of my contact form' },
          get_form_guide: { what: 'Learn how dForms forms are built before creating one.', ask: 'How should a scored quiz be built in dForms?' },
          create_form: { what: 'Create a new form from a description, ready to share.', ask: 'Make a lead form for my studio with name, email and budget' },
          update_form: { what: 'Change questions, logic, scoring or design. It saves as a draft.', ask: 'Add a question about the deadline to my lead form' },
          publish_form: { what: 'Put the latest draft live.', ask: 'Publish my lead form' },
          revert_form: { what: 'Go back to the version that was live before.', ask: 'Undo the last publish of my survey' },
          discard_draft: { what: 'Throw away unpublished changes.', ask: 'Discard the draft changes in my RSVP form' },
          duplicate_form: { what: 'Make a copy of a form to start from.', ask: 'Duplicate my contact form' },
          delete_form: { what: 'Delete a form you no longer need.', ask: 'Delete the old test form' },
          set_form_slug: { what: 'Change the end of a form\'s link.', ask: 'Change my survey link to /feedback' },
          list_responses: { what: 'List the responses of a form, with filters by date, status or score.', ask: 'Show this week\'s responses to my lead form' },
          get_response: { what: 'Read one response in full.', ask: 'Show me the latest response in full' },
          get_response_file: { what: 'Open a file someone uploaded in a response.', ask: 'Open the CV the last candidate uploaded' },
          get_response_facets: { what: 'See how the answers to each question add up.', ask: 'How did people answer the budget question?' },
          search_answers: { what: 'Find responses that mention something.', ask: 'Find responses that mention HubSpot' },
          export_responses_csv: { what: 'Download responses as a CSV file.', ask: 'Export this month\'s responses to CSV' },
          delete_response: { what: 'Delete one response.', ask: 'Delete the test response I sent' },
          delete_responses: { what: 'Delete several responses at once.', ask: 'Delete every response from last week\'s test' },
          get_form_analytics: { what: 'Views, starts, completions and drop-off by step.', ask: 'Where are people dropping off in my signup form?' },
          get_form_summary: { what: 'A short summary of how a form is doing.', ask: 'How is my lead form doing this week?' },
          list_folders: { what: 'See your folders and what is in them.', ask: 'What folders do I have?' },
          create_folder: { what: 'Create a folder to group forms.', ask: 'Create a folder called Clients' },
          rename_folder: { what: 'Rename a folder.', ask: 'Rename the Clients folder to Customers' },
          delete_folder: { what: 'Delete a folder. Its forms stay.', ask: 'Delete the Old folder' },
          move_form: { what: 'Move a form into a folder.', ask: 'Move my RSVP form to the Events folder' },
          get_brand_kit: { what: 'Read the workspace\'s logo, colors and fonts.', ask: 'What colors does my brand kit use?' },
          update_brand_kit: { what: 'Change the brand kit.', ask: 'Make my brand color green' },
          apply_brand_kit: { what: 'Apply the brand kit to a form.', ask: 'Apply my brand kit to the survey' },
          revert_brand_kit: { what: 'Take a form back to the design it had before the brand kit.', ask: 'Undo the brand kit on my survey' },
          get_link_page: { what: 'Read one of the workspace’s public pages (the default one unless you name another): its buttons, socials and link.', ask: 'What does my workspace page show?' },
          update_link_page: { what: 'Edit, rename, publish or delete a public page, or make it the default.', ask: 'Add my contact form to the workspace page and publish it' },
          list_link_pages: { what: 'List the workspace’s public pages with their links and whether each is live.', ask: 'Which link pages does my workspace have?' },
          create_link_page: { what: 'Add a public page, for an event, a channel or a country.', ask: 'Create a page for Expo 2026 with my demo form' },
          duplicate_link_page: { what: 'Copy a page under a new address, unpublished.', ask: 'Copy my Expo page for next year’s fair' },
          delete_link_page: { what: 'Delete a page that is not the default.', ask: 'Delete the old Expo page' },
          list_notifications: { what: 'See the workspace\'s notification emails.', ask: 'Which emails does dForms send?' },
          update_notification: { what: 'Edit a notification email for the whole workspace.', ask: 'Change the subject of the new response email' },
          reset_notification: { what: 'Put a workspace email back to its default.', ask: 'Reset the new response email' },
          list_form_notifications: { what: 'See the emails one form sends.', ask: 'Which emails does my lead form send?' },
          update_form_notification: { what: 'Edit an email for one form.', ask: 'Send the lead form notices to sales@example.com' },
          reset_form_notification: { what: 'Put a form\'s email back to the workspace default.', ask: 'Reset the emails of my survey' },
          list_integrations: { what: 'See which apps are connected, like HubSpot or Calendly.', ask: 'Is HubSpot connected?' },
          set_destinations: { what: 'Choose where a form\'s responses go: webhooks or HubSpot.', ask: 'Send every lead from my form to HubSpot' },
          list_webhooks: { what: 'See a form\'s webhooks.', ask: 'Which webhooks does my lead form have?' },
          ping_webhook: { what: 'Send a test to a webhook.', ask: 'Test the webhook of my lead form' },
          list_deliveries: { what: 'See which responses were delivered and which failed.', ask: 'Did my last responses reach HubSpot?' },
          list_hubspot_properties: { what: 'See the HubSpot fields a question can fill.', ask: 'Which HubSpot fields can I map?' },
          list_calendly_event_types: { what: 'See the Calendly events a form can book.', ask: 'Which Calendly events can my form book?' },
          whoami: { what: 'Check who is connected and in which workspace.', ask: 'Who am I connected as?' },
          list_my_workspaces: { what: 'See every workspace you can work in.', ask: 'Which workspaces can I use?' },
          get_my_profile: { what: 'Read your profile and public page.', ask: 'What is my public page link?' },
          get_workspace_link_code: { what: 'Get the code that links the workspace to other apps.', ask: 'Give me the workspace link code' },
        },
        connectCta: 'Connect your agent',
      },
    },
    apiDocs: {
      title: 'API docs',
      subtitle: 'Every call an API key can make, with its parameters, a curl example and the answer it gets.',
      toc: {
        label: 'On this page',
        jumpLabel: 'Go to',
        gettingStarted: 'Getting started',
        errors: 'Errors',
        limits: 'Limits',
        reference: 'Reference',
        notAllowed: 'What a key cannot do',
      },
      search: {
        label: 'Search endpoints',
        placeholder: 'Search by path or description',
        empty: 'No endpoint matches “{query}”.',
        clear: 'Clear search',
      },
      errors: {
        title: 'Errors',
        intro:
          'Every error is JSON with a stable `error` code and an English `message`. Read the code, not the message: the code never changes.',
        exampleTitle: 'A validation error',
        issuesBody:
          'A `400` lists every problem in `issues[]`, not only the first, so you can fix them all in one go. Each `path` is the field’s dot path inside the body you sent, with array positions as numbers: `config.steps.1.question` is the question of the second step. `message` repeats the first issue.',
        codesTitle: 'Error codes',
        colStatus: 'Status',
        colCode: 'Code',
        colMeaning: 'What to do',
        codes: {
          BAD_REQUEST: 'Read `issues[]`, fix every entry and send the request again.',
          STEPS_REQUIRED: 'A `PUT /v1/forms/{id}` config without `steps`. Send the full `steps` array.',
          INVALID_API_KEY:
            'The key is unknown or revoked, or the person who created it is no longer in the workspace. Create a new key.',
          KEY_NOT_ALLOWED: 'This route works only in the dashboard. Do it in dForms.',
          WORKSPACE_FORBIDDEN: 'You sent a workspace header for another workspace. Drop the header: the key already picks the workspace.',
          FORBIDDEN:
            'The person who owns the key lacks the role. Brand kit writes, notifications and the webhook test need an owner or admin.',
          NOT_FOUND: 'The id is wrong or belongs to another workspace. List again.',
          STALE:
            'The form changed since you read it. The body carries `current`, the form as it is now: apply your change on top of it and retry with its `updatedAt`.',
          NOTHING_TO_REVERT: 'The form has no earlier published version to go back to.',
          SLUG_TAKEN: 'Another form already uses that slug. Pick another one.',
          SLUG_INVALID: 'Use lowercase letters, numbers and hyphens only.',
          NAME_TAKEN: 'A folder with that name already exists.',
          RATE_LIMITED: 'Too many requests. Wait the seconds in the `Retry-After` header (also `retryAfterSec` in the body), then continue.',
        },
        issueCodesTitle: 'Codes inside issues[]',
        issueCodes: {
          UNSUPPORTED_FIELD:
            'A field the editor cannot show, or a value other than the one the editor writes itself. Remove it, or send back the value you read.',
          EMPTY_QUESTION: 'A step without `question` text. Only `reveal`, `message` and `scheduler` steps may go without one.',
          STEPS_REQUIRED: 'A config without `steps` on an edit. Send every step, not only the ones you changed.',
        },
      },
      limits: {
        title: 'Limits',
        rate: '{count} requests per minute, per key',
        rateBody:
          'Past that, the API answers `429` with a `Retry-After` header. Wait that many seconds and continue; nothing you sent before is lost.',
        keys: '{count} active keys per person, per workspace',
        keysBody: 'Revoke a key you no longer use to make room for a new one. Revoked keys stop working at once.',
      },
      reference: {
        title: 'Reference',
        intro:
          'Paths are relative to the API URL above. Every request carries `Authorization: Bearer $DFORMS_API_KEY`, bodies are JSON and times are epoch milliseconds.',
        adminOnly: 'Owner or admin',
        adminOnlyHint: 'Needs a key created by an owner or admin of the workspace. Anyone else gets `403 FORBIDDEN`.',
        destructive: 'Deletes data',
        destructiveHint: 'Cannot be undone. An agent should ask the person before calling it.',
        params: 'Parameters',
        colName: 'Name',
        colDescription: 'Description',
        required: 'Required',
        in: { path: 'Path', query: 'Query', body: 'Body' },
        request: 'Request',
        response: 'Response {status}',
        noContent: 'No content.',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Could not copy',
        anchorLabel: 'Link to {route}',
      },
      areas: {
        forms: {
          title: 'Forms',
          intro: 'Create, read, edit, publish, revert, rename, copy, file and delete forms.',
        },
        folders: { title: 'Folders', intro: 'Group forms in folders. Deleting a folder keeps its forms.' },
        destinations: {
          title: 'Destinations',
          intro: 'Where each response goes besides dForms: webhooks and HubSpot. They take effect at once, without publishing.',
        },
        responses: {
          title: 'Responses',
          intro: 'Read, filter, export and delete a form’s responses, and see the deliveries that failed.',
        },
        analytics: {
          title: 'Analytics',
          intro: 'The funnel of a form, and a breakdown of the answers to each question.',
        },
        branding: {
          title: 'Brand kit',
          intro: 'The workspace’s logo, colours and type, and applying them to forms.',
        },
        linkPage: {
          title: 'Link pages',
          intro: 'The workspace’s public pages, up to 20: the default one at `/{accountCode}`, the others at `/{accountCode}/p/{slug}`. Each holds its forms and links in one place. Any member can read and edit them.',
        },
        notifications: {
          title: 'Notifications',
          intro: 'The emails dForms sends on each response, for the whole workspace or for one form.',
        },
        integrations: {
          title: 'Integrations (read only)',
          intro: 'What is connected and what a destination or a scheduler step can point at. Connecting stays in the dashboard.',
        },
        identity: {
          title: 'Identity',
          intro: 'Who the key acts as. Call `GET /v1/me` first to check a key.',
        },
      },
      endpoints: {
        'GET /v1/forms':
          'Lists the workspace’s forms, most recently updated first, with their `publicUrl` and `editorUrl`.',
        'POST /v1/forms':
          'Creates a form. The config is live at once. It is not idempotent: if a call fails or times out, list the forms before you try again.',
        'GET /v1/forms/:id':
          'One form: the live `config`, the pending `draftConfig` (or `null`), when it was published and the stamp to send back as `expectedUpdatedAt`.',
        'PUT /v1/forms/:id':
          'Saves a new config as a draft; the public form does not change until you publish. The config replaces the whole draft, so send every step.',
        'POST /v1/forms/:id/publish': 'Makes the draft live. With no draft pending, it answers the form unchanged.',
        'POST /v1/forms/:id/discard-draft':
          'Throws away the pending draft, so the form goes back to its live config. What the public sees does not change. With no draft pending, it answers the form unchanged.',
        'POST /v1/forms/:id/revert':
          'Puts the previously published version back live. Calling it again undoes the revert. The pending draft and the destinations stay as they are.',
        'PUT /v1/forms/:id/slug':
          'Changes the last part of the public URL. The old slug keeps redirecting to the form.',
        'POST /v1/forms/:id/duplicate': 'Copies a form, with its config, into a new form.',
        'PATCH /v1/forms/:id/folder': 'Files a form in a folder, or takes it out with `null`.',
        'DELETE /v1/forms/:id': 'Deletes a form and its responses.',
        'GET /v1/folders': 'Lists the folders, in alphabetical order.',
        'POST /v1/folders': 'Creates a folder.',
        'PATCH /v1/folders/:id': 'Renames a folder.',
        'DELETE /v1/folders/:id': 'Deletes a folder. Its forms are kept, outside any folder.',
        'PUT /v1/forms/:id/destinations':
          'Replaces the form’s destinations (webhooks and HubSpot). Takes effect at once, without publishing.',
        'POST /v1/forms/:id/destinations/webhook/ping':
          'Sends a test event to the form’s webhook and tells you how the endpoint answered.',
        'GET /v1/forms/:id/submissions':
          'A page of responses under the filters you pass, with the `total` to page through them.',
        'GET /v1/forms/:id/submissions/:submissionId': 'One response with all its answers.',
        'GET /v1/forms/:id/submissions/:submissionId/files/:stepKey':
          'Short-lived links to download an uploaded file, and to show it in place when its type allows it.',
        'GET /v1/forms/:id/submissions.csv':
          'Every response under the filters as a CSV for a spreadsheet: one column per question, option labels instead of values. Not paginated.',
        'POST /v1/forms/:id/submissions/bulk-delete': 'Deletes several responses of a form at once.',
        'DELETE /v1/submissions/:id': 'Deletes one response.',
        'GET /v1/forms/:id/deliveries':
          'The deliveries to the form’s destinations. Only the failed ones unless you ask for other statuses.',
        'GET /v1/forms/:id/analytics':
          'The funnel: views, starts, completions, completion rate, time to complete, drop-off per step and a point per day.',
        'GET /v1/forms/:id/summary':
          'One card per question: how many picked each option, and the latest written answers. Takes the response filters.',
        'GET /v1/forms/:id/submissions-facets':
          'How many responses there are, completed and partial, and how many picked each option, before any filter.',
        'GET /v1/forms/:id/summary/:stepKey/answers': 'Searches the answers to one written question, newest first.',
        'GET /v1/branding': 'The workspace brand kit.',
        'PUT /v1/branding':
          'Replaces the brand kit. New forms take it at once; existing forms only when you apply it.',
        'POST /v1/branding/apply': 'Applies the brand kit to the forms you name.',
        'POST /v1/branding/revert': 'Puts back the look the forms had before the brand kit was applied.',
        'GET /v1/link-page': 'The default page (`page`, null when there is none) with its `id` and `slug`, the workspace’s forms and brand kit, the page’s `publicUrl` and whether it is `live`. A stored WhatsApp number comes back as digits; send it back with a leading `+`.',
        'PUT /v1/link-page': 'Replaces the whole default page: read it first and send it back complete. Colors and type come from the brand kit unless the page sets its own `colors`. `{ "page": null }` deletes the page and its URL answers 404 again, when it is the workspace’s only page.',
        'GET /v1/link-pages': 'Every page of the workspace, the default first: its `id`, `slug`, internal `name`, whether it is the default and `live`, how many `buttons` it holds and its `publicUrl`.',
        'POST /v1/link-pages': 'Adds a page, up to 20 per workspace. Without a `slug` one is made from the name; without a `page` it starts empty and unpublished. The workspace’s first page becomes its default.',
        'GET /v1/link-pages/:id': 'One page, with the workspace’s forms and brand kit, its `publicUrl` and whether it is `live`.',
        'PUT /v1/link-pages/:id': 'Changes a page. Only the fields sent change; `page` replaces the whole content. A new `slug` keeps the old address redirecting to the new one. `isDefault: true` makes it the page at `/{accountCode}`.',
        'POST /v1/link-pages/:id/duplicate': 'Copies a page under a new slug, unpublished, so it can be edited for the next event before it goes live.',
        'DELETE /v1/link-pages/:id': 'Deletes a page; its address answers 404. The default page answers 409 `DEFAULT_PAGE`: make another page the default first.',
        'GET /v1/notifications':
          'The two emails dForms sends on each response: the notice to your team and the receipt to the person who answered.',
        'PUT /v1/notifications/:emailKey': 'Turns an email on or off, changes its text or who gets the notice.',
        'POST /v1/notifications/:emailKey/reset': 'Puts an email’s subject and body back to the default text.',
        'GET /v1/forms/:id/notifications': 'The same two emails for one form: the workspace setting and the form’s own, if any.',
        'PUT /v1/forms/:id/notifications/:emailKey': 'Gives one form its own version of an email.',
        'POST /v1/forms/:id/notifications/:emailKey/reset':
          'Removes the form’s own version, so it follows the workspace setting again.',
        'GET /v1/integrations': 'Which integrations the workspace has connected. Never returns a token.',
        'GET /v1/integrations/webhooks': 'Every webhook the workspace’s forms send to, with its recent failures.',
        'GET /v1/integrations/hubspot/properties': 'The HubSpot contact properties a destination can map answers to.',
        'GET /v1/integrations/calendly/event-types': 'The Calendly event types a scheduler step can book.',
        'GET /v1/me': 'The person and the workspace the key acts as, with the person’s role.',
        'GET /v1/me/profile': 'The person’s public page, if they set one up.',
        'GET /v1/vanity': 'The workspace’s public code and its custom one, if it claimed one.',
      },
      params: {
        formId: 'The form’s `id`, from `GET /v1/forms` or the answer that created it.',
        folderPathId: 'The folder’s `id`, from `GET /v1/folders`.',
        submissionPathId: 'The response’s `id`, from the response list.',
        submissionDeleteId: 'The response’s `id`, from the response list.',
        fileStepKey: 'The `key` of the file upload question.',
        textStepKey: 'The `key` of a written question (short or long text, name, email, phone or URL).',
        emailKey: '`submission_received` is the notice to your team; `submission_confirmed`, the receipt to the person who answered.',
        formName: 'The form’s name in the dashboard, 1 to 200 characters.',
        formSlug: 'The last part of the public URL. Made from the name when you leave it out.',
        formConfig:
          'The form itself: `version: 1`, the `steps`, and optionally the cover, scoring, outcomes and branding. Only fields the editor can show are accepted.',
        formFolderId: 'The folder to file the new form in.',
        formConfigEdit: 'The whole config, with every step. It replaces the draft; the steps you leave out are deleted.',
        formNameEdit: 'A new name. Applies at once, without publishing.',
        expectedUpdatedAt:
          'The form’s `updatedAt` as you read it. If someone saved the form since, you get `409 STALE` instead of overwriting their work.',
        newSlug: 'The new slug: lowercase letters, numbers and hyphens, up to 80 characters.',
        fileFolderId: 'The folder’s `id`, or `null` to take the form out of its folder.',
        folderName: 'The folder’s name, 1 to 80 characters, unique in the workspace.',
        destinations:
          'Every destination of the form, each a `webhook` or a `hubspot` one. The list replaces the current one; at most one HubSpot destination per form.',
        status: '`all` (the default), `completed` or `partial`.',
        from: 'Responses started from this day on: `YYYY-MM-DD` in the workspace’s time zone, or epoch ms.',
        to: 'Responses started up to this day: `YYYY-MM-DD` (the whole day) or epoch ms.',
        scoreMin: 'Lowest score, inclusive. Ignored when the form does not score.',
        scoreMax: 'Highest score, inclusive. Ignored when the form does not score.',
        answers: 'Choice answers to filter by, as JSON: `{"step_key": ["value"]}`. URL-encode it.',
        search: 'Free text, searched in the written answers.',
        sort: '`newest` (the default), `oldest`, `score_desc` or `score_asc`.',
        limit: 'Responses per page, up to 200.',
        offset: 'How many responses to skip, for the next page.',
        csvIds: 'Only these responses, by `id`, separated by commas.',
        submissionIds: 'The `id`s of the responses to delete.',
        deliveryStatus: 'Statuses to include, separated by commas: `failed` (the default), `done`, `pending` or `skipped`.',
        deliveryKind: 'Kinds to include, separated by commas, such as `webhook`, `hubspot` or `email`.',
        deliveryLimit: 'How many deliveries to return. 50 by default.',
        tz: 'An IANA time zone (`America/Bogota`) to count days in. The workspace’s by default.',
        q: 'Text to look for anywhere in the answer. Leave it out to list them all.',
        answersLimit: 'Answers per page, up to 50.',
        brandLogo: 'The logo, as an https URL. `null` removes it.',
        brandPrimaryColor: 'The colour of buttons and highlights.',
        brandBackground: 'The page background. Setting it fixes the form to a light or dark look.',
        brandForeground: 'The text colour.',
        brandFontFamily: 'The typeface: `figtree`, `poppins`, `inter`, `dm-sans`, `space-grotesk`, `manrope`, `work-sans`, `fraunces` or `playfair`.',
        brandRadius: 'How rounded the corners are.',
        brandButtonStyle: 'How buttons are drawn.',
        brandClientLogos: 'Logos of your clients to show on the cover, up to 24.',
        formIds: 'The `id`s of the forms, 1 to 500.',
        linkPage: 'The whole page with `version: 1`, or `null` to delete it.',
        linkPageEnabled: 'Live at the public URL. `false` (the default) answers 404 there.',
        linkPageName: 'The heading, up to 80 characters. Blank or absent shows the workspace name.',
        linkPageBio: 'A line under the heading, up to 280 characters.',
        linkPageLogo: 'Absent uses the brand kit logo, `null` shows none, an http(s) URL shows that image.',
        linkPageItems: 'The buttons, in order, up to 30: `{ "type": "form", "formId" }` or `{ "type": "link", "label", "url" }`. A form of another workspace is dropped.',
        linkPageSocials: '`instagram`, `x`, `youtube` and `tiktok` (a link or a handle) and `whatsapp` (the number with its country code, starting with `+`).',
        linkPageColors: 'This page’s own `primaryColor`, `background` and `foreground`, as hex. An absent one takes the brand kit’s.',
        linkPagePathId: 'The page’s `id`, from `GET /v1/link-pages`.',
        linkPagePageName: 'An internal name to tell pages apart, up to 80 characters. Visitors never see it.',
        linkPageSlug: 'The address after `/p/`: 3 to 30 lowercase letters, numbers or hyphens. Unique in the workspace.',
        linkPageIsDefault: '`true` makes this the page at `/{accountCode}`; the previous default keeps its `/p/` address. Only a published page can be the default (409 `PAGE_NOT_PUBLISHED`).',
        linkPageContent: 'The whole page content, the same shape `PUT /v1/link-page` takes.',
        linkPageCopyName: 'The copy’s internal name. Absent keeps the original’s.',
        linkPageCopySlug: 'The copy’s slug. Absent takes the original’s with `-2`, `-3` and so on.',
        notificationEnabled: 'Whether the email is sent.',
        notificationSubject: 'The subject, with `{{token}}` markers such as `{{formName}}`. `null` puts the default back.',
        notificationBody: 'The body as plain text, with `{{token}}` markers. `null` puts the default back.',
        notificationRecipients:
          'Who gets the notice to your team. Not accepted on `submission_confirmed`, which goes to the person who answered.',
      },
      notAllowed: {
        title: 'What a key cannot do',
        intro:
          'These stay in the dashboard, for a person signed in. With a key they answer `403 KEY_NOT_ALLOWED`.',
        items: {
          keys: 'Create, list or revoke API keys.',
          members: 'Invite, change or remove members, or resend invitations.',
          workspaces: 'Create, rename or switch workspaces, or change their time zone.',
          onboarding: 'Answer the onboarding questions.',
          profile: 'Change your public page, your language or the workspace’s custom public code.',
          integrations: 'Connect or disconnect HubSpot or Calendly.',
        },
      },
    },
    publish: {
      publish: 'Publish',
      publishing: 'Publishing…',
      published: 'Changes published. Your form is live.',
      publishError: 'Could not publish. Please try again.',
      saveFirst: 'Your latest changes could not be saved, so nothing was published. Try again once they save.',
      unpublishedChanges: 'Unpublished changes',
      noChanges: 'All changes are published',
      moreOptions: 'Publish options',
      revert: 'Revert to the previous published version',
      revertAvailable: 'Published on {date}',
      revertUnavailable: 'No earlier published version yet',
      revertTitle: 'Revert to the previous published version?',
      revertBody:
        'The version published on {date} goes live again, and the one live now becomes the previous version, so you can undo this. Your draft does not change.',
      revertConfirm: 'Revert',
      reverting: 'Reverting…',
      reverted: 'The previous version is live again.',
      revertError: 'Could not revert. Please try again.',
      revertSaveFirst: 'Your latest changes could not be saved, so nothing was reverted. Try again once they save.',
      nothingToRevert: 'There is no earlier published version to go back to.',
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
    deleteFolderTitle: 'Delete folder',
    deleteQuestionTitle: 'Delete question',
    deleteSubmissionTitle: 'Delete submission',
    removeMemberTitle: 'Remove member',
    resetEmailTitle: 'Reset email template',
    disconnectIntegrationTitle: 'Disconnect {provider}',
  },
};

export const es: FormsMessages = {
  growth: {
    madeWith: 'Hecho con dForms',
    ctaQuestion: '¿Quieres tu propio formulario?',
    ctaAction: 'Consigue dForms, gratis',
    emailCtaAction: 'Crea tu formulario gratis',
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
    ctaAction: 'Consigue dForms, gratis',
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
    errorTitle: 'Esta página no cargó',
    errorBody: 'Algo falló al conectar con el servicio de formularios.',
    errorRetry: 'Intentar de nuevo',
    notFoundTitle: 'No encontrado',
    notFoundBody: 'Esta página no existe.',
    notFoundHome: 'Ir al inicio',
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
      url: 'Introduce una dirección web válida.',
      phone: 'Introduce un número de teléfono válido.',
      number: 'Introduce un número.',
      too_low: 'El valor es muy bajo.',
      too_high: 'El valor es muy alto.',
      too_short: 'Tu respuesta es muy corta.',
      too_long: 'Tu respuesta es muy larga.',
      option: 'Elige una de las opciones disponibles.',
      file: 'Sube un archivo para continuar.',
      submit: 'No se pudo enviar. Inténtalo de nuevo.',
      captcha: 'No pudimos verificar que eres una persona. Inténtalo de nuevo.',
      captcha_required:
        'Este formulario ahora verifica que eres una persona. Recarga la página y vuelve a enviar tus respuestas.',
      rate_limited: 'Demasiados intentos desde tu conexión. Espera un momento e inténtalo de nuevo.',
      answer_too_long: 'Una de tus respuestas es más larga de lo que permite este formulario. Acórtala e inténtalo de nuevo.',
      invalid_answers: 'Faltan respuestas o alguna ya no coincide con este formulario. Recarga la página e inténtalo de nuevo.',
    },
    captcha: {
      prompt: 'Confirma que eres una persona para enviar tus respuestas.',
      unavailable:
        'No pudimos completar la verificación de seguridad. Tus respuestas quedaron guardadas. Inténtalo de nuevo.',
      retry: 'Reintentar',
    },
    charCounter: {
      characters: '{count} caracteres',
      minimum: 'mínimo {min}',
    },
    phonePicker: {
      countryLabel: 'Selecciona el código de país',
      search: 'Busca país o código',
      noResults: 'No se encontraron países',
      invalid: 'Introduce un número de teléfono válido.',
    },
    upload: {
      choose: 'Elige un archivo',
      accepts: '{types}, hasta {max} MB',
      uploading: 'Subiendo {percent}%',
      remove: 'Quitar',
      failed: 'La subida no terminó.',
      retry: 'Intenta de nuevo',
      tooLarge: 'Ese archivo pesa más de {max} MB.',
      wrongType: 'Ese tipo de archivo no se acepta aquí.',
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
  linkPage: {
    buttonsLabel: 'Enlaces',
    socialsLabel: 'Redes sociales',
    social: { instagram: 'Instagram', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', whatsapp: 'WhatsApp' },
    seoDescription: 'Formularios y enlaces de {name}.',
  },
  admin: {
    linkPage: {
      heading: 'La página de tu workspace',
      subtitle: 'Una página con tu logo, tus formularios y tus enlaces, en un link que puedes compartir o imprimir como código QR.',
      anyMember: 'Cualquier persona de este workspace puede editar esta página.',
      enable: 'Publicada',
      offNote: 'Sin publicar. Quien la visite verá una página no encontrada hasta que la actives.',
      copy: 'Copiar link',
      copied: 'Copiado',
      open: 'Abrir',
      qr: 'Código QR',
      qrTitle: 'Código QR de tu página',
      qrIntro: 'Imprímelo en una tarjeta, un banner o tu stand. Al escanearlo se abre esta página.',
      qrAlt: 'Código QR que abre la página de tu workspace',
      qrDownloadPng: 'Descargar PNG',
      qrDownloadSvg: 'Descargar SVG',
      qrPngFailed: 'No se pudo crear el PNG en este navegador. Descarga el SVG.',
      headerSection: 'Encabezado',
      logo: 'Foto o logo',
      logoHint: 'Se muestra arriba en la página y en la vista previa del link.',
      logoUpload: 'Subir imagen',
      logoUseKit: 'Usar el logo del brand kit',
      logoNone: 'Sin logo',
      logoFromKit: 'Del brand kit.',
      logoNoKit: 'Tu brand kit no tiene logo, así que se muestran tus iniciales.',
      logoInitials: 'Sin logo: se muestran tus iniciales.',
      logoUrl: 'O pega el link de una imagen',
      logoUrlPlaceholder: 'https://example.com/logo.png',
      logoInvalid: 'Usa una imagen PNG, JPEG, WebP o GIF, o un link que empiece por https://.',
      logoTooBig: 'La imagen sigue siendo muy grande después de reducirla. Prueba con una más pequeña.',
      name: 'Nombre',
      bio: 'Bio',
      bioPlaceholder: 'Una línea sobre lo que haces.',
      buttonsSection: 'Botones',
      buttonsHint: 'Tus formularios y enlaces, en el orden en que salen en la página.',
      addForm: 'Agregar un formulario',
      addFormPlaceholder: 'Elige un formulario',
      addLink: 'Agregar un enlace',
      noForms: 'Este workspace todavía no tiene formularios.',
      allFormsAdded: 'Todos los formularios ya están en la página.',
      empty: 'Todavía no hay botones. Agrega un formulario o un enlace.',
      formTag: 'Formulario',
      linkTag: 'Enlace',
      linkLabel: 'Texto',
      linkLabelPlaceholder: 'Nuestro sitio web',
      linkUrl: 'URL',
      linkUrlPlaceholder: 'https://example.com',
      linkInvalid: 'Ponle un texto al enlace y una URL completa que empiece por https://.',
      moveUp: 'Subir',
      moveDown: 'Bajar',
      remove: 'Quitar',
      maxItems: 'Una página admite hasta {max} botones.',
      socialsSection: 'Redes sociales',
      socialsHint: 'Solo salen en la página las que llenes. Cada una se abre en una pestaña nueva.',
      socialPlaceholders: {
        instagram: 'instagram.com/tumarca',
        x: 'x.com/tumarca',
        youtube: 'youtube.com/@tumarca',
        tiktok: 'tiktok.com/@tumarca',
        whatsapp: '+57 300 123 4567',
      },
      socialInvalid: 'Escribe un link o un usuario de {network}, como @tumarca.',
      whatsappInvalid: 'Agrega el código de país al inicio, con un +, como +57 300 123 4567.',
      whatsappHint: 'Quien la visite abre un chat de WhatsApp con este número.',
      preview: 'Vista previa',
      save: 'Guardar',
      saving: 'Guardando…',
      saved: 'Página guardada.',
      error: 'No se pudo guardar la página.',
      fixErrors: 'Primero corrige los campos marcados.',
      back: 'Todas las páginas',
      pageSection: 'Página',
      pageName: 'Nombre interno',
      pageNameHint: 'Para distinguir tus páginas. Los visitantes no lo ven.',
      pageNamePlaceholder: 'Expo 2026',
      slug: 'Dirección',
      slugHint: 'La página queda en {base}/ seguido de esto.',
      slugInvalid: 'Usa de 3 a 30 letras minúsculas, números o guiones sueltos, empezando y terminando con una letra o un número.',
      slugReserved: 'Esa dirección está reservada. Elige otra.',
      slugTaken: 'Otra de tus páginas ya usa esa dirección.',
      defaultBadge: 'Página principal',
      defaultHint: 'Esta es tu página principal: se abre en {url}.',
      makeDefault: 'Hacer página principal',
      madeDefault: 'Ahora esta es tu página principal.',
      makeDefaultNeedsPublish: 'Primero publica esta página. Tu página principal se abre en el link de tu workspace, así que tiene que estar publicada.',
      colorsSection: 'Colores',
      colorsHint: 'Por defecto la página usa tu brand kit. Elige un color aquí para usar otro solo en esta página.',
      colorPrimary: 'Botones',
      colorBackground: 'Fondo',
      colorForeground: 'Texto',
      colorFromKit: 'Del brand kit',
      colorReset: 'Usar el brand kit',
    },
    linkPages: {
      heading: 'Las páginas de tu workspace',
      subtitle: 'Páginas con tu logo, tus formularios y tus enlaces: una por evento, canal o país, cada una con su propio link y código QR.',
      anyMember: 'Cualquier persona de este workspace puede crear y editar estas páginas.',
      newPage: 'Nueva página',
      count: '{n} de {max} páginas',
      limitReached: 'Un workspace admite hasta {max} páginas. Borra una para agregar otra.',
      emptyTitle: 'Todavía no hay páginas',
      emptyBody: 'Crea una página para compartir tus formularios y enlaces desde un solo lugar, con su propio link y código QR.',
      defaultName: 'Página principal',
      defaultBadge: 'Principal',
      live: 'Publicada',
      off: 'Sin publicar',
      toggleLabel: 'Publicar {name}',
      buttons: '{n} botones',
      buttonsOne: '1 botón',
      edited: 'Editada {date}',
      edit: 'Editar',
      duplicate: 'Duplicar',
      duplicated: 'Página duplicada. La copia todavía no está publicada.',
      copyName: '{name} (copia)',
      copyLink: 'Copiar link',
      copied: 'Copiado',
      qr: 'Código QR',
      makeDefault: 'Hacer página principal',
      madeDefault: 'Ahora esta es tu página principal.',
      makeDefaultNeedsPublish: 'Primero publica esta página. Tu página principal se abre en el link de tu workspace, así que tiene que estar publicada.',
      remove: 'Borrar',
      removeTitle: '¿Borrar esta página?',
      removeBody: '«{name}» y su link dejan de funcionar, incluidos los códigos QR impresos. No se puede deshacer.',
      removeConfirm: 'Borrar página',
      removed: 'Página borrada.',
      cannotRemoveDefault: 'Tu página principal no se puede borrar. Primero haz principal otra página.',
      published: 'Página publicada.',
      unpublished: 'Página despublicada.',
      createTitle: 'Nueva página',
      createName: 'Nombre interno',
      createNamePlaceholder: 'Expo 2026',
      createSlug: 'Dirección',
      create: 'Crear página',
      creating: 'Creando…',
      cancel: 'Cancelar',
      error: 'Algo salió mal. Inténtalo de nuevo.',
    },
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
      timezoneAutoSet: 'Zona horaria del workspace fijada en {zone}. Cámbiala en Ajustes de cuenta o en la página de respuestas.',
      expand: 'Expandir barra lateral',
      openNav: 'Abrir navegación',
      theme: {
        label: 'Tema',
        dark: 'Oscuro',
        light: 'Claro',
        next: 'Cambiar a',
      },
      docsHref: 'https://docs.dapta.ai/dapta-docs-es/dapta-forms/forms',
      nav: {
        home: 'Inicio',
        forms: 'Formularios',
        submissions: 'Respuestas',
        analytics: 'Analíticas',
        integrations: 'Integraciones',
        developers: 'Conecta tu agente',
        tools: 'Herramientas',
        docs: 'Documentación',
        agents: 'Agentes de ventas con IA',
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
        dapta: 'Agentes de ventas con IA',
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
        searchClear: 'Limpiar búsqueda',
        staff: 'Staff',
        estate: 'Todos los workspaces',
        hintForm: 'Formulario: {name}',
      },
    },
    home: {
      welcome: 'Bienvenido',
      welcomeNamed: 'Bienvenido, {name}',
      subtitle: 'Tus formularios de un vistazo.',
      publicLink: 'Tu página pública',
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
      recent: 'Actividad reciente',
      viewAll: 'Ver todos',
      shortcuts: 'Accesos',
      noSubmissions: 'Sin respuestas',
      statCompletionNote: 'de quienes empiezan',
      publicPageDesc: 'Los formularios que quieres que encuentren.',
      colUpdated: 'Actualizado',
      agentBanner: {
        title: 'Controla tus formularios, la lógica y el diseño desde tu agente de IA',
        body: 'Conecta Claude, ChatGPT, Claude Code, Codex, Cursor, OpenClaw o Hermes con tu cuenta. Sin llave de API.',
        cta: 'Conecta tu agente',
      },
      agentCard: {
        eyebrow: 'Hecho para agentes',
        title: 'Conecta tu agente',
        body: 'Pide con tus palabras. Tu agente crea el formulario, arma la lógica y el diseño, lo publica y lee cada respuesta.',
        cta: 'Conecta tu agente',
        label: 'Un agente de IA creando un formulario de dForms a partir de un prompt',
        prompts: [
          'Conéctate al MCP de dForms y hazme un formulario que filtre los mejores proyectos para mi agencia.',
          'Haz un formulario de leads para mi estudio y deja que agende una llamada todo el que tenga más de $5k de presupuesto.',
          'Crea un formulario de postulación a un empleo y puntúa a los candidatos por años de experiencia.',
          'Crea un formulario de confirmación de asistencia para nuestro lanzamiento y dame un código QR para la entrada.',
          'Manda cada lead nuevo de mi formulario de contacto a HubSpot, con el puntaje.',
          '¿Qué pregunta le está costando más respuestas a mi formulario de registro esta semana?',
        ],
        done: 'Listo. Ya está publicado en dForms.',
        placeholder: 'Pregúntale a {app}…',
        connected: 'dForms conectado',
      },
    },
    brandKit: {
      title: 'Kit de marca',
      subtitle:
        'Los formularios nuevos nacen con él. Puedes aplicarlo a los que ya existen.',
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
      notSetShort: 'Sin definir',
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
      workspaceTimezone: 'Zona horaria del workspace',
      workspaceTimezoneHelp:
        'La comparten todos en este workspace. Cada fecha del panel, los cortes por día de las analíticas y las columnas locales del CSV se leen en esta zona.',
      workspaceTimezoneSaved: 'Zona horaria del workspace guardada.',
      workspaceTimezoneError: 'No se pudo guardar la zona horaria. Inténtalo de nuevo.',
      workspaceTimezoneUnset: 'Sin definir (UTC)',
      workspaceTimezoneUtc: 'UTC',
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
      manageErrorMembershipNotActive:
        'Tu membresía en este espacio de trabajo no está activa (su propietario la desactivó, o sigue siendo una invitación), así que el acceso de staff no puede abrirlo.',
      manageErrorUpstream: 'El servicio de identidad no pudo aplicar este cambio.',
      manageErrorOwnership: 'La propiedad se transfiere desde la app de Dapta.',
    },
    account: {
      title: 'Ajustes de cuenta',
      subtitle: 'Workspaces, marca, correos y preferencias.',
      managing: 'Administrando',
      nav: {
        workspaces: 'Workspaces',
        brandKit: 'Kit de marca',
        notifications: 'Notificaciones',
        publicPage: 'Página pública',
        preferences: 'Preferencias',
      },
      preferences: {
        title: 'Preferencias',
        subtitle: 'Ajustes que te siguen a ti, no al workspace.',
        languageLabel: 'Idioma',
        languageHelp:
          'El idioma en el que lees la aplicación, y en el que se escriben los correos de tus respuestas. Va con tu cuenta, así que aplica en cualquier lugar donde inicies sesión. Tus compañeros conservan su propia elección, y a quienes responden tus formularios se les contesta en el idioma de ellos.',
        languageError: 'No se pudo guardar tu idioma. Inténtalo de nuevo.',
      },
      workspaces: {
        title: 'Workspaces',
        subtitle: 'Todos los workspaces a los que perteneces. Abre uno para trabajar en él, o administra sus miembros e invitaciones.',
        search: 'Buscar workspaces',
        searchEmpty: 'Ningún workspace coincide.',
        searchClear: 'Limpiar búsqueda',
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
        idLabel: 'ID del workspace',
        copyId: 'Copiar ID',
        copied: 'Copiado',
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
      previewExpand: 'Ampliar vista previa',
      previewMock: {
        title: 'Cómo llega el correo',
        inbox: 'Recibidos',
        toMe: 'para mí',
        justNow: 'Ahora mismo',
        reply: 'Responder',
        forward: 'Reenviar',
        close: 'Cerrar',
        note: 'Una maqueta de cómo se ve el correo en una bandeja de entrada. Cada app de correo lo dibuja un poco distinto.',
      },
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
      tokenRespondentName: 'Nombre del encuestado',
      tokenRespondentEmail: 'Correo del encuestado',
      tokenScore: 'Puntuación',
      tokenOutcomeLabel: 'Resultado',
      tokenFormLink: 'Enlace a las respuestas',
      tokenAnswers: 'Respuestas',
      answersMissing:
        'Este correo no incluye {{answers}}, así que las respuestas no aparecerán en él. Inserta la variable Respuestas para agregarlas.',
      formOverrideNote:
        'Cada formulario puede personalizar estos correos desde su pestaña Conectar en el editor.',
      recipientsLabel: 'Enviar a',
      recipientsHint:
        'Cada dirección recibe su propia copia de este correo. Hasta cinco direcciones.',
      recipientsEmpty: 'Sin direcciones, así que este correo llega al propietario del workspace, o al primer administrador si no hay un propietario con correo.',
      recipientsAdd: 'Añadir dirección',
      recipientsRemove: 'Quitar dirección',
      recipientsPlaceholder: 'nombre@example.com',
      recipientsInvalid: 'Escribe una dirección de correo válida.',
      recipientsFollowingAccount:
        'Siguiendo la lista de la cuenta. Si la editas aquí, defines una solo para este formulario.',
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
      layoutSlidesDesc: 'Una pantalla a la vez. Agrupa preguntas para mostrar varias en una pantalla.',
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
      searchPlaceholder: 'Buscar formularios',
      searchLabel: 'Buscar formularios por nombre o enlace',
      searchClear: 'Limpiar búsqueda',
      searchEmpty: 'Ningún formulario coincide con tu búsqueda.',
      searchResults: '{count} formularios coinciden',
      searchShortcut: 'Ctrl K',
      unfiled: 'Sin carpeta',
      folderCount: '{count} formularios',
      folderCountOne: '1 formulario',
      newFolder: 'Nueva carpeta',
      newFolderTitle: 'Crear una carpeta',
      folderCreate: 'Crear carpeta',
      renameFolder: 'Renombrar',
      renameFolderTitle: 'Renombrar carpeta',
      folderSave: 'Guardar',
      folderNameLabel: 'Nombre de la carpeta',
      folderNamePlaceholder: 'p. ej. Ventas',
      folderNameRequired: 'Ponle un nombre a la carpeta.',
      folderNameTaken: 'Ya existe una carpeta con ese nombre.',
      deleteFolder: 'Eliminar carpeta',
      deleteFolderConfirm: '¿Eliminar “{name}”? Los formularios que contiene ({forms}) se conservan y pasan a Sin carpeta.',
      folderMenu: 'Acciones de la carpeta',
      collapse: 'Contraer',
      expand: 'Expandir',
      createIn: 'Nuevo formulario',
      folderLabel: 'Carpeta',
      folderNone: 'Sin carpeta',
      moveTo: 'Mover a carpeta',
      moveBack: 'Sin carpeta',
      moveFailed: 'No se pudo mover el formulario. Inténtalo de nuevo.',
      dragHandle: 'Arrastra a una carpeta',
      dropHere: 'Suelta para mover aquí',
      actionFailed: 'Algo salió mal. Inténtalo de nuevo.',
      colForm: 'Formulario',
      colStatus: 'Estado',
      colSubmissions: 'Respuestas',
      colCompletion: 'Finalización',
      colUpdated: 'Actualizado',
      statusLive: 'Publicado',
      statusLiveHint: 'Lo que ve el público es la última versión.',
      statusUnpublished: 'Cambios sin publicar',
      statusUnpublishedHint: 'Tiene cambios que el público aún no ve.',
      noCompletion: 'Sin datos',
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
          'Déjalo vacío para mostrar la pantalla de agradecimiento. Si lo defines, se redirige ahí a los respondientes. Usa [campo] para agregar una respuesta a la URL, como ?nombre=[name]. Si el formulario está incrustado, no se envían respuestas y esos parámetros se omiten.',
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
        redirectHint:
          'Déjalo vacío para mostrar la pantalla de agradecimiento. Si lo defines, se redirige a todos ahí. Usa [campo] para agregar una respuesta a la URL, como ?nombre=[name]. Si el formulario está incrustado, no se envían respuestas y esos parámetros se omiten.',
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
        file: 'Subir archivo',
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
        fileAllowedTypes: 'Archivos aceptados',
        fileAllowedTypesHint:
          'Elige los grupos que aceptas, o escribe extensiones separadas por comas. Los programas y las páginas web nunca se aceptan.',
        filePresetDocuments: 'Documentos',
        filePresetImages: 'Imágenes',
        filePresetSheets: 'Hojas de cálculo',
        filePresetArchives: 'Comprimidos',
        fileMaxSize: 'Archivo más grande (MB)',
        fileMaxSizeHint: 'Hasta {max} MB en este despliegue. Déjalo vacío para permitir los {max} MB completos.',
        fileNoTypes: 'Elige al menos un tipo de archivo, o nadie podrá responder esta pregunta.',
        phoneMinDigits: 'Dígitos mínimos',
        phoneMinDigitsHelp:
          'El número más corto que se acepta, sin contar el código de país. La longitud varía según el país, así que este es el piso que atrapa un número claramente incompleto.',
        charLimits: 'Longitud de la respuesta',
        charLimitsHelp:
          'Quien responde ve un contador en vivo y no puede continuar hasta llegar al mínimo. Deja una casilla vacía para quitar ese extremo.',
        minChars: 'Caracteres mínimos',
        maxChars: 'Caracteres máximos',
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
          'Lo que se guarda en la respuesta y se envía a HubSpot o al webhook. Sigue a la etiqueta hasta que escribas uno tú, y a partir de ahí se queda como lo dejaste.',
        advanced: 'Valores guardados',
        valueTaken: 'Otra opción de esta pregunta ya guarda ese valor.',
        valueLocked:
          'Estos valores ya están en uso, así que se quedan como están mientras reescribes las etiquetas. Las respuestas recibidas en el formulario en vivo los llevan, y cualquier mapeo de HubSpot que apunte a ellos también.',
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
        iconLettersHint: 'Hasta dos letras, por ejemplo HS para HubSpot. Si lo dejas vacío, la opción no muestra ícono.',
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
        slidesHint: 'Una pantalla a la vez. Agrupa preguntas para mostrar varias en una pantalla.',
        vertical: 'Una página',
        verticalHint:
          'Todas las preguntas en una sola página con un solo Enviar. La lógica sigue aplicando en vivo. Las preguntas aparecen y se ocultan según las respuestas.',
        screensIgnored: 'Las pantallas solo aplican en Diapositivas. En Una página todas las preguntas ya están juntas.',
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
        languageTitle: 'Idioma',
        languageHint:
          'El idioma de los botones, el progreso y el mensaje de gracias que ven los visitantes. Auto sigue el navegador de cada visitante. Un enlace con ?lang= sigue ganando.',
        languageAuto: 'Auto (navegador del visitante)',
        languageEn: 'Inglés',
        languageEs: 'Español',
        labelsTitle: 'Texto de los botones',
        labelsHint: 'Reemplaza el texto predeterminado de los botones de este formulario. Déjalo vacío para usar el predeterminado del idioma. El texto propio de una pregunta sigue ganando en esa pregunta.',
        labelBack: 'Atrás',
        labelNext: 'Siguiente',
        labelSubmit: 'Enviar',
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
        badgeSize: 'Insignia de atribución',
        badgeSizeHint: 'La píldora «Hecho con» que aparece debajo del formulario.',
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
        spamTitle: 'Protección contra spam (captcha)',
        spamToggle: 'Verificar que quien responde es una persona antes del envío final',
        spamHelp:
          'Agrega un captcha que frena los envíos automáticos de bots. La mayoría de las personas no ve nada: solo aparece una casilla si el tráfico parece sospechoso. Solo las respuestas completas y verificadas llegan a tus integraciones.',
        spamPartialNote:
          'Las respuestas parciales se siguen guardando en Envíos, pero no se envían a webhooks ni a HubSpot mientras la protección esté activa.',
        spamUnavailable: 'Este despliegue no tiene configurada la protección contra spam.',
        spamInactiveHere:
          'Está activada en este formulario, pero no se aplica en este despliegue hasta que se configure la protección contra spam.',
        spamDraftNote: 'Se guarda con tu borrador: haz clic en Publicar para aplicarla al formulario público.',
        spamModeGroup: 'Modo de protección',
        spamModeAuto: 'Automático: solo quien parezca sospechoso ve una verificación (recomendado)',
        spamModeStrict: 'Estricto: todos ven la verificación antes de enviar, con controles extra',
        spamModeStrictHelp: 'Úsalo si sigue entrando spam. Agrega un paso visible para todos.',
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
        gtmHelp:
          'Carga tu contenedor de GTM para que se disparen tus etiquetas, y empuja un evento form_lead cuando alguien completa el formulario.',
        metaLabel: 'ID del píxel de Meta',
        metaHelp:
          'Dispara un PageView al cargar el formulario y un Lead cuando alguien lo completa.',
        posthogKeyLabel: 'Clave del proyecto de PostHog',
        posthogKeyHelp: 'Captura una pageview en PostHog para analítica de producto.',
        posthogHostLabel: 'Host de PostHog (opcional)',
        posthogHostHelp:
          'Por defecto usa la nube de PostHog en EE. UU.; configura tu URL de ingesta de la UE o autoalojada.',
        posthogHostInvalid: 'Introduce una URL http(s) completa, p. ej. https://eu.i.posthog.com.',
        hubspotLabel: 'ID de seguimiento de HubSpot',
        hubspotHelp:
          'Carga el código de seguimiento de HubSpot de tu portal en la página del formulario. Si insertas este formulario en páginas que ya cargan tu código de seguimiento de HubSpot, déjalo vacío: el embed pasa la visita de esas páginas.',
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
      timezoneNote: 'Días en {zone}',
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
      timezoneLabel: 'Zona horaria del workspace',
      timezoneHint: 'Las fechas de abajo se leen en esta zona. La comparte todo el workspace.',
      timezoneReadOnly: 'Solo un administrador puede cambiarla.',
      badgeCompleted: 'Completada',
      badgePartial: 'Parcial',
      colSubmitted: 'Enviada',
      colStatus: 'Estado',
      colScore: 'Puntaje',
      colSubmittedAt: 'Fecha de envío',
      colSubmissionId: 'ID de respuesta',
      colPageUrl: 'URL de la página',
      colFirstName: 'Nombre',
      colLastName: 'Apellido',
      export: 'Descargar CSV',
      delete: 'Eliminar',
      deleteConfirm: '¿Eliminar esta respuesta? No se puede deshacer.',
      download: 'Descargar',
      downloadFailed: 'No se pudo abrir ese archivo.',
      previewLoading: 'Abriendo el archivo',
      previewFailed: 'No se pudo cargar la vista previa.',
      previewReload: 'Intenta de nuevo',
      previewUnavailable: 'Este tipo de archivo no se puede mostrar aquí. Descárgalo para abrirlo.',
      previewApprox: 'Vista aproximada. Descarga el archivo para ver su formato exacto.',
      previewClose: 'Cerrar',
      emptyTitle: 'Aún no hay respuestas',
      emptyBody: 'Las respuestas aparecerán aquí a medida que las personas completen el formulario.',
      prev: 'Anterior',
      next: 'Siguiente',
      showing: '{from}–{to} de {total}',
      na: '',
      error: 'No se pudieron cargar las respuestas.',
      retry: 'Reintentar',
      summary: {
        tabSummary: 'Resumen',
        tabResponses: 'Respuestas',
        tabsLabel: 'Vistas de respuestas',
        multiNote: 'Se podía elegir más de una opción, así que los porcentajes pueden sumar más de 100%.',
        average: 'Promedio',
        range: '{from}–{to}',
        filesUploaded: 'Archivos subidos',
        meetingsBooked: 'Reuniones agendadas',
        noAnswers: 'Nadie ha respondido esta pregunta todavía.',
        latest: 'Últimas respuestas',
        searchLabel: 'Busca en las respuestas a esta pregunta',
        searchPlaceholder: 'Buscar respuestas',
        searchClear: 'Borrar búsqueda',
        matches: 'Coincidencias: {n}',
        noMatches: 'Ninguna respuesta contiene «{query}».',
        showMore: 'Ver más',
        anonymous: 'Anónimo',
        openAnswer: 'Abrir esta respuesta',
        openFailed: 'No se pudo abrir esa respuesta. Puede que la hayan eliminado.',
        searchFailed: 'La búsqueda no terminó. Intenta de nuevo.',
      },
      viewResponse: 'Ver respuesta',
      responseTitle: 'Respuesta anónima',
      prevResponse: 'Respuesta anterior',
      nextResponse: 'Respuesta siguiente',
      closeResponse: 'Cerrar',
      responsePosition: '{n} de {total}',
      answersTitle: 'Respuestas',
      detailsTitle: 'Detalles',
      noAnswer: 'Sin respuesta',
      colStarted: 'Iniciada',
      responseId: 'ID de respuesta',
      pageRow: 'Página',
      hubspotCookie: 'Cookie de HubSpot recibida',
      utmTitle: 'Campaña (UTM)',
      answeredCount: '{n} de {total} respondidas',
      sheetOpen: 'Pantalla completa',
      sheetClose: 'Salir de pantalla completa',
      colResponse: 'Respuesta',
      colActions: 'Acciones',
      scoreValue: 'Puntaje {score}',
      pageSize: 'Filas por página',
      selectResponse: 'Seleccionar esta respuesta',
      selectPage: 'Seleccionar todas las respuestas de esta página',
      selectMode: 'Seleccionar',
      selectModeDone: 'Listo',
      selectedCount: '{n} seleccionadas',
      selectedCountOne: '1 seleccionada',
      exportSelected: 'Exportar CSV',
      clearSelection: 'Limpiar',
      bulkDeleteTitle: '¿Eliminar {n} respuestas?',
      bulkDeleteTitleOne: '¿Eliminar 1 respuesta?',
      bulkDeleteBody: 'No se puede deshacer.',
      bulkDeleteFailed: 'No se pudo eliminar. Inténtalo de nuevo.',
      resizeColumn: 'Arrastra para cambiar el ancho. Doble clic para restablecer.',
      filters: {
        filterColumn: 'Filtrar por {column}',
        filterColumnActive: 'Filtrar por {column}, {n} activos',
        filterColumnActiveOne: 'Filtrar por {column}, 1 activo',
        searchOptions: 'Buscar opciones',
        searchResponses: 'Buscar respuestas',
        searchResponsesLabel: 'Buscar en las respuestas escritas',
        searchResponsesClear: 'Borrar búsqueda',
        searchChip: 'Búsqueda',
        noOptions: 'Ninguna opción coincide.',
        clear: 'Limpiar',
        clearAll: 'Limpiar todo',
        close: 'Cerrar',
        sortTitle: 'Ordenar',
        sortNewest: 'Más recientes primero',
        sortOldest: 'Más antiguas primero',
        sortScoreDesc: 'Mayor primero',
        sortScoreAsc: 'Menor primero',
        rangeTitle: 'Fecha',
        rangeToday: 'Hoy',
        range7d: 'Últimos 7 días',
        range30d: 'Últimos 30 días',
        rangeCustom: 'Rango personalizado',
        rangeFrom: 'Desde',
        rangeTo: 'Hasta',
        scoreRange: 'Rango de puntaje',
        scoreMin: 'Mín.',
        scoreMax: 'Máx.',
        showing: '{n} de {total} respuestas',
        chipsLabel: 'Filtros activos',
        removeChip: 'Quitar filtro: {filter}',
        chipBetween: '{from}–{to}',
        chipAtLeast: '{min} o más',
        chipAtMost: '{max} o menos',
        chipFrom: 'Desde {from}',
        chipUntil: 'Hasta {to}',
        noMatchesTitle: 'Ninguna respuesta coincide con estos filtros',
        noMatchesBody: 'Quita un filtro, o límpialos todos, para ver más.',
        showResponses: 'Ver las respuestas que eligieron {option}',
      },
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
        'Crea un formulario espejo en tu portal, para que cada respuesta completada aparezca en el contacto como una actividad de form submission con las propiedades que escribió: y no solo como una nota. También es lo que une al contacto con sus visitas a la página donde está insertado el formulario, así que actívalo para atribuirlas. Necesita los permisos forms y form-submissions-write en tu private app.',
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
        'Recibe la fecha de envío. Una propiedad tipo fecha recibe el día calendario (según la zona horaria del día de al lado); una tipo fecha y hora conserva la hora exacta.',
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
        'Fecha y hora de inicio de la reunión, según el calendario. Una propiedad tipo fecha recibe solo el día de la reunión (según la zona horaria del día).',
      bookingDateTimezone: 'Zona horaria del día',
      bookingDateTimezoneHelp:
        'Decide a qué día calendario pertenece lo que guarda una propiedad tipo fecha (ej. un envío a las 9pm sigue siendo "hoy" en tu zona, pero en UTC ya es mañana). Compartida por todas las propiedades tipo fecha de esta integración. Vacío = UTC. Las propiedades de fecha y hora conservan la hora exacta y se muestran en la zona horaria del portal.',
      bookingDateTimezonePlaceholder: 'America/Bogota',
      bookingDateTimezoneUtc: 'UTC (predeterminada)',
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
      pingWeSend: 'dForms siempre entrega con POST y un cuerpo JSON.',
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
      eventPartialHeld: 'En pausa mientras la protección contra spam está activa',
      webhookPartialOnlyHeld:
        'Este webhook no se va a disparar: solo escucha respuestas parciales, que están en pausa mientras la protección contra spam está activa.',
      hubspotPartialHeld:
        'La protección contra spam está activa: los contactos se crean o actualizan cuando alguien completa el formulario, no con respuestas parciales.',
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
      calendlyScopeNote:
        'Los formularios pueden elegir los tipos de evento que esta cuenta tiene o de los que es host. Para usar un evento de equipo, conecta una cuenta que sea uno de sus hosts.',
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
        eventsCompleteHeld: 'Completas (parciales en pausa)',
        eventsPartialHeld: 'Respuestas parciales (en pausa)',
        partialsHeldNote:
          'La protección contra spam está activa en este formulario: las respuestas parciales se guardan pero no se envían.',
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
    developers: {
      title: 'MCP',
      connect: {
        heading: 'Conecta Claude, ChatGPT, Codex o Cursor con dForms',
        intro: 'Pídele a tu asistente de IA que cree, edite y publique formularios, lea respuestas y revise analíticas, directamente desde un chat. Inicia sesión una vez con tu cuenta y podrá trabajar en todos los workspaces que puedes abrir.',
        signinTitle: 'Conecta con tu cuenta',
        recommended: 'Recomendado',
        signinIntro: 'Elige tu app y sigue los pasos.',
        benefits: {
          noKey: { title: 'Sin llave de API.', body: 'Solo inicia sesión con tu cuenta. Nada que crear ni guardar.' },
          workspaces: { title: 'Un conector, todos tus workspaces.', body: 'Trabaja en cualquier workspace que puedas abrir en dForms.' },
          members: { title: 'Cualquier miembro puede conectarse.', body: 'No necesitas pedírselo al owner.' },
        },
        appsLabel: 'Tu app de IA',
        urlLabel: 'URL del MCP',
        promptLabel: 'Pruébalo',
        prompt: 'Lista mis formularios en dForms',
        copy: 'Copiar',
        copied: 'Copiado',
        copyFailed: 'No se pudo copiar. Selecciona el texto y cópialo a mano.',
        copyUrl: 'Copiar URL',
        copyCommand: 'Copiar comando',
        copyConfig: 'Copiar configuración',
        copyPrompt: 'Copiar prompt',
        addToCursor: 'Add to Cursor',
        open: {
          claude: 'Abrir Claude',
          claudeDesktop: 'Abrir Claude Desktop',
          claudeDirectory: 'Abrir en el directorio de Claude',
          chatgpt: 'Abrir ChatGPT',
          copyCommand: 'Copiar comando',
          copied: 'Copiado',
          pasteHint: 'Pégalo en tu terminal.',
          phoneNote: 'Abre esta página en tu computadora para conectar {app}.',
        },
        apps: {
          claude: {
            steps: [
              {
                title: 'Abre Connectors en Claude',
                body: 'En claude.ai, Claude Desktop o Cowork, haz clic en **+** en la caja del chat y luego en **Connectors → Add connector → Add custom connector**.',
              },
              {
                title: 'Ponle dForms de nombre y pega esta URL',
                body: 'Usa `dForms` como nombre y pega la URL de abajo. Deja vacía la configuración avanzada y haz clic en **Add**.',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Tu navegador abre la página de inicio de sesión. Escribe tu correo y el código de 6 dígitos que te enviamos. De vuelta en Claude, dForms aparece como **Connected**.',
              },
              {
                title: 'Pregunta',
                body: 'Abre un chat nuevo y pregunta, por ejemplo:',
              },
            ],
          },
          claudeDirectory: {
            steps: [
              {
                title: 'Abre dForms en el directorio de Claude',
                body: 'Haz clic en el botón de abajo. O, en Claude, haz clic en **+** en la caja del chat, luego en **Connectors → Browse connectors**, y busca `dForms`.',
              },
              {
                title: 'Haz clic en Connect',
                body: 'En la página de dForms del directorio, haz clic en **Connect**. Claude abre el inicio de sesión de dForms.',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Escribe tu correo y el código de 6 dígitos que te enviamos. De vuelta en Claude, dForms aparece como **Connected**.',
              },
              {
                title: 'Pregunta',
                body: 'Abre un chat nuevo y pregunta, por ejemplo:',
              },
            ],
            fallbackTitle: '¿Tu organización no deja usar el directorio?',
            fallbackBody: 'Agrega dForms como conector personalizado: en Claude haz clic en **+** y luego en **Connectors → Add connector → Add custom connector**. Usa `dForms` como nombre, pega esta URL y haz clic en **Add**.',
          },
          chatgpt: {
            steps: [
              {
                title: 'Crea la app en ChatGPT',
                body: 'En la app de escritorio de ChatGPT, cambia a modo **Work**. Abre **Plugins**, haz clic en **Add** y elige **Create MCP App**.',
              },
              {
                title: 'Llena el formulario',
                body: 'Name: `dForms`. Server URL: pega la dirección de abajo. Deja Authentication en **OAuth**. Marca **I understand and want to continue** y créala.',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Haz clic en **Continue**. Se abre tu navegador: inicia sesión si te lo pide y luego haz clic en **Open ChatGPT** para volver.',
              },
              {
                title: 'Instala el plugin',
                body: 'En **Plugins**, abre la pestaña **Personal**, elige **dForms** y haz clic en **Install plugin**. El navegador se abre una vez más para vincular tu cuenta: haz clic otra vez en **Open ChatGPT**. Ese segundo inicio de sesión es normal.',
              },
              {
                title: 'Pregunta',
                body: 'Haz clic en **Try now**, escribe `@dForms` y pregunta, por ejemplo:',
              },
            ],
          },
          claudeCode: {
            steps: [
              {
                title: 'Agrega dForms a Claude Code',
                body: 'En una terminal, ejecuta:',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Abre Claude Code, ejecuta `/mcp`, elige **dforms** y luego **Authenticate**. Inicia sesión en el navegador y vuelve a la terminal.',
              },
              {
                title: 'Pregunta',
                body: 'Pregunta, por ejemplo:',
              },
            ],
            note: '¿Ya conectaste dForms en Claude? Claude Code con la misma cuenta de Claude también usa ese conector: ejecuta `/mcp` para revisarlo.',
            directoryTitle: '¿Ya conectaste dForms en Claude?',
            directoryBody: 'Claude Code con la misma cuenta de Claude trae el conector de dForms. Ejecuta `/mcp` y busca **dForms**. ¿Todavía no está? Conéctalo desde el directorio de Claude o sigue los pasos de abajo.',
          },
          codex: {
            steps: [
              {
                title: 'Agrega dForms a Codex',
                body: 'En una terminal, ejecuta:',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Ejecuta este comando. Se abre tu navegador: inicia sesión y vuelve a la terminal.',
              },
              {
                title: 'Pregunta',
                body: 'Abre Codex y pregunta, por ejemplo:',
              },
            ],
            note: '¿Usas la app de escritorio de Codex o ChatGPT? Sigue la pestaña **ChatGPT**.',
          },
          cursor: {
            steps: [
              {
                title: 'Agrega dForms a Cursor',
                body: 'Si tienes Cursor instalado, haz clic en **Add to Cursor**. O abre **Customize → MCPs → New MCP Server**, elige **User** y pega esto en `mcp.json`:',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: '**dforms** aparece con **Needs authentication**. Haz clic en **Authenticate**, inicia sesión en el navegador, haz clic en **Allow access** y luego en **Open Cursor**.',
              },
              {
                title: 'Pregunta',
                body: 'Abre un **New Chat** y pregunta, por ejemplo. Cursor te pregunta antes de usar una herramienta: haz clic en **Run**.',
              },
            ],
          },
          openclaw: {
            steps: [
              {
                title: 'Agrega dForms a OpenClaw',
                body: 'En una terminal, guarda dForms como servidor MCP remoto que inicia sesión con tu cuenta:',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Ejecuta este comando. Se abre tu navegador: inicia sesión y vuelve a la terminal. Después, `openclaw mcp status --verbose` muestra dforms como autorizado.',
              },
              {
                title: 'Pregunta',
                body: 'Pregúntale a tu agente de OpenClaw, por ejemplo:',
              },
            ],
          },
          hermes: {
            steps: [
              {
                title: 'Agrega dForms a Hermes',
                body: 'Abre `~/.hermes/config.yaml` (o ejecuta `hermes config edit`) y agrega dForms dentro de `mcp_servers`:',
              },
              {
                title: 'Inicia sesión con tu cuenta',
                body: 'Ejecuta este comando. Se abre tu navegador: inicia sesión y vuelve a la terminal. Después abre una sesión nueva, o ejecuta `/reload-mcp` en la que tengas abierta.',
              },
              {
                title: 'Pregunta',
                body: 'Pregúntale a tu agente de Hermes, por ejemplo:',
              },
            ],
          },
        },
        tip: '**Un conector para todos tus workspaces.** Si tienes varios, tu app de IA te pregunta en cuál trabajar. Para cambiar, solo di «cambia a <workspace>». Cada respuesta te dice en qué workspace trabajó.',
        unavailableTitle: 'El conector no está disponible en esta instalación',
        unavailableBody: 'El servidor MCP de esta instalación todavía no acepta inicio de sesión, así que las apps de IA no pueden conectarse aquí. Pídele a quien la administra que configure `MCP_OAUTH_PROVIDER` y `MCP_PUBLIC_URL`.',
        media: {
          terminalLabel: 'Animación: cómo conectar dForms en {app}',
          play: 'Reproducir el recorrido',
          pause: 'Pausar el recorrido',
        },
        walkthrough: {
          ui: {
            ccWelcome: 'Welcome to Claude Code!',
            ccHelp: '/help for help, /status for your current setup',
            ccAdded: 'Added HTTP MCP server dforms with URL: {url} to user config',
            ccManage: 'Manage MCP servers',
            needsAuth: 'needs authentication',
            authenticate: 'Authenticate',
            ccBrowser: 'Opening your browser to authenticate…',
            ccAuthOk: 'Authentication successful. Connected to dforms.',
            codexAdded: "Added global MCP server 'dforms'.",
            codexAuthorize: 'Authorize dforms in your browser to continue.',
            codexLoggedIn: "Successfully logged in to MCP server 'dforms'.",
            codexModel: 'model: gpt-5-codex  directory: ~/studio',
            called: 'Called',
            working: 'Working',
            ocSaved: 'Saved MCP server "dforms" (streamable-http, auth: oauth).',
            ocLogin: 'Opening the browser to sign in to dforms…',
            ocLoggedIn: 'dforms: authorized. 49 tools available.',
            hmSaved: 'Saved. Run hermes mcp login dforms to sign in.',
            hmLogin: 'Opening your browser to authorize dforms…',
            hmLoggedIn: 'dforms: authorized. Tokens saved.',
          },
          signIn: {
            title: 'Inicia sesión con tu cuenta',
            emailLabel: 'Correo',
            email: 'alex@example.com',
            continue: 'Continuar con correo',
            checkEmail: 'Revisa tu correo',
            codeSentTo: 'Escribe el código que enviamos a',
            noCode: '¿No te llegó el código? Puedes pedir otro en 30 segundos.',
            connected: 'dForms está conectado a {app}',
            consentTitle: '{app} quiere acceder a tu cuenta',
            redirectNote: 'Después de permitir el acceso, te redirigimos a:',
            warning: 'Esta redirección apunta a una aplicación en tu computadora. Permite el acceso solo si lo iniciaste desde {app}.',
            allow: 'Permitir acceso',
            cancel: 'Cancelar',
          },
          answer: {
            intro: 'Estos son los formularios de tu workspace:',
            forms: [
              { name: 'Calificador de leads', stat: '128 respuestas' },
              { name: 'Confirmación del lanzamiento', stat: '64 respuestas' },
              { name: 'Postulación a empleo', stat: '23 respuestas' },
            ],
            colForm: 'Formulario',
            colResponses: 'Respuestas',
            colStatus: 'Estado',
            live: 'Publicado',
          },
        },
        toolsTitle: 'Qué puedes hacer con el MCP',
        toolsIntro: '{count} herramientas, lo mismo que haces en el dashboard. Pide las cosas con tus palabras: tu app de IA elige la herramienta.',
        toolsLink: 'Ver todas las herramientas',
      },
      tools: {
        title: 'Herramientas',
        intro: 'Todo lo que tu agente puede hacer en dForms una vez conectado: {count} herramientas. Nunca las llamas tú. Pide con tus palabras y tu agente elige la correcta.',
        askLabel: 'Pide:',
        count: '{n} herramientas',
        groups: {
          forms: { title: 'Formularios', body: 'Crea, edita, publica, revierte, duplica y borra formularios, y cambia su enlace.' },
          responses: { title: 'Respuestas y CSV', body: 'Lista, busca y lee respuestas, abre sus archivos y expórtalas a CSV.' },
          analytics: { title: 'Analíticas', body: 'Visitas, inicios, completados, abandono por paso y un resumen de cada formulario.' },
          folders: { title: 'Carpetas', body: 'Crea, renombra y borra carpetas, y mueve formularios entre ellas.' },
          brandKit: { title: 'Kit de marca', body: 'Lee y edita el kit de marca y aplícalo a tus formularios.' },
          linkPage: { title: 'Páginas del workspace', body: 'Lee, agrega y edita las páginas públicas del workspace con tus formularios y enlaces.' },
          notifications: { title: 'Correos', body: 'Edita los correos de notificación del workspace y de cada formulario.' },
          integrations: { title: 'Integraciones', body: 'Webhooks, HubSpot y Calendly: a dónde van las respuestas, pruebas y entregas.' },
          account: { title: 'Cuenta y workspaces', body: 'Quién está conectado, en qué workspaces puedes trabajar y tu perfil.' },
        },
        items: {
          list_forms: { what: 'Ve todos los formularios del workspace, con su enlace y su estado.', ask: '¿Qué formularios tengo?' },
          get_form: { what: 'Abre un formulario y lee sus preguntas, su lógica y su diseño.', ask: 'Muéstrame las preguntas de mi formulario de contacto' },
          get_form_guide: { what: 'Aprende cómo se arma un formulario de dForms antes de crear uno.', ask: '¿Cómo se arma un quiz con puntaje en dForms?' },
          create_form: { what: 'Crea un formulario nuevo a partir de una descripción, listo para compartir.', ask: 'Hazme un formulario de leads para mi estudio con nombre, correo y presupuesto' },
          update_form: { what: 'Cambia preguntas, lógica, puntaje o diseño. Se guarda como borrador.', ask: 'Agrega una pregunta sobre el plazo a mi formulario de leads' },
          publish_form: { what: 'Publica el último borrador.', ask: 'Publica mi formulario de leads' },
          revert_form: { what: 'Vuelve a la versión que estaba publicada antes.', ask: 'Deshaz la última publicación de mi encuesta' },
          discard_draft: { what: 'Descarta los cambios sin publicar.', ask: 'Descarta el borrador de mi formulario de confirmación' },
          duplicate_form: { what: 'Haz una copia de un formulario para partir de ella.', ask: 'Duplica mi formulario de contacto' },
          delete_form: { what: 'Borra un formulario que ya no necesitas.', ask: 'Borra el formulario viejo de prueba' },
          set_form_slug: { what: 'Cambia el final del enlace de un formulario.', ask: 'Cambia el enlace de mi encuesta a /feedback' },
          list_responses: { what: 'Lista las respuestas de un formulario, con filtros por fecha, estado o puntaje.', ask: 'Muéstrame las respuestas de esta semana de mi formulario de leads' },
          get_response: { what: 'Lee una respuesta completa.', ask: 'Muéstrame completa la última respuesta' },
          get_response_file: { what: 'Abre un archivo que alguien subió en una respuesta.', ask: 'Abre la hoja de vida que subió el último candidato' },
          get_response_facets: { what: 'Mira cómo se reparten las respuestas de cada pregunta.', ask: '¿Cómo respondieron la pregunta de presupuesto?' },
          search_answers: { what: 'Encuentra respuestas que mencionan algo.', ask: 'Busca respuestas que mencionen HubSpot' },
          export_responses_csv: { what: 'Descarga las respuestas en un archivo CSV.', ask: 'Exporta a CSV las respuestas de este mes' },
          delete_response: { what: 'Borra una respuesta.', ask: 'Borra la respuesta de prueba que envié' },
          delete_responses: { what: 'Borra varias respuestas a la vez.', ask: 'Borra todas las respuestas de la prueba de la semana pasada' },
          get_form_analytics: { what: 'Visitas, inicios, completados y abandono por paso.', ask: '¿En qué paso abandonan mi formulario de registro?' },
          get_form_summary: { what: 'Un resumen corto de cómo va un formulario.', ask: '¿Cómo va mi formulario de leads esta semana?' },
          list_folders: { what: 'Ve tus carpetas y lo que hay en ellas.', ask: '¿Qué carpetas tengo?' },
          create_folder: { what: 'Crea una carpeta para agrupar formularios.', ask: 'Crea una carpeta llamada Clientes' },
          rename_folder: { what: 'Cambia el nombre de una carpeta.', ask: 'Cambia el nombre de la carpeta Clientes a Cuentas' },
          delete_folder: { what: 'Borra una carpeta. Sus formularios se quedan.', ask: 'Borra la carpeta Viejos' },
          move_form: { what: 'Mueve un formulario a una carpeta.', ask: 'Mueve mi formulario de confirmación a la carpeta Eventos' },
          get_brand_kit: { what: 'Lee el logo, los colores y las fuentes del workspace.', ask: '¿Qué colores usa mi kit de marca?' },
          update_brand_kit: { what: 'Cambia el kit de marca.', ask: 'Pon verde el color de mi marca' },
          apply_brand_kit: { what: 'Aplica el kit de marca a un formulario.', ask: 'Aplica mi kit de marca a la encuesta' },
          revert_brand_kit: { what: 'Devuelve un formulario al diseño que tenía antes del kit de marca.', ask: 'Quita el kit de marca de mi encuesta' },
          get_link_page: { what: 'Lee una de las páginas públicas del workspace (la principal, si no nombras otra): sus botones, redes y su enlace.', ask: '¿Qué muestra la página de mi workspace?' },
          update_link_page: { what: 'Edita, renombra, publica o borra una página pública, o la vuelve la principal.', ask: 'Agrega mi formulario de contacto a la página del workspace y publícala' },
          list_link_pages: { what: 'Lista las páginas públicas del workspace con sus enlaces y si cada una está publicada.', ask: '¿Qué páginas tiene mi workspace?' },
          create_link_page: { what: 'Agrega una página pública, para un evento, un canal o un país.', ask: 'Crea una página para la Expo 2026 con mi formulario de demo' },
          duplicate_link_page: { what: 'Copia una página con una dirección nueva, sin publicar.', ask: 'Copia mi página de la Expo para la feria del próximo año' },
          delete_link_page: { what: 'Borra una página que no sea la principal.', ask: 'Borra la página vieja de la Expo' },
          list_notifications: { what: 'Ve los correos de notificación del workspace.', ask: '¿Qué correos envía dForms?' },
          update_notification: { what: 'Edita un correo de notificación de todo el workspace.', ask: 'Cambia el asunto del correo de respuesta nueva' },
          reset_notification: { what: 'Devuelve un correo del workspace a su versión original.', ask: 'Restablece el correo de respuesta nueva' },
          list_form_notifications: { what: 'Ve los correos que envía un formulario.', ask: '¿Qué correos envía mi formulario de leads?' },
          update_form_notification: { what: 'Edita un correo de un formulario.', ask: 'Envía los avisos del formulario de leads a ventas@example.com' },
          reset_form_notification: { what: 'Devuelve el correo de un formulario a la versión del workspace.', ask: 'Restablece los correos de mi encuesta' },
          list_integrations: { what: 'Ve qué apps están conectadas, como HubSpot o Calendly.', ask: '¿Está conectado HubSpot?' },
          set_destinations: { what: 'Elige a dónde van las respuestas de un formulario: webhooks o HubSpot.', ask: 'Manda cada lead de mi formulario a HubSpot' },
          list_webhooks: { what: 'Ve los webhooks de un formulario.', ask: '¿Qué webhooks tiene mi formulario de leads?' },
          ping_webhook: { what: 'Envía una prueba a un webhook.', ask: 'Prueba el webhook de mi formulario de leads' },
          list_deliveries: { what: 'Mira qué respuestas se entregaron y cuáles fallaron.', ask: '¿Llegaron a HubSpot mis últimas respuestas?' },
          list_hubspot_properties: { what: 'Ve los campos de HubSpot que puede llenar una pregunta.', ask: '¿Qué campos de HubSpot puedo mapear?' },
          list_calendly_event_types: { what: 'Ve los eventos de Calendly que puede agendar un formulario.', ask: '¿Qué eventos de Calendly puede agendar mi formulario?' },
          whoami: { what: 'Revisa quién está conectado y en qué workspace.', ask: '¿Con qué cuenta estoy conectado?' },
          list_my_workspaces: { what: 'Ve todos los workspaces en los que puedes trabajar.', ask: '¿Qué workspaces puedo usar?' },
          get_my_profile: { what: 'Lee tu perfil y tu página pública.', ask: '¿Cuál es el enlace de mi página pública?' },
          get_workspace_link_code: { what: 'Obtén el código que vincula el workspace con otras apps.', ask: 'Dame el código de vínculo del workspace' },
        },
        connectCta: 'Conecta tu agente',
      },
    },
    apiDocs: {
      title: 'Docs de la API',
      subtitle: 'Todas las llamadas que puede hacer una llave de API, con sus parámetros, un ejemplo con curl y la respuesta que recibe.',
      toc: {
        label: 'En esta página',
        jumpLabel: 'Ir a',
        gettingStarted: 'Primeros pasos',
        errors: 'Errores',
        limits: 'Límites',
        reference: 'Referencia',
        notAllowed: 'Lo que una llave no puede hacer',
      },
      search: {
        label: 'Buscar endpoints',
        placeholder: 'Busca por ruta o descripción',
        empty: 'Ningún endpoint coincide con “{query}”.',
        clear: 'Borrar la búsqueda',
      },
      errors: {
        title: 'Errores',
        intro:
          'Todo error es un JSON con un código `error` estable y un `message` en inglés. Lee el código, no el mensaje: el código nunca cambia.',
        exampleTitle: 'Un error de validación',
        issuesBody:
          'Un `400` trae todos los problemas en `issues[]`, no solo el primero, para que los corrijas todos de una vez. Cada `path` es la ruta con puntos del campo dentro del body que mandaste, con las posiciones de los arrays como números: `config.steps.1.question` es la pregunta del segundo paso. `message` repite el primer problema.',
        codesTitle: 'Códigos de error',
        colStatus: 'Estado',
        colCode: 'Código',
        colMeaning: 'Qué hacer',
        codes: {
          BAD_REQUEST: 'Lee `issues[]`, corrige cada entrada y vuelve a mandar el request.',
          STEPS_REQUIRED: 'Una config de `PUT /v1/forms/{id}` sin `steps`. Manda el array `steps` completo.',
          INVALID_API_KEY:
            'La llave no existe o fue revocada, o quien la creó ya no está en el workspace. Crea una llave nueva.',
          KEY_NOT_ALLOWED: 'Esta ruta solo funciona en el dashboard. Hazlo en dForms.',
          WORKSPACE_FORBIDDEN: 'Mandaste un header de workspace de otro workspace. Quita el header: la llave ya elige el workspace.',
          FORBIDDEN:
            'La persona dueña de la llave no tiene el rol. Escribir el brand kit, las notificaciones y la prueba del webhook necesitan owner o admin.',
          NOT_FOUND: 'El id está mal o es de otro workspace. Vuelve a listar.',
          STALE:
            'El form cambió desde que lo leíste. El body trae `current`, el form como está ahora: aplica tu cambio sobre él y reintenta con su `updatedAt`.',
          NOTHING_TO_REVERT: 'El form no tiene una versión publicada anterior a la cual volver.',
          SLUG_TAKEN: 'Otro form ya usa ese slug. Elige otro.',
          SLUG_INVALID: 'Usa solo minúsculas, números y guiones.',
          NAME_TAKEN: 'Ya hay una carpeta con ese nombre.',
          RATE_LIMITED: 'Demasiados requests. Espera los segundos del header `Retry-After` (también `retryAfterSec` en el body) y sigue.',
        },
        issueCodesTitle: 'Códigos dentro de issues[]',
        issueCodes: {
          UNSUPPORTED_FIELD:
            'Un campo que el editor no puede mostrar, o un valor distinto del que el editor escribe solo. Quítalo, o manda de vuelta el valor que leíste.',
          EMPTY_QUESTION: 'Un paso sin texto en `question`. Solo los pasos `reveal`, `message` y `scheduler` pueden ir sin pregunta.',
          STEPS_REQUIRED: 'Una config sin `steps` al editar. Manda todos los pasos, no solo los que cambiaste.',
        },
      },
      limits: {
        title: 'Límites',
        rate: '{count} requests por minuto, por llave',
        rateBody:
          'Si te pasas, la API responde `429` con el header `Retry-After`. Espera esos segundos y sigue; no se pierde nada de lo que ya mandaste.',
        keys: '{count} llaves activas por persona, por workspace',
        keysBody: 'Revoca una llave que ya no uses para hacerle espacio a una nueva. Una llave revocada deja de funcionar de inmediato.',
      },
      reference: {
        title: 'Referencia',
        intro:
          'Las rutas son relativas a la URL de la API de arriba. Cada request lleva `Authorization: Bearer $DFORMS_API_KEY`, los bodies son JSON y las fechas van en epoch milisegundos.',
        adminOnly: 'Owner o admin',
        adminOnlyHint: 'Necesita una llave creada por un owner o admin del workspace. Cualquier otra recibe `403 FORBIDDEN`.',
        destructive: 'Borra datos',
        destructiveHint: 'No se puede deshacer. Un agente debería preguntarle a la persona antes de llamarla.',
        params: 'Parámetros',
        colName: 'Nombre',
        colDescription: 'Descripción',
        required: 'Obligatorio',
        in: { path: 'Ruta', query: 'Query', body: 'Body' },
        request: 'Request',
        response: 'Respuesta {status}',
        noContent: 'Sin contenido.',
        copy: 'Copiar',
        copied: 'Copiado',
        copyFailed: 'No se pudo copiar',
        anchorLabel: 'Link a {route}',
      },
      areas: {
        forms: {
          title: 'Forms',
          intro: 'Crea, lee, edita, publica, revierte, renombra, copia, mueve a carpetas y borra forms.',
        },
        folders: { title: 'Carpetas', intro: 'Agrupa forms en carpetas. Al borrar una carpeta, sus forms se quedan.' },
        destinations: {
          title: 'Destinos',
          intro: 'A dónde va cada respuesta además de dForms: webhooks y HubSpot. Aplican de inmediato, sin publicar.',
        },
        responses: {
          title: 'Respuestas',
          intro: 'Lee, filtra, exporta y borra las respuestas de un form, y mira los envíos que fallaron.',
        },
        analytics: {
          title: 'Analítica',
          intro: 'El embudo de un form y el desglose de las respuestas a cada pregunta.',
        },
        branding: {
          title: 'Brand kit',
          intro: 'El logo, los colores y la tipografía del workspace, y cómo aplicarlos a los forms.',
        },
        linkPage: {
          title: 'Páginas del workspace',
          intro: 'Las páginas públicas del workspace, hasta 20: la principal en `/{accountCode}` y las demás en `/{accountCode}/p/{slug}`. Cada una reúne sus forms y enlaces. Cualquier miembro puede leerlas y editarlas.',
        },
        notifications: {
          title: 'Notificaciones',
          intro: 'Los correos que dForms manda con cada respuesta, para todo el workspace o para un form.',
        },
        integrations: {
          title: 'Integraciones (solo lectura)',
          intro: 'Qué está conectado y a qué puede apuntar un destino o un paso de agenda. Conectar se hace en el dashboard.',
        },
        identity: {
          title: 'Identidad',
          intro: 'Como quién actúa la llave. Llama primero a `GET /v1/me` para probar una llave.',
        },
      },
      endpoints: {
        'GET /v1/forms':
          'Lista los forms del workspace, el último editado primero, con su `publicUrl` y su `editorUrl`.',
        'POST /v1/forms':
          'Crea un form. La config queda publicada de inmediato. No es idempotente: si una llamada falla o se demora demasiado, lista los forms antes de volver a intentar.',
        'GET /v1/forms/:id':
          'Un form: la `config` publicada, el borrador pendiente en `draftConfig` (o `null`), cuándo se publicó y el sello que debes mandar como `expectedUpdatedAt`.',
        'PUT /v1/forms/:id':
          'Guarda una config nueva como borrador; el form público no cambia hasta que publiques. La config reemplaza el borrador entero, así que manda todos los pasos.',
        'POST /v1/forms/:id/publish': 'Publica el borrador. Si no hay borrador pendiente, responde el form sin cambios.',
        'POST /v1/forms/:id/discard-draft':
          'Descarta el borrador pendiente, así el form vuelve a su config publicada. Lo que ve el público no cambia. Si no hay borrador pendiente, responde el form sin cambios.',
        'POST /v1/forms/:id/revert':
          'Vuelve a publicar la versión anterior. Si la llamas otra vez, deshaces el cambio. El borrador pendiente y los destinos se quedan como están.',
        'PUT /v1/forms/:id/slug':
          'Cambia la última parte de la URL pública. El slug anterior sigue redirigiendo al form.',
        'POST /v1/forms/:id/duplicate': 'Copia un form, con su config, en un form nuevo.',
        'PATCH /v1/forms/:id/folder': 'Mueve un form a una carpeta, o lo saca con `null`.',
        'DELETE /v1/forms/:id': 'Borra un form y sus respuestas.',
        'GET /v1/folders': 'Lista las carpetas en orden alfabético.',
        'POST /v1/folders': 'Crea una carpeta.',
        'PATCH /v1/folders/:id': 'Renombra una carpeta.',
        'DELETE /v1/folders/:id': 'Borra una carpeta. Sus forms se quedan, fuera de cualquier carpeta.',
        'PUT /v1/forms/:id/destinations':
          'Reemplaza los destinos del form (webhooks y HubSpot). Aplica de inmediato, sin publicar.',
        'POST /v1/forms/:id/destinations/webhook/ping':
          'Manda un evento de prueba al webhook del form y te dice cómo respondió el endpoint.',
        'GET /v1/forms/:id/submissions':
          'Una página de respuestas con los filtros que pases, y el `total` para recorrerlas.',
        'GET /v1/forms/:id/submissions/:submissionId': 'Una respuesta con todas sus respuestas a cada pregunta.',
        'GET /v1/forms/:id/submissions/:submissionId/files/:stepKey':
          'Links de corta duración para descargar un archivo subido, y para verlo en línea cuando su tipo lo permite.',
        'GET /v1/forms/:id/submissions.csv':
          'Todas las respuestas que cumplen los filtros, en un CSV para hoja de cálculo: una columna por pregunta y los textos de las opciones en vez de sus valores. Sin paginar.',
        'POST /v1/forms/:id/submissions/bulk-delete': 'Borra varias respuestas de un form de una vez.',
        'DELETE /v1/submissions/:id': 'Borra una respuesta.',
        'GET /v1/forms/:id/deliveries':
          'Los envíos a los destinos del form. Solo los que fallaron, salvo que pidas otros estados.',
        'GET /v1/forms/:id/analytics':
          'El embudo: vistas, inicios, respuestas completas, tasa de completado, tiempo para completar, abandono por paso y un punto por día.',
        'GET /v1/forms/:id/summary':
          'Una tarjeta por pregunta: cuántos eligieron cada opción y las últimas respuestas escritas. Acepta los filtros de respuestas.',
        'GET /v1/forms/:id/submissions-facets':
          'Cuántas respuestas hay, completas y parciales, y cuántos eligieron cada opción, antes de cualquier filtro.',
        'GET /v1/forms/:id/summary/:stepKey/answers': 'Busca en las respuestas a una pregunta escrita, la más reciente primero.',
        'GET /v1/branding': 'El brand kit del workspace.',
        'PUT /v1/branding':
          'Reemplaza el brand kit. Los forms nuevos lo toman de inmediato; los que ya existen, solo cuando lo aplicas.',
        'POST /v1/branding/apply': 'Aplica el brand kit a los forms que indiques.',
        'POST /v1/branding/revert': 'Devuelve a los forms el estilo que tenían antes de aplicar el brand kit.',
        'GET /v1/link-page': 'La página principal (`page`, null si no hay) con su `id` y su `slug`, los forms y el brand kit del workspace, el `publicUrl` de la página y si está publicada (`live`). Un número de WhatsApp guardado vuelve como dígitos; envíalo de vuelta con un `+` adelante.',
        'PUT /v1/link-page': 'Reemplaza la página principal completa: léela primero y envíala entera. Los colores y la tipografía vienen del brand kit, salvo que la página tenga sus propios `colors`. `{ "page": null }` borra la página y su URL vuelve a dar 404, si es la única página del workspace.',
        'GET /v1/link-pages': 'Todas las páginas del workspace, la principal primero: su `id`, su `slug`, su nombre interno (`name`), si es la principal y si está publicada (`live`), cuántos botones tiene (`buttons`) y su `publicUrl`.',
        'POST /v1/link-pages': 'Agrega una página, hasta 20 por workspace. Sin `slug` se arma uno a partir del nombre; sin `page` empieza vacía y sin publicar. La primera página del workspace queda como principal.',
        'GET /v1/link-pages/:id': 'Una página, con los forms y el brand kit del workspace, su `publicUrl` y si está publicada (`live`).',
        'PUT /v1/link-pages/:id': 'Cambia una página. Solo cambian los campos que envías; `page` reemplaza todo el contenido. Un `slug` nuevo deja la dirección anterior redirigiendo a la nueva. `isDefault: true` la vuelve la página de `/{accountCode}`.',
        'POST /v1/link-pages/:id/duplicate': 'Copia una página con un slug nuevo y sin publicar, para editarla para el próximo evento antes de publicarla.',
        'DELETE /v1/link-pages/:id': 'Borra una página; su dirección da 404. La página principal responde 409 `DEFAULT_PAGE`: primero haz principal otra página.',
        'GET /v1/notifications':
          'Los dos correos que dForms manda con cada respuesta: el aviso para tu equipo y el comprobante para quien respondió.',
        'PUT /v1/notifications/:emailKey': 'Activa o desactiva un correo, cambia su texto o quién recibe el aviso.',
        'POST /v1/notifications/:emailKey/reset': 'Devuelve el asunto y el cuerpo de un correo al texto por defecto.',
        'GET /v1/forms/:id/notifications': 'Los mismos dos correos para un form: lo que define el workspace y la versión propia del form, si la tiene.',
        'PUT /v1/forms/:id/notifications/:emailKey': 'Le da a un form su propia versión de un correo.',
        'POST /v1/forms/:id/notifications/:emailKey/reset':
          'Quita la versión propia del form, que vuelve a seguir lo que define el workspace.',
        'GET /v1/integrations': 'Qué integraciones conectó el workspace. Nunca devuelve un token.',
        'GET /v1/integrations/webhooks': 'Todos los webhooks a los que mandan los forms del workspace, con sus fallas recientes.',
        'GET /v1/integrations/hubspot/properties': 'Las propiedades de contacto de HubSpot a las que un destino puede mapear respuestas.',
        'GET /v1/integrations/calendly/event-types': 'Los tipos de evento de Calendly que puede agendar un paso de agenda.',
        'GET /v1/me': 'La persona y el workspace por los que actúa la llave, con el rol de la persona.',
        'GET /v1/me/profile': 'La página pública de la persona, si la configuró.',
        'GET /v1/vanity': 'El código público del workspace y el personalizado, si reclamó uno.',
      },
      params: {
        formId: 'El `id` del form, de `GET /v1/forms` o de la respuesta que lo creó.',
        folderPathId: 'El `id` de la carpeta, de `GET /v1/folders`.',
        submissionPathId: 'El `id` de la respuesta, de la lista de respuestas.',
        submissionDeleteId: 'El `id` de la respuesta, de la lista de respuestas.',
        fileStepKey: 'La `key` de la pregunta de subir archivo.',
        textStepKey: 'La `key` de una pregunta escrita (texto corto o largo, nombre, email, teléfono o URL).',
        emailKey: '`submission_received` es el aviso para tu equipo; `submission_confirmed`, el comprobante para quien respondió.',
        formName: 'El nombre del form en el dashboard, de 1 a 200 caracteres.',
        formSlug: 'La última parte de la URL pública. Si no lo mandas, sale del nombre.',
        formConfig:
          'El form en sí: `version: 1`, los `steps` y, si quieres, la portada, el puntaje, los resultados y el estilo. Solo se aceptan campos que el editor puede mostrar.',
        formFolderId: 'La carpeta en la que queda el form nuevo.',
        formConfigEdit: 'La config entera, con todos los pasos. Reemplaza el borrador; los pasos que no mandes se borran.',
        formNameEdit: 'Un nombre nuevo. Aplica de inmediato, sin publicar.',
        expectedUpdatedAt:
          'El `updatedAt` del form tal como lo leíste. Si alguien guardó el form desde entonces, recibes `409 STALE` en vez de pisar su trabajo.',
        newSlug: 'El slug nuevo: minúsculas, números y guiones, hasta 80 caracteres.',
        fileFolderId: 'El `id` de la carpeta, o `null` para sacar el form de su carpeta.',
        folderName: 'El nombre de la carpeta, de 1 a 80 caracteres, único en el workspace.',
        destinations:
          'Todos los destinos del form, cada uno `webhook` o `hubspot`. La lista reemplaza la actual; máximo un destino de HubSpot por form.',
        status: '`all` (por defecto), `completed` o `partial`.',
        from: 'Respuestas iniciadas desde este día: `YYYY-MM-DD` en la zona horaria del workspace, o epoch ms.',
        to: 'Respuestas iniciadas hasta este día: `YYYY-MM-DD` (el día completo) o epoch ms.',
        scoreMin: 'Puntaje mínimo, incluido. Se ignora si el form no tiene puntaje.',
        scoreMax: 'Puntaje máximo, incluido. Se ignora si el form no tiene puntaje.',
        answers: 'Respuestas de opción por las que filtrar, en JSON: `{"step_key": ["value"]}`. Codifícalo para URL.',
        search: 'Texto libre, que se busca en las respuestas escritas.',
        sort: '`newest` (por defecto), `oldest`, `score_desc` o `score_asc`.',
        limit: 'Respuestas por página, hasta 200.',
        offset: 'Cuántas respuestas saltar, para la página siguiente.',
        csvIds: 'Solo estas respuestas, por `id`, separadas por comas.',
        submissionIds: 'Los `id` de las respuestas que vas a borrar.',
        deliveryStatus: 'Estados a incluir, separados por comas: `failed` (por defecto), `done`, `pending` o `skipped`.',
        deliveryKind: 'Tipos a incluir, separados por comas, como `webhook`, `hubspot` o `email`.',
        deliveryLimit: 'Cuántos envíos devolver. 50 por defecto.',
        tz: 'Una zona horaria IANA (`America/Bogota`) para contar los días. Por defecto, la del workspace.',
        q: 'Texto a buscar en cualquier parte de la respuesta. Si no lo mandas, lista todas.',
        answersLimit: 'Respuestas por página, hasta 50.',
        brandLogo: 'El logo, como URL https. `null` lo quita.',
        brandPrimaryColor: 'El color de los botones y los resaltados.',
        brandBackground: 'El fondo de la página. Al definirlo, el form queda fijo en claro u oscuro.',
        brandForeground: 'El color del texto.',
        brandFontFamily: 'La tipografía: `figtree`, `poppins`, `inter`, `dm-sans`, `space-grotesk`, `manrope`, `work-sans`, `fraunces` o `playfair`.',
        brandRadius: 'Qué tan redondeadas son las esquinas.',
        brandButtonStyle: 'Cómo se dibujan los botones.',
        brandClientLogos: 'Logos de tus clientes para mostrar en la portada, hasta 24.',
        formIds: 'Los `id` de los forms, de 1 a 500.',
        linkPage: 'La página completa con `version: 1`, o `null` para borrarla.',
        linkPageEnabled: 'Publicada en la URL pública. `false` (por defecto) da 404 ahí.',
        linkPageName: 'El título, hasta 80 caracteres. Vacío o ausente muestra el nombre del workspace.',
        linkPageBio: 'Una línea bajo el título, hasta 280 caracteres.',
        linkPageLogo: 'Ausente usa el logo del brand kit, `null` no muestra ninguno, una URL http(s) muestra esa imagen.',
        linkPageItems: 'Los botones, en orden, hasta 30: `{ "type": "form", "formId" }` o `{ "type": "link", "label", "url" }`. Un form de otro workspace se descarta.',
        linkPageSocials: '`instagram`, `x`, `youtube` y `tiktok` (un link o un usuario) y `whatsapp` (el número con su código de país, empezando por `+`).',
        linkPageColors: 'Los colores propios de la página, `primaryColor`, `background` y `foreground`, en hex. Si falta uno, se usa el del brand kit.',
        linkPagePathId: 'El `id` de la página, de `GET /v1/link-pages`.',
        linkPagePageName: 'Un nombre interno para distinguir las páginas, hasta 80 caracteres. Los visitantes no lo ven.',
        linkPageSlug: 'La dirección después de `/p/`: de 3 a 30 letras minúsculas, números o guiones. Única en el workspace.',
        linkPageIsDefault: '`true` la vuelve la página de `/{accountCode}`; la principal anterior conserva su dirección con `/p/`. Solo una página publicada puede ser la principal (409 `PAGE_NOT_PUBLISHED`).',
        linkPageContent: 'Todo el contenido de la página, con la misma forma que recibe `PUT /v1/link-page`.',
        linkPageCopyName: 'El nombre interno de la copia. Si falta, conserva el del original.',
        linkPageCopySlug: 'El slug de la copia. Si falta, se usa el del original con `-2`, `-3` y así sucesivamente.',
        notificationEnabled: 'Si el correo se manda.',
        notificationSubject: 'El asunto, con marcadores `{{token}}` como `{{formName}}`. `null` vuelve al texto por defecto.',
        notificationBody: 'El cuerpo en texto plano, con marcadores `{{token}}`. `null` vuelve al texto por defecto.',
        notificationRecipients:
          'Quién recibe el aviso para tu equipo. No se acepta en `submission_confirmed`, que va a quien respondió.',
      },
      notAllowed: {
        title: 'Lo que una llave no puede hacer',
        intro:
          'Esto se queda en el dashboard, para una persona con sesión iniciada. Con una llave responde `403 KEY_NOT_ALLOWED`.',
        items: {
          keys: 'Crear, listar o revocar llaves de API.',
          members: 'Invitar, cambiar o quitar miembros, o reenviar invitaciones.',
          workspaces: 'Crear, renombrar o cambiar de workspace, o cambiar su zona horaria.',
          onboarding: 'Responder las preguntas del onboarding.',
          profile: 'Cambiar tu página pública, tu idioma o el código público personalizado del workspace.',
          integrations: 'Conectar o desconectar HubSpot o Calendly.',
        },
      },
    },
    publish: {
      publish: 'Publicar',
      publishing: 'Publicando…',
      published: 'Cambios publicados: tu formulario está en línea.',
      publishError: 'No se pudo publicar. Inténtalo de nuevo.',
      saveFirst: 'Tus últimos cambios no se pudieron guardar, así que no se publicó nada. Inténtalo cuando se guarden.',
      unpublishedChanges: 'Cambios sin publicar',
      noChanges: 'Todos los cambios están publicados',
      moreOptions: 'Opciones de publicación',
      revert: 'Volver a la versión publicada anterior',
      revertAvailable: 'Publicada el {date}',
      revertUnavailable: 'Todavía no hay una versión publicada anterior',
      revertTitle: '¿Volver a la versión publicada anterior?',
      revertBody:
        'La versión publicada el {date} vuelve a estar en línea, y la que está en línea ahora pasa a ser la anterior, así que puedes deshacerlo. Tu borrador no cambia.',
      revertConfirm: 'Volver a esa versión',
      reverting: 'Volviendo…',
      reverted: 'La versión anterior está en línea de nuevo.',
      revertError: 'No se pudo volver a la versión anterior. Inténtalo de nuevo.',
      revertSaveFirst: 'Tus últimos cambios no se pudieron guardar, así que no se revirtió nada. Inténtalo cuando se guarden.',
      nothingToRevert: 'No hay una versión publicada anterior a la que volver.',
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
    deleteFolderTitle: 'Eliminar carpeta',
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
