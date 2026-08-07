/**
 * The redesigned builder's message catalog (EN + ES). Co-located with the editor
 * because the redesign adds a large, editor-only string set; keeping it here (one
 * file, both locales) avoids threading dozens of keys through the shared i18n
 * catalog in three places. The Design tab still reuses the shared `editor.cover`
 * / `editor.preview` strings (see `messages.ts`); everything the new Build /
 * Logic / Results surfaces need lives here. Language policy: EN/ES parity for
 * every user-facing string (the live-chat exception does not apply to product UI).
 */

export interface BuilderMessages {
  shell: {
    back: string;
    formNamePlaceholder: string;
    tabBuild: string;
    tabLogic: string;
    tabDesign: string;
    saved: string;
    saving: string;
    draft: string;
    saveError: string;
    preview: string;
    publish: string;
    publishing: string;
    published: string;
    questions: string;
    addQuestion: string;
    /** "Question {n} of {total} · editing live" */
    questionOfTotal: string;
    editingLive: string;
    desktop: string;
    mobile: string;
    settings: string;
    copyLink: string;
    /** Embed-in-your-site dialog (iframe snippet + auto-height script). */
    embed: string;
    embedTitle: string;
    embedIntro: string;
    embedCopy: string;
    embedCopied: string;
    copied: string;
    openForm: string;
    /** The topbar's link popover, which now holds copy/embed/open (F1). */
    share: string;
    /** Accessible name for the per-tab contextual toolbar (topbar row 2). */
    toolbar: string;
  };
  /**
   * The per-question logic dialog (F0): ONE place holding a step's whole
   * routing — when it appears, where it goes next, and (for a scheduler) where
   * a booking leads. Opened from the Build panel, the Logic canvas, and the
   * form-wide Branching dialog, so all three edit the same thing.
   */
  logicDialog: {
    /** Trigger label in the Build panel / canvas hover buttons. */
    open: string;
    /** "Logic — {question}" */
    title: string;
    subtitle: string;
    visibility: string;
    visibilityHint: string;
    routing: string;
    routingHint: string;
    booking: string;
    bookingHint: string;
    /** "Highest possible score before this question: {n}" */
    scoreContext: string;
    /** Shown instead when nothing above this step awards points. */
    scoreContextNone: string;
    /** A step type with no forward-rule surface (free text, message, …). */
    noRouting: string;
    /** Plain-language summary line when the step carries no logic at all. */
    empty: string;
    done: string;
  };
  /**
   * F3b — the three FORM-WIDE logic editors, opened from the Logic tab's
   * contextual toolbar. The builder can otherwise only show logic ONE question
   * at a time; these three answer "what does this whole form do?" in one scroll.
   * Copy that already exists under `results.*` is reused rather than restated,
   * so the Results tab and these dialogs can never drift apart.
   */
  branching: {
    /** Trigger label in the Logic tab's contextual toolbar. */
    open: string;
    title: string;
    subtitle: string;
    /** "{n} of {total} questions carry logic." */
    summary: string;
    /** Shown instead when nothing routes yet. */
    summaryNone: string;
    /** Per-step control that hands off to the per-question logic dialog. */
    edit: string;
    /** aria-label for that control — `{question}` names which step it opens. */
    editAria: string;
    /** The form has no questions at all, so there is nothing to route. */
    empty: string;
    /**
     * Operand for a catch-all `goto` (stored as the value `*`). Printing the
     * raw `*` as if it were an answer the respondent could give is a lie; a
     * scheduler's catch-all fires on a booking, not on an answer at all.
     */
    anyAnswer: string;
    anyBooking: string;
    /**
     * R7 — the inline "Always go to" row every question carries. It edits the
     * catch-all rule; "next in order" means NO rule stored, which is the
     * engine's default walk.
     */
    alwaysGoTo: string;
    nextInOrder: string;
    endOfForm: string;
  };
  scoring: {
    open: string;
    title: string;
    subtitle: string;
    /** "Max {n}" — the ceiling this ONE question can contribute. */
    stepMax: string;
    /** A choice question with no options yet: nothing to attach points to. */
    noOptions: string;
    /** Why the points are shown but frozen while form-level scoring is off. */
    inert: string;
  };
  outcomes: {
    open: string;
    title: string;
    subtitle: string;
  };
  badges: {
    /** V5-QA — marks a step respondents never see. */
    hidden: string;
    contact: string;
    logic: string;
    /** "{n} rules" */
    rules: string;
    /** "1 rule" */
    ruleOne: string;
  };
  /** The partial-submit-point marker in the question spine (Typeform parity). */
  partial: {
    /** Marker-row label ("Partial submit point"). */
    label: string;
    /** Dashed "+ Partial submit point" affordance at the spine bottom. */
    add: string;
    /** aria-label of the marker's remove (×) button. */
    remove: string;
    /** aria-label of the marker's drag grip. */
    move: string;
    /** aria-label of the info toggle on the marker row. */
    info: string;
    /** Popover: what reaching this point captures. */
    tipCapture: string;
    /** Popover: how a partial is stored/upgraded. */
    tipStored: string;
    /** Lead-capture nudge: email question present but no threshold set. */
    suggestEmail: string;
    /** The nudge's one-click action label. */
    suggestEmailAction: string;
    /** Popover: privacy nudge about collecting unfinished answers. */
    tipNotify: string;
    /** Popover: where partials appear in the admin. */
    tipWhere: string;
    /** Popover extra line when the marker sits after the LAST question. */
    tipAfterLast: string;
    /** One-line pointer left in the Design tab (the select moved to the spine). */
    designNote: string;
  };
  canvas: {
    /** "Question {n}" */
    questionN: string;
    titlePlaceholder: string;
    descriptionPlaceholder: string;
    optionPlaceholder: string;
    addOption: string;
    next: string;
    submit: string;
    /** "{n} pts" */
    pts: string;
    messagePlaceholder: string;
    /** The reveal card's in-place copy editing + "plays for {ms} ms" caption. */
    revealHeadlinePlaceholder: string;
    revealSubtitlePlaceholder: string;
    revealPlays: string;
    /** Vertical layout: where the reveal actually plays (page-canvas block). */
    revealVerticalNote: string;
    /** V6 — the scheduler's live Calendly embed on the canvas. */
    schedulerUnset: string;
    schedulerNote: string;
    schedulerLoading: string;
    schedulerLoadError: string;
    /** Name-step preview defaults — MUST mirror the shared catalog's
     *  `renderer.name.*` so the canvas shows exactly what publishes. */
    nameFirstPlaceholder: string;
    nameLastPlaceholder: string;
  };
  settings: {
    /** A reveal STEP owns its copy here — there is no form-level reveal. */
    revealSection: string;
    revealHeadline: string;
    revealSubtitle: string;
    revealDuration: string;
    revealDurationHint: string;
    revealHint: string;
    revealPrewarm: string;
    revealPrewarmHint: string;
    /** V6 — the scheduler STEP picks a Calendly event type here. */
    schedulerSection: string;
    schedulerHint: string;
    schedulerEventType: string;
    schedulerPickPlaceholder: string;
    schedulerLoading: string;
    schedulerConnect: string;
    schedulerConnectCta: string;
    schedulerShowDetails: string;
    schedulerMapTitle: string;
    schedulerMapHint: string;
    schedulerMapPickFirst: string;
    schedulerMapName: string;
    schedulerMapEmail: string;
    schedulerMapAuto: string;
    /** V6 — where the form goes once the respondent books. */
    schedulerAfter: string;
    schedulerAfterHint: string;
    schedulerAfterContinue: string;
    schedulerAfterSubmit: string;
    title: string;
    questionType: string;
    required: string;
    options: string;
    addOption: string;
    /** How a choice question lays its options out: a list, or a card grid. */
    optionLayout: string;
    optionLayoutHint: string;
    optionLayoutList: string;
    optionLayoutCards: string;
    logic: string;
    addRule: string;
    scoring: string;
    scoringHint: string;
    /** V5-B2 — the per-question switch is inert while the form-level one is off. */
    scoringFormOff: string;
    /** Shown near the toggle when scoring is on but no points are assigned yet. */
    scoringZeroHint: string;
    contactHint: string;
    /** The collapsible Advanced group + what it says when shut. */
    advancedTitle: string;
    badgeDynamic: string;
    badgeEndsForm: string;
    badgeHidden: string;
    badgeRenamedKey: string;
    badgeScored: string;
    badgeDefault: string;
    /** The URL parameter that prefills this question (informational). */
    prefillTitle: string;
    prefillHint: string;
    prefillReadOnly: string;
    prefillCopy: string;
    prefillCopied: string;
    prefillUtmWarning: string;
    /** A value the answer starts with; anything in the URL wins over it. */
    defaultAnswer: string;
    defaultAnswerHint: string;
    defaultAnswerPlaceholder: string;
    delete: string;
    deleteConfirm: string;
    empty: string;
  };
  /** The `@` recall-information picker + `[token]` authoring warnings. */
  tokens: {
    hint: string;
    pickerLabel: string;
    pickerEmpty: string;
    pickerNoMatch: string;
    /** `{token}` is replaced with the bracketed token, e.g. `[firstname]`. */
    warnLater: string;
    warnUnknown: string;
    /** V5-A5 — bare `@key` that never became a token; `{fixed}` is `[key]`. */
    warnRaw: string;
  };
  /** Per-question HubSpot "Map to" section in the settings panel. */
  hubspot: {
    title: string;
    mapTo: string;
    mapToHint: string;
    /** The unmap option in the property picker. */
    none: string;
    saving: string;
    saved: string;
    saveError: string;
    loadError: string;
    retry: string;
    /** Connected account, but no enabled HubSpot destination on this form. */
    notEnabled: string;
    configureInConnect: string;
    /** No account-level HubSpot connection at all. */
    notConnected: string;
    goToConnections: string;
    /** The form has nothing that can identify a contact. */
    needsEmail: string;
    /** A booking would supply the address, but its provider is not connected. */
    schedulerDisconnected: string;
    /** A SCHEDULER step maps several booking facts, not one answer. */
    bookingIntro: string;
    /** Why the meeting time arrives as text, and where a real date lives. */
    bookingStartHint: string;
    /** Why the invitee's email is not in the list. */
    bookingEmailNote: string;
  };
  rules: {
    ifAnswerIs: string;
    then: string;
    chooseValue: string;
    jumpTo: string;
    skipToEnd: string;
    showQuestion: string;
    hideQuestion: string;
    chooseQuestion: string;
    add: string;
    remove: string;
    firstMatchWins: string;
    /** "jump to {target}" */
    jumpToTarget: string;
  };
  gallery: {
    title: string;
    search: string;
    groupContact: string;
    groupChoice: string;
    groupText: string;
    groupContent: string;
    hint: string;
    close: string;
    noResults: string;
    /** Vertical layout: why the reveal tile is off once the form has one. */
    revealVerticalTaken: string;
    items: Record<GalleryItemId, { title: string; desc: string }>;
  };
  map: {
    title: string;
    start: string;
    branchLegend: string;
    endLegend: string;
    /** "{n} branches" */
    branches: string;
    otherwise: string;
    end: string;
    result: string;
    thankYou: string;
    /** "Redirect → {url}" */
    redirect: string;
    /** "If {value} → skip to end" */
    skipEdge: string;
    /** "If {value} → {target}" */
    jumpEdge: string;
    empty: string;
    /** Caption under the Start node. */
    startHint: string;
    /** Caption on the default ("no rule matched") path so the flow is traceable. */
    otherwiseHint: string;
    /** Pill on a question that only shows when a show/hide condition holds. */
    conditional: string;
    /** V5-B4 — the show/hide rules spelled out on the map. */
    condShowIf: string;
    condHideIf: string;
    condIn: string;
    condEq: string;
    condGt: string;
    condLt: string;
    condBetween: string;
    condAnd: string;
    condBlank: string;
    /** Name for the reserved running-score condition source. */
    condScore: string;
    condMissingField: string;
    /** V5-QA — this step's rules mean it can never be shown. */
    neverAppears: string;
    /** Small kicker above a scored outcome node. */
    outcomeKicker: string;
    /**
     * The Logic canvas viewport controls (F3a). They live under `map.*` with the
     * rest of the flow-view copy so the read-only map and the interactive canvas
     * keep one vocabulary.
     */
    zoomIn: string;
    zoomOut: string;
    zoomFit: string;
    autoArrange: string;
    /** Muted footer hint: how to move a node / pan the canvas. */
    dragHint: string;
  };
  results: {
    pointsTitle: string;
    /** "Each answer adds to a score. Highest possible: {n}." */
    pointsHint: string;
    /** V5-QA — the same line while scoring is off (no total to promise). */
    pointsHintOff: string;
    endTitle: string;
    endHint: string;
    addRange: string;
    rangeLabel: string;
    rangeLabelPlaceholder: string;
    /** V5-QA — a range another range starts at or below: nothing lands here. */
    rangeUnreachable: string;
    thankYouMessage: string;
    redirect: string;
    redirectPlaceholder: string;
    messagePlaceholder: string;
    remove: string;
    scoringOff: string;
    enableScoring: string;
    /** "{min}+" and "{min}–{max}" handled in code */
    andAbove: string;
    noQuestions: string;
  };
  empty: {
    title: string;
    subtitle: string;
    /** Legacy inline "or start from scratch" affordance (kept for compatibility). */
    scratch: string;
    /** Title of the blank-canvas option presented first. */
    scratchTitle: string;
    /** One-line description under the blank-canvas option. */
    scratchDesc: string;
    /** Section-divider label above the template cards. */
    templatesLabel: string;
    templates: Record<TemplateId, { name: string; desc: string; meta: string }>;
  };
}

export type GalleryItemId =
  | 'name'
  | 'email'
  | 'phone'
  | 'single'
  | 'multiple'
  | 'dropdown'
  | 'short'
  | 'long'
  | 'slider'
  | 'message'
  | 'reveal'
  | 'scheduler';

export type TemplateId = 'lead' | 'contact' | 'feedback' | 'rsvp';

const en: BuilderMessages = {
  shell: {
    back: 'Forms',
    formNamePlaceholder: 'Untitled form',
    tabBuild: 'Build',
    tabLogic: 'Logic',
    tabDesign: 'Design',
    saved: 'Saved',
    saving: 'Saving…',
    draft: 'Draft',
    saveError: 'Not saved',
    preview: 'Preview',
    publish: 'Publish',
    publishing: 'Publishing…',
    published: 'Published',
    questions: 'Questions',
    addQuestion: 'Add question',
    questionOfTotal: 'Question {n} of {total}',
    editingLive: 'editing live',
    desktop: 'Desktop',
    mobile: 'Mobile',
    settings: 'Settings',
    copyLink: 'Copy link',
    embed: 'Embed',
    embedTitle: 'Embed this form on your site',
    embedIntro:
      'Paste this snippet into your page. The form loads inside it and grows to fit its content — the script keeps the height in sync, so there is never an inner scrollbar.',
    embedCopy: 'Copy snippet',
    embedCopied: 'Copied',
    copied: 'Copied',
    openForm: 'Open form',
    share: 'Share',
    toolbar: 'Tools',
  },
  logicDialog: {
    open: 'Edit logic',
    title: 'Logic — {question}',
    subtitle: 'Decide when this question appears and where it leads next.',
    visibility: 'When this question appears',
    visibilityHint: 'Leave both empty and it always appears.',
    routing: 'Where the answer leads',
    routingHint: 'The first matching rule wins; anything else continues in order.',
    booking: 'After a booking',
    bookingHint: 'Where a respondent lands once they book a slot.',
    scoreContext: 'Highest possible score before this question: {n}',
    scoreContextNone: 'No question above this one awards points, so a score rule would always read 0.',
    noRouting: 'This question type has no answer values to branch on. Use the visibility rules above.',
    empty: 'No logic yet — this question always appears and continues in order.',
    done: 'Done',
  },
  branching: {
    open: 'Branching',
    title: 'Branching',
    subtitle: 'Every question in order. Change where each one leads, right here.',
    summary: '{n} of {total} questions carry logic.',
    summaryNone: 'No question carries logic yet — everyone walks the same path.',
    edit: 'Edit',
    editAria: 'Edit the logic for {question}',
    empty: 'Add a question first — there is nothing to route yet.',
    anyAnswer: 'any answer',
    anyBooking: 'any booking',
    alwaysGoTo: 'Always go to',
    nextInOrder: 'Next question in order',
    endOfForm: 'End of the form',
  },
  scoring: {
    open: 'Scoring',
    title: 'Scoring',
    subtitle: 'Every point value in the form, editable here. A negative number subtracts.',
    stepMax: 'Max {n}',
    noOptions: 'No options yet — add some to award points.',
    inert:
      'Scoring is off, so none of these points are awarded. They are kept exactly as they are — turn scoring on to use them again.',
  },
  outcomes: {
    open: 'Outcomes',
    title: 'Outcomes',
    subtitle: 'Score ranges mapped to what a respondent sees at the end. The first matching range wins.',
  },
  badges: {
    hidden: 'Hidden',
    contact: 'Contact',
    logic: 'Logic',
    rules: '{n} rules',
    ruleOne: '1 rule',
  },
  partial: {
    label: 'Partial submit point',
    add: 'Partial submit point',
    remove: 'Remove partial submit point',
    move: 'Move partial submit point',
    info: 'About the partial submit point',
    tipCapture:
      'Captures respondents’ answers once they reach this point, even if they never finish the form.',
    tipStored:
      'Each partial is stored as a submission and upgraded in place if the respondent completes the form.',
    suggestEmail:
      'This form asks for an email, but answers are only saved at the end. Capture the lead as soon as they share their email — even if they never finish.',
    suggestEmailAction: 'Capture after the email question',
    tipNotify: 'Consider letting respondents know their answers may be collected before they submit.',
    tipWhere: 'View them in Submissions with the “Partial” filter.',
    tipAfterLast: 'After the last question it never fires — the final submit already captures everything.',
    designNote: 'Configured in the question list on the Build tab — look for the “Partial submit point” card.',
  },
  canvas: {
    questionN: 'Question {n}',
    titlePlaceholder: 'Type your question…',
    descriptionPlaceholder: 'Add a description (optional)',
    optionPlaceholder: 'Option',
    addOption: 'Add option',
    next: 'Next',
    submit: 'Submit',
    pts: '{n} pts',
    messagePlaceholder: 'Write your message…',
    revealHeadlinePlaceholder: 'Reviewing your answers…',
    revealSubtitlePlaceholder: 'Add a line of reassurance (optional)',
    revealPlays: 'Plays for {ms} ms, then the form continues on its own.',
    revealVerticalNote: 'Plays once, after Submit, before the result.',
    schedulerUnset: 'No event type picked yet',
    schedulerNote: 'Respondents pick a time here. Booking answers this question and moves the form on.',
    schedulerLoading: 'Loading the calendar…',
    schedulerLoadError: 'The calendar could not load. Check the event type is still available.',
    nameFirstPlaceholder: 'First name',
    nameLastPlaceholder: 'Last name',
  },
  settings: {
    title: 'Question settings',
    questionType: 'Question type',
    required: 'Required',
    options: 'Options',
    addOption: 'Add option',
    optionLayout: 'Show options as',
    optionLayoutHint:
      'Each option can carry an emoji or initials in both layouts. Cards lay them out in a centred grid and are the only layout that can show a logo.',
    optionLayoutList: 'List',
    optionLayoutCards: 'Cards',
    logic: 'Logic',
    addRule: 'Add rule',
    revealSection: 'Reveal screen',
    revealHeadline: 'Headline',
    revealSubtitle: 'Subtitle',
    revealDuration: 'Duration (ms)',
    revealDurationHint: 'How long it plays, 500–30000 ms. Default: 2200.',
    revealHint:
      'Plays here, then the form continues on its own. Drag the card in the list to move it. Both lines accept [field] tokens.',
    revealPrewarm: 'Pre-warm the booking embed',
    revealPrewarmHint: 'Loads the outcome’s booking calendar while this screen plays.',
    schedulerSection: 'Scheduler',
    schedulerHint: 'Pick a Calendly event type. When someone books, it counts as their answer.',
    schedulerEventType: 'Event type',
    schedulerPickPlaceholder: 'Select an event type…',
    schedulerLoading: 'Loading event types…',
    schedulerConnect: 'Connect Calendly in Integrations to pick an event type.',
    schedulerConnectCta: 'Go to Integrations',
    schedulerShowDetails: 'Show event details',
    schedulerMapTitle: 'Autofill the booking form',
    schedulerMapHint: 'Send answers from earlier questions into the fields this event asks for.',
    schedulerMapPickFirst: 'Pick an event type to see the fields its booking form asks for.',
    schedulerMapName: 'Name',
    schedulerMapEmail: 'Email',
    schedulerMapAuto: 'Automatic',
    schedulerAfter: 'After booking',
    schedulerAfterHint: 'What happens once the respondent picks a time.',
    schedulerAfterContinue: 'Continue to the next question',
    schedulerAfterSubmit: 'Submit the form and show the ending',
    scoring: 'Scoring',
    scoringHint:
      'Counts this question toward the score. Points from the selected option add to the total; set ranges in Results.',
    scoringFormOff: 'Scoring is off for the whole form — turn it on in Results to score individual questions.',
    scoringZeroHint: 'Assign points to your answers to enable ranges.',
    contactHint: 'Contact field — doesn’t affect the score.',
    advancedTitle: 'Advanced settings',
    badgeDynamic: 'Dynamic',
    badgeEndsForm: 'Ends form',
    badgeHidden: 'Hidden',
    badgeRenamedKey: 'Custom key',
    badgeScored: 'Scored',
    badgeDefault: 'Default set',
    prefillTitle: 'Prefill from URL',
    prefillHint: 'Add this parameter to the link and the answer arrives filled in.',
    prefillReadOnly: 'read only',
    prefillCopy: 'Copy',
    prefillCopied: 'Copied',
    prefillUtmWarning:
      'A key starting with utm_ is never read from the URL — those are captured separately as campaign data. Rename the key to make prefill work.',
    defaultAnswer: 'Default answer',
    defaultAnswerHint: 'Used when the link carries no value. Anything in the URL wins over this.',
    defaultAnswerPlaceholder: 'Leave empty for none',
    delete: 'Delete question',
    deleteConfirm: 'Delete this question?',
    empty: 'Select a question to edit it.',
  },
  tokens: {
    hint: 'Type @ or [field] to insert a previous answer',
    pickerLabel: 'Insert a previous answer',
    pickerEmpty: 'No earlier answers yet — this is the first question.',
    pickerNoMatch: 'No matching fields.',
    warnLater: '“{token}” is asked after this step — it will be empty here.',
    warnUnknown: '“{token}” doesn’t exist in this form.',
    warnRaw: '“{token}” stays as literal text — only {fixed} fills in an answer. Pick the field from the list to insert it.',
  },
  hubspot: {
    title: 'HubSpot',
    mapTo: 'Map to',
    mapToHint: 'This answer updates the selected HubSpot contact property.',
    none: 'None',
    saving: 'Saving…',
    saved: 'Saved',
    saveError: 'Couldn’t save the mapping. Your change was reverted.',
    loadError: 'Couldn’t load the HubSpot mapping.',
    retry: 'Retry',
    notEnabled: 'HubSpot isn’t enabled on this form.',
    configureInConnect: 'Set up in Connect',
    notConnected: 'Connect HubSpot to map answers to contact properties.',
    goToConnections: 'Go to Connections',
    needsEmail:
      'This form asks for no email and books nothing, so HubSpot has no way to identify the contact — nothing mapped here would sync. Add an email question, or a booking step.',
    schedulerDisconnected:
      'The booking step would supply the address, but Calendly is not connected for this account — so the invitee cannot be read back and nothing mapped here will reach HubSpot.',
    bookingIntro: 'A booking produces these. Send each one to a contact property.',
    bookingStartHint:
      'Sent as text, exactly as the booking reported it. For a real HubSpot date property, use the booking sync in Connect.',
    bookingEmailNote:
      'The invitee’s email is the contact key — the booking supplies it, so it is never mapped here.',
  },
  rules: {
    ifAnswerIs: 'If answer is',
    then: 'then',
    chooseValue: 'choose a value',
    jumpTo: 'jump to',
    skipToEnd: 'skip to end',
    showQuestion: 'show',
    hideQuestion: 'hide',
    chooseQuestion: 'choose a question',
    add: 'Add rule',
    remove: 'Remove rule',
    firstMatchWins: 'Rules run top to bottom; the first match wins. Anyone who doesn’t match continues in order.',
    jumpToTarget: 'jump to {target}',
  },
  gallery: {
    title: 'Add a question',
    search: 'Search question types',
    groupContact: 'Contact',
    groupChoice: 'Choice',
    groupText: 'Text',
    groupContent: 'Content',
    hint: 'Picking a type drops the question in and focuses the canvas to edit it.',
    close: 'Close',
    noResults: 'No matching types.',
    revealVerticalTaken: 'Already added — a one-page form plays its reveal once, after Submit.',
    items: {
      name: { title: 'Name', desc: 'Full name field' },
      email: { title: 'Email', desc: 'Validated email' },
      phone: { title: 'Phone', desc: 'Number with country' },
      single: { title: 'Single choice', desc: 'Pick one' },
      multiple: { title: 'Multiple choice', desc: 'Pick several' },
      dropdown: { title: 'Dropdown', desc: 'Compact list' },
      short: { title: 'Short text', desc: 'One line' },
      long: { title: 'Long text', desc: 'Paragraph' },
      slider: { title: 'Slider', desc: 'Rating scale' },
      message: { title: 'Message', desc: 'Text, no input' },
      reveal: { title: 'Reveal screen', desc: 'A short processing pause' },
      scheduler: { title: 'Scheduler', desc: 'Book a meeting on your calendar' },
    },
  },
  map: {
    title: 'Logic map · how answers route through the form',
    start: 'Start',
    branchLegend: 'Branch',
    endLegend: 'End / result',
    branches: '{n} branches',
    otherwise: 'Otherwise',
    end: 'end',
    result: 'Result',
    thankYou: 'Thank you',
    redirect: 'Redirect → {url}',
    skipEdge: 'If {value} → skip to end',
    jumpEdge: 'If {value} → {target}',
    empty: 'Add questions to see how answers route through your form.',
    startHint: 'Respondents start here',
    otherwiseHint: 'if no rule matches, continue in order',
    conditional: 'Conditional',
    condShowIf: 'Show if',
    condHideIf: 'Hide if',
    condIn: 'is any of',
    condEq: 'equals',
    condGt: 'is greater than',
    condLt: 'is less than',
    condBetween: 'is between',
    condAnd: 'and',
    condBlank: '(not set)',
    condScore: 'Score so far',
    condMissingField: 'question deleted',
    neverAppears: 'These rules mean this question never appears.',
    outcomeKicker: 'Ending',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomFit: 'Fit to screen',
    autoArrange: 'Auto-arrange',
    dragHint: 'Drag a card to move it · drag the canvas to pan',
  },
  results: {
    pointsTitle: 'Points',
    pointsHint: 'Each answer adds to a score. Highest possible: {n}.',
    pointsHintOff: 'Scoring is off — no answer adds to a score right now.',
    endTitle: 'What happens at the end',
    endHint: 'Map score ranges to an outcome. The first matching range wins.',
    addRange: 'Add a range',
    rangeLabel: 'Label',
    rangeLabelPlaceholder: 'e.g. You’re a great fit',
    rangeUnreachable: 'never',
    thankYouMessage: 'Thank-you message',
    redirect: 'Redirect',
    redirectPlaceholder: 'https://…',
    messagePlaceholder: '“Thanks — we’ll be in touch.”',
    remove: 'Remove range',
    scoringOff: 'Scoring is off. Turn it on to score answers and route by result.',
    enableScoring: 'Enable scoring',
    andAbove: 'and above',
    noQuestions: 'Add scoring questions to set up points.',
  },
  empty: {
    title: 'Let’s build your form',
    subtitle: 'Begin with a blank canvas, or pick a ready-made template to edit live.',
    scratch: 'or start from scratch — add your first question',
    scratchTitle: 'Start from scratch',
    scratchDesc: 'Begin with a blank canvas and add your own questions.',
    templatesLabel: 'Or choose a template',
    templates: {
      lead: {
        name: 'Lead qualifier',
        desc: 'Score prospects and route hot leads to a booking link.',
        meta: '6 questions · scoring · logic',
      },
      contact: {
        name: 'Contact form',
        desc: 'Name, email and a message — sent to your inbox or CRM.',
        meta: '3 questions · no scoring',
      },
      feedback: {
        name: 'Feedback survey',
        desc: 'Rating scale plus open comments to gauge satisfaction.',
        meta: '4 questions · scale',
      },
      rsvp: {
        name: 'RSVP',
        desc: 'Collect attendance, headcount and dietary notes for an event.',
        meta: '4 questions · logic',
      },
    },
  },
};

const es: BuilderMessages = {
  shell: {
    back: 'Formularios',
    formNamePlaceholder: 'Formulario sin título',
    tabBuild: 'Construir',
    tabLogic: 'Lógica',
    tabDesign: 'Diseño',
    saved: 'Guardado',
    saving: 'Guardando…',
    draft: 'Borrador',
    saveError: 'Sin guardar',
    preview: 'Vista previa',
    publish: 'Publicar',
    publishing: 'Publicando…',
    published: 'Publicado',
    questions: 'Preguntas',
    addQuestion: 'Añadir pregunta',
    questionOfTotal: 'Pregunta {n} de {total}',
    editingLive: 'edición en vivo',
    desktop: 'Escritorio',
    mobile: 'Móvil',
    settings: 'Ajustes',
    copyLink: 'Copiar enlace',
    embed: 'Insertar',
    embedTitle: 'Inserta este formulario en tu sitio',
    embedIntro:
      'Pega este fragmento en tu página. El formulario carga dentro y crece según su contenido — el script mantiene la altura sincronizada, así nunca hay scroll interno.',
    embedCopy: 'Copiar fragmento',
    embedCopied: 'Copiado',
    copied: 'Copiado',
    openForm: 'Abrir formulario',
    share: 'Compartir',
    toolbar: 'Herramientas',
  },
  logicDialog: {
    open: 'Editar lógica',
    title: 'Lógica — {question}',
    subtitle: 'Define cuándo aparece esta pregunta y a dónde lleva después.',
    visibility: 'Cuándo aparece esta pregunta',
    visibilityHint: 'Si dejas las dos vacías, aparece siempre.',
    routing: 'A dónde lleva la respuesta',
    routingHint: 'Gana la primera regla que coincida; el resto sigue en orden.',
    booking: 'Después de agendar',
    bookingHint: 'A dónde llega quien reserva un espacio.',
    scoreContext: 'Puntaje máximo posible antes de esta pregunta: {n}',
    scoreContextNone: 'Ninguna pregunta anterior suma puntos, así que una regla por puntaje siempre leería 0.',
    noRouting: 'Este tipo de pregunta no tiene valores de respuesta para ramificar. Usa las reglas de visibilidad de arriba.',
    empty: 'Sin lógica — esta pregunta siempre aparece y continúa en orden.',
    done: 'Listo',
  },
  branching: {
    open: 'Ramificación',
    title: 'Ramificación',
    subtitle: 'Todas las preguntas en orden. Cambia a dónde lleva cada una, aquí mismo.',
    summary: '{n} de {total} preguntas tienen lógica.',
    summaryNone: 'Ninguna pregunta tiene lógica todavía — todos recorren el mismo camino.',
    edit: 'Editar',
    editAria: 'Editar la lógica de {question}',
    empty: 'Añade una pregunta primero — todavía no hay nada que enrutar.',
    anyAnswer: 'cualquier respuesta',
    anyBooking: 'cualquier reserva',
    alwaysGoTo: 'Siempre va a',
    nextInOrder: 'Siguiente pregunta en orden',
    endOfForm: 'Fin del formulario',
  },
  scoring: {
    open: 'Puntaje',
    title: 'Puntaje',
    subtitle: 'Todos los puntos del formulario, editables aquí. Un número negativo resta.',
    stepMax: 'Máx {n}',
    noOptions: 'Sin opciones todavía — añade algunas para asignar puntos.',
    inert:
      'El puntaje está apagado, así que estos puntos no se otorgan. Se conservan tal cual — actívalo para volver a usarlos.',
  },
  outcomes: {
    open: 'Resultados',
    title: 'Resultados',
    subtitle: 'Rangos de puntaje asignados a lo que ve quien responde al final. Gana el primer rango que coincida.',
  },
  badges: {
    hidden: 'Oculta',
    contact: 'Contacto',
    logic: 'Lógica',
    rules: '{n} reglas',
    ruleOne: '1 regla',
  },
  partial: {
    label: 'Punto de envío parcial',
    add: 'Punto de envío parcial',
    remove: 'Quitar el punto de envío parcial',
    move: 'Mover el punto de envío parcial',
    info: 'Acerca del punto de envío parcial',
    tipCapture:
      'Captura las respuestas cuando la persona llega a este punto, aunque nunca termine el formulario.',
    tipStored:
      'Cada parcial se guarda como un envío y se actualiza en su lugar si la persona completa el formulario.',
    suggestEmail:
      'Este formulario pide un email, pero las respuestas solo se guardan al final. Captura el lead en cuanto comparta su email — aunque nunca termine.',
    suggestEmailAction: 'Capturar tras la pregunta de email',
    tipNotify: 'Considera avisar a tus respondientes de que sus respuestas pueden recopilarse antes de enviar.',
    tipWhere: 'Míralos en Envíos con el filtro «Parciales».',
    tipAfterLast: 'Después de la última pregunta nunca se activa — el envío final ya lo captura todo.',
    designNote:
      'Se configura en la lista de preguntas, en la pestaña Construir — busca la tarjeta «Punto de envío parcial».',
  },
  canvas: {
    questionN: 'Pregunta {n}',
    titlePlaceholder: 'Escribe tu pregunta…',
    descriptionPlaceholder: 'Añade una descripción (opcional)',
    optionPlaceholder: 'Opción',
    addOption: 'Añadir opción',
    next: 'Siguiente',
    submit: 'Enviar',
    pts: '{n} pts',
    messagePlaceholder: 'Escribe tu mensaje…',
    revealHeadlinePlaceholder: 'Revisando tus respuestas…',
    revealSubtitlePlaceholder: 'Añade una línea que tranquilice (opcional)',
    revealPlays: 'Se muestra {ms} ms y luego el formulario continúa solo.',
    revealVerticalNote: 'Se muestra una vez, después de Enviar y antes del resultado.',
    schedulerUnset: 'Aún no eliges un tipo de evento',
    schedulerNote: 'Aquí eligen un horario. Agendar responde esta pregunta y avanza el formulario.',
    schedulerLoading: 'Cargando el calendario…',
    schedulerLoadError: 'No se pudo cargar el calendario. Revisa que el tipo de evento siga disponible.',
    nameFirstPlaceholder: 'Nombre',
    nameLastPlaceholder: 'Apellidos',
  },
  settings: {
    title: 'Ajustes de la pregunta',
    questionType: 'Tipo de pregunta',
    required: 'Obligatoria',
    options: 'Opciones',
    addOption: 'Añadir opción',
    optionLayout: 'Mostrar opciones como',
    optionLayoutHint:
      'Cada opción puede llevar un emoji o iniciales en ambos diseños. Las tarjetas los ordenan en una cuadrícula centrada y son el único diseño que puede mostrar un logo.',
    optionLayoutList: 'Lista',
    optionLayoutCards: 'Tarjetas',
    logic: 'Lógica',
    addRule: 'Añadir regla',
    revealSection: 'Pantalla de revelación',
    revealHeadline: 'Titular',
    revealSubtitle: 'Subtítulo',
    revealDuration: 'Duración (ms)',
    revealDurationHint: 'Cuánto se muestra, 500–30000 ms. Por defecto: 2200.',
    revealHint:
      'Se muestra aquí y el formulario continúa solo. Arrastra la tarjeta en la lista para moverla. Ambas líneas aceptan tokens [campo].',
    revealPrewarm: 'Precargar el calendario',
    revealPrewarmHint: 'Carga el calendario de agendamiento del resultado mientras se muestra esta pantalla.',
    schedulerSection: 'Agendador',
    schedulerHint: 'Elige un tipo de evento de Calendly. Cuando alguien agenda, cuenta como su respuesta.',
    schedulerEventType: 'Tipo de evento',
    schedulerPickPlaceholder: 'Selecciona un tipo de evento…',
    schedulerLoading: 'Cargando tipos de evento…',
    schedulerConnect: 'Conecta Calendly en Integraciones para elegir un tipo de evento.',
    schedulerConnectCta: 'Ir a Integraciones',
    schedulerShowDetails: 'Mostrar detalles del evento',
    schedulerMapTitle: 'Autocompletar el formulario de agendamiento',
    schedulerMapHint: 'Envía respuestas de preguntas anteriores a los campos que pide este evento.',
    schedulerMapPickFirst:
      'Elige un tipo de evento para ver los campos que pide su formulario de agendamiento.',
    schedulerMapName: 'Nombre',
    schedulerMapEmail: 'Correo electrónico',
    schedulerMapAuto: 'Automático',
    schedulerAfter: 'Al agendar',
    schedulerAfterHint: 'Qué pasa cuando la persona elige un horario.',
    schedulerAfterContinue: 'Continuar a la siguiente pregunta',
    schedulerAfterSubmit: 'Enviar el formulario y mostrar el final',
    scoring: 'Puntaje',
    scoringHint:
      'Cuenta esta pregunta para el puntaje. Los puntos de la opción elegida suman al total; define los rangos en Resultados.',
    scoringFormOff: 'El puntaje está apagado para todo el formulario — enciéndelo en Resultados para puntuar preguntas individuales.',
    scoringZeroHint: 'Asigna puntos a tus respuestas para habilitar los rangos.',
    contactHint: 'Campo de contacto — no afecta el puntaje.',
    advancedTitle: 'Ajustes avanzados',
    badgeDynamic: 'Dinámica',
    badgeEndsForm: 'Termina el formulario',
    badgeHidden: 'Oculta',
    badgeRenamedKey: 'Clave propia',
    badgeScored: 'Con puntos',
    badgeDefault: 'Con valor por defecto',
    prefillTitle: 'Prellenar desde la URL',
    prefillHint: 'Agrega este parámetro al link y la respuesta llega llena.',
    prefillReadOnly: 'solo lectura',
    prefillCopy: 'Copiar',
    prefillCopied: 'Copiado',
    prefillUtmWarning:
      'Una clave que empieza con utm_ nunca se lee de la URL: esas se capturan aparte como datos de campaña. Renombra la clave para que el prellenado funcione.',
    defaultAnswer: 'Respuesta por defecto',
    defaultAnswerHint: 'Se usa cuando el link no trae valor. Lo que venga en la URL gana sobre esto.',
    defaultAnswerPlaceholder: 'Vacío para ninguna',
    delete: 'Eliminar pregunta',
    deleteConfirm: '¿Eliminar esta pregunta?',
    empty: 'Selecciona una pregunta para editarla.',
  },
  tokens: {
    hint: 'Escribe @ o [campo] para insertar una respuesta anterior',
    pickerLabel: 'Insertar una respuesta anterior',
    pickerEmpty: 'Aún no hay respuestas anteriores — esta es la primera pregunta.',
    pickerNoMatch: 'Ningún campo coincide.',
    warnLater: '«{token}» se pregunta después de este paso — quedará vacío.',
    warnUnknown: '«{token}» no existe en este formulario.',
    warnRaw: '«{token}» queda como texto literal — solo {fixed} rellena una respuesta. Elige el campo de la lista para insertarlo.',
  },
  hubspot: {
    title: 'HubSpot',
    mapTo: 'Asignar a',
    mapToHint: 'Esta respuesta actualiza la propiedad seleccionada del contacto en HubSpot.',
    none: 'Ninguna',
    saving: 'Guardando…',
    saved: 'Guardado',
    saveError: 'No se pudo guardar la asignación. Se revirtió el cambio.',
    loadError: 'No se pudo cargar la asignación de HubSpot.',
    retry: 'Reintentar',
    notEnabled: 'HubSpot no está habilitado en este formulario.',
    configureInConnect: 'Configurar en Conectar',
    notConnected: 'Conecta HubSpot para asignar respuestas a propiedades del contacto.',
    goToConnections: 'Ir a Conexiones',
    needsEmail:
      'Este formulario no pide correo ni agenda nada, así que HubSpot no tiene cómo identificar al contacto — nada de lo que mapees acá se va a sincronizar. Agregá una pregunta de correo, o un paso de agenda.',
    schedulerDisconnected:
      'El paso de agenda aportaría el correo, pero Calendly no está conectado en esta cuenta — así que no se puede leer al invitado y nada de lo mapeado acá va a llegar a HubSpot.',
    bookingIntro: 'Una reserva produce estos datos. Mandá cada uno a una propiedad del contacto.',
    bookingStartHint:
      'Se envía como texto, tal cual lo reportó la reserva. Para una propiedad de fecha real de HubSpot, usá la sincronización de reservas en Conectar.',
    bookingEmailNote:
      'El correo del invitado es la llave del contacto: lo aporta la reserva, por eso no se mapea acá.',
  },
  rules: {
    ifAnswerIs: 'Si la respuesta es',
    then: 'entonces',
    chooseValue: 'elige un valor',
    jumpTo: 'saltar a',
    skipToEnd: 'ir al final',
    showQuestion: 'mostrar',
    hideQuestion: 'ocultar',
    chooseQuestion: 'elige una pregunta',
    add: 'Añadir regla',
    remove: 'Quitar regla',
    firstMatchWins: 'Las reglas se evalúan de arriba hacia abajo; gana la primera coincidencia. Quien no coincida continúa en orden.',
    jumpToTarget: 'saltar a {target}',
  },
  gallery: {
    title: 'Añadir una pregunta',
    search: 'Buscar tipos de pregunta',
    groupContact: 'Contacto',
    groupChoice: 'Elección',
    groupText: 'Texto',
    groupContent: 'Contenido',
    hint: 'Al elegir un tipo se añade la pregunta y se enfoca el lienzo para editarla.',
    close: 'Cerrar',
    noResults: 'No hay tipos que coincidan.',
    revealVerticalTaken: 'Ya añadida — un formulario de una página muestra su revelación una vez, después de Enviar.',
    items: {
      name: { title: 'Nombre', desc: 'Campo de nombre completo' },
      email: { title: 'Correo', desc: 'Correo validado' },
      phone: { title: 'Teléfono', desc: 'Número con país' },
      single: { title: 'Opción única', desc: 'Elegir una' },
      multiple: { title: 'Opción múltiple', desc: 'Elegir varias' },
      dropdown: { title: 'Desplegable', desc: 'Lista compacta' },
      short: { title: 'Texto corto', desc: 'Una línea' },
      long: { title: 'Texto largo', desc: 'Párrafo' },
      slider: { title: 'Deslizador', desc: 'Escala de valoración' },
      message: { title: 'Mensaje', desc: 'Texto, sin campo' },
      reveal: { title: 'Pantalla de revelación', desc: 'Una breve pausa de procesamiento' },
      scheduler: { title: 'Agendador', desc: 'Agenda una reunión en tu calendario' },
    },
  },
  map: {
    title: 'Mapa de lógica · cómo las respuestas recorren el formulario',
    start: 'Inicio',
    branchLegend: 'Rama',
    endLegend: 'Fin / resultado',
    branches: '{n} ramas',
    otherwise: 'En caso contrario',
    end: 'fin',
    result: 'Resultado',
    thankYou: 'Gracias',
    redirect: 'Redirigir → {url}',
    skipEdge: 'Si {value} → ir al final',
    jumpEdge: 'Si {value} → {target}',
    empty: 'Añade preguntas para ver cómo las respuestas recorren tu formulario.',
    startHint: 'Aquí empiezan las personas',
    otherwiseHint: 'si ninguna regla coincide, continúa en orden',
    conditional: 'Condicional',
    condShowIf: 'Mostrar si',
    condHideIf: 'Ocultar si',
    condIn: 'es alguno de',
    condEq: 'es igual a',
    condGt: 'es mayor que',
    condLt: 'es menor que',
    condBetween: 'está entre',
    condAnd: 'y',
    condBlank: '(sin definir)',
    condScore: 'Puntaje hasta aquí',
    condMissingField: 'pregunta eliminada',
    neverAppears: 'Con estas reglas, esta pregunta nunca aparece.',
    outcomeKicker: 'Final',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    zoomFit: 'Ajustar a la pantalla',
    autoArrange: 'Ordenar automáticamente',
    dragHint: 'Arrastra una tarjeta para moverla · arrastra el lienzo para desplazarlo',
  },
  results: {
    pointsTitle: 'Puntos',
    pointsHint: 'Cada respuesta suma al puntaje. Máximo posible: {n}.',
    pointsHintOff: 'El puntaje está apagado — ninguna respuesta suma por ahora.',
    endTitle: 'Qué pasa al final',
    endHint: 'Asigna rangos de puntaje a un resultado. Gana el primer rango que coincida.',
    addRange: 'Añadir un rango',
    rangeLabel: 'Etiqueta',
    rangeLabelPlaceholder: 'p. ej. Eres un buen fit',
    rangeUnreachable: 'nunca',
    thankYouMessage: 'Mensaje de agradecimiento',
    redirect: 'Redirigir',
    redirectPlaceholder: 'https://…',
    messagePlaceholder: '«Gracias — te contactaremos.»',
    remove: 'Quitar rango',
    scoringOff: 'El puntaje está desactivado. Actívalo para puntuar respuestas y enrutar por resultado.',
    enableScoring: 'Activar puntaje',
    andAbove: 'y más',
    noQuestions: 'Añade preguntas con puntaje para configurar los puntos.',
  },
  empty: {
    title: 'Construyamos tu formulario',
    subtitle: 'Comienza con un lienzo en blanco, o elige una plantilla lista para editar en vivo.',
    scratch: 'o empieza desde cero — añade tu primera pregunta',
    scratchTitle: 'Empezar desde cero',
    scratchDesc: 'Comienza con un lienzo en blanco y añade tus propias preguntas.',
    templatesLabel: 'O elige una plantilla',
    templates: {
      lead: {
        name: 'Calificador de leads',
        desc: 'Puntúa prospectos y envía los leads calientes a un enlace de reserva.',
        meta: '6 preguntas · puntaje · lógica',
      },
      contact: {
        name: 'Formulario de contacto',
        desc: 'Nombre, correo y un mensaje — enviado a tu bandeja o CRM.',
        meta: '3 preguntas · sin puntaje',
      },
      feedback: {
        name: 'Encuesta de opinión',
        desc: 'Escala de valoración más comentarios abiertos para medir la satisfacción.',
        meta: '4 preguntas · escala',
      },
      rsvp: {
        name: 'Confirmación de asistencia',
        desc: 'Recopila asistencia, número de personas y notas de dieta para un evento.',
        meta: '4 preguntas · lógica',
      },
    },
  },
};

const CATALOG: Record<'en' | 'es', BuilderMessages> = { en, es };

/** Resolve the builder catalog for a locale (defaults to EN for unknown locales). */
export function getBuilderMessages(locale: string): BuilderMessages {
  return CATALOG[locale === 'es' ? 'es' : 'en'];
}

/** Tiny `{var}` interpolation shared by the builder surfaces. */
export function tb(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ''));
}
