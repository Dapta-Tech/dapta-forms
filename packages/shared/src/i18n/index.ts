/** i18n for the public booking surface — EN/ES message catalogs + interpolation. */

export type Locale = 'en' | 'es';

/** The notification-email catalog (mirrors @slate/notifications EMAIL_TEMPLATE_KEYS). */
export type NotificationEmailKey =
  | 'attendee_confirmation'
  | 'attendee_pending'
  | 'attendee_declined'
  | 'attendee_reschedule'
  | 'attendee_cancellation'
  | 'attendee_reminder'
  | 'host_booked'
  | 'host_rescheduled'
  | 'host_cancelled'
  | 'host_declined'
  | 'host_reminder'
  | 'follow_up';

export interface BookingMessages {
  booking: {
    selectTime: string;
    durationMinutes: string;
    timezoneLabel: string;
    timezone: string;
    noSlots: string;
    /** Config-error emptiness (public-safe: never names internals). */
    noTimesNow: string;
    /** External calendar unreachable (public-safe). */
    timesUnavailable: string;
    calendarUnavailableTitle: string;
    calendarUnavailableBody: string;
    book: string;
    confirm: string;
    confirming: string;
    confirmed: string;
    requested: string;
    awaitingConfirmation: string;
    confirmationSentTo: string;
    yourName: string;
    yourEmail: string;
    notes: string;
    heldUntil: string;
    slotTaken: string;
    holdExpired: string;
    pickAnother: string;
    retry: string;
    poweredBy: string;
    with: string;
    seatsLeft: string;
    full: string;
  };
  manage: {
    title: string;
    reschedule: string;
    rescheduling: string;
    rescheduleTo: string;
    cancel: string;
    cancelling: string;
    cancelReason: string;
    cancelled: string;
    rescheduled: string;
    cannotChange: string;
    withLabel: string;
    bookingIs: string;
    alreadyTookPlace: string;
    statusPending: string;
    statusCancelled: string;
    statusRejected: string;
    cancelThis: string;
    noOpenTimes: string;
    whereLabel: string;
    joinMeeting: string;
  };
  /** Growth loop — public-page attribution badge + confirmation signup CTA. */
  growth: {
    madeWith: string;
    ctaQuestion: string;
    ctaAction: string;
    /** SEO/OG meta descriptions for the public pages (host/event data only). */
    seoProfile: string;
    seoEvent: string;
  };
  /** Team scheduling method names (the FREE layer competitors paywall). */
  scheduling: {
    round_robin: string;
    collective: string;
    fixed_round_robin: string;
    /** Short one-line descriptions for the event-type editor selector. */
    round_robin_hint: string;
    collective_hint: string;
    fixed_round_robin_hint: string;
  };
  /** Admin dashboard surface (F8 parity). Reuses the same catalog/locale mechanism. */
  admin: {
    nav: {
      home: string;
      bookings: string;
      availability: string;
      eventTypes: string;
      teams: string;
      calendars: string;
      settings: string;
      bookingPage: string;
    };
    common: {
      save: string;
      saving: string;
      cancel: string;
      delete: string;
      deleting: string;
      edit: string;
      remove: string;
      add: string;
      create: string;
      creating: string;
      confirm: string;
      back: string;
      retry: string;
      loading: string;
      saved: string;
      search: string;
      none: string;
      signOut: string;
      viewPublic: string;
      language: string;
      collapse: string;
      expand: string;
      switcher: {
        trigger: string;
        menuLabel: string;
        eyebrow: string;
        comingSoon: string;
        opensNewTab: string;
        forms: string;
      };
    };
    home: {
      welcome: string;
      welcomeNamed: string;
      subtitle: string;
      bookingLink: string;
      /** CopyLink button labels (booking-link card). */
      copy: string;
      copied: string;
      open: string;
      statEventTypes: string;
      statUpcoming: string;
      statTeams: string;
      createEvent: string;
      createEventDesc: string;
      setAvailability: string;
      setAvailabilityDesc: string;
      stylePage: string;
      stylePageDesc: string;
      apiKeys: string;
      apiKeysDesc: string;
    };
    settings: {
      title: string;
      subtitle: string;
      general: string;
      bookingPage: string;
      members: string;
      developer: string;
      notifications: string;
    };
    eventTypes: {
      title: string;
      newEventType: string;
      emptyList: string;
      hidden: string;
      needsConfirmation: string;
      minSuffix: string;
      fTitle: string;
      fSlug: string;
      fDescription: string;
      fLocation: string;
      locationPlaceholder: string;
      fLength: string;
      fSlotInterval: string;
      fMinNotice: string;
      fBufferBefore: string;
      fBufferAfter: string;
      fSeats: string;
      fSchedule: string;
      useDefaultSchedule: string;
      noSchedules: string;
      requiresConfirmation: string;
      hiddenLabel: string;
      intakeQuestions: string;
      namePlaceholder: string;
      labelPlaceholder: string;
      req: string;
      addQuestion: string;
      saved: string;
      saveChanges: string;
      createEventType: string;
      saving: string;
      /** Team scheduling section (team events only). */
      schedulingMethod: string;
      hostsTitle: string;
      priority: string;
      weight: string;
      fixedHost: string;
      fixedHostHint: string;
    };
    availability: {
      title: string;
      subtitle: string;
      emptyList: string;
      weeklyHours: string;
      dateOverrides: string;
      timezone: string;
      unavailable: string;
      addRange: string;
      addOverride: string;
      overrideNote: string;
      deleteSchedule: string;
      deletePrompt: string;
      yes: string;
      no: string;
      save: string;
      saving: string;
      scheduleNameLabel: string;
      removeRange: string;
      savedToast: string;
      deletedToast: string;
      saveError: string;
      deleteError: string;
      newSchedule: string;
      newSchedulePlaceholder: string;
      create: string;
      days: string[];
    };
    bookings: {
      title: string;
      newBooking: string;
      pendingConfirmation: string;
      upcoming: string;
      pastCancelled: string;
      nothingHere: string;
      confirm: string;
      decline: string;
      cancel: string;
      cancelPrompt: string;
      yes: string;
      no: string;
      confirmedToast: string;
      declinedToast: string;
      cancelledToast: string;
      cancelError: string;
      genericError: string;
      statusAccepted: string;
      statusPending: string;
      statusCancelled: string;
      statusRejected: string;
      newTitle: string;
      eventType: string;
      fromSlots: string;
      anyTime: string;
      noSlotsRange: string;
      dateTimeHost: string;
      attendeeName: string;
      attendeeEmail: string;
      attendeeTimezone: string;
      pickTime: string;
      creating: string;
      createBooking: string;
      createdTitle: string;
      createdNote: string;
      backToBookings: string;
      newSubtitle: string;
      createEventFirst: string;
      slotTaken: string;
      noHandleNotice: string;
      noHandleLink: string;
      /** Actionable config-error notices (admin-only detail; one link each). */
      scheduleMissingNotice: string;
      scheduleMissingLink: string;
      noHoursNotice: string;
      noScheduleNotice: string;
      availabilityLink: string;
      calendarUnavailableNotice: string;
      calendarUnavailableLink: string;
      calendarUnavailableBooking: string;
      slotsLoadError: string;
    };
    teams: {
      title: string;
      subtitle: string;
      emptyList: string;
      newTeam: string;
      name: string;
      slug: string;
      timezone: string;
      createTeam: string;
      manage: string;
      delete: string;
      cancel: string;
      deleteError: string;
      memberSingular: string;
      memberPlural: string;
      noMembers: string;
      addMember: string;
      chooseSomeone: string;
      role: string;
      roleOwner: string;
      roleMember: string;
      add: string;
      allOnTeam: string;
      remove: string;
      lastOwner: string;
      lastOwnerTitle: string;
      roleUpdated: string;
      memberRemoved: string;
      memberAdded: string;
      genericError: string;
      backToTeams: string;
      viewPublicTeam: string;
      roundRobin: string;
      members: string;
      teamEventTypes: string;
      noTeamEventTypes: string;
      inviteTitle: string;
      inviteLead: string;
      emailLabel: string;
      emailPlaceholder: string;
      emailInvalid: string;
      sendInvite: string;
      ownerLock: string;
      memberPending: string;
      noAccountMember: string;
      createTitle: string;
      createSubtitle: string;
      bioLabel: string;
      bioPlaceholder: string;
      logoLabel: string;
      uploadImage: string;
      orPasteUrl: string;
      clearImage: string;
      imageTooLarge: string;
      imageInvalidType: string;
      creating: string;
      backToTeamsList: string;
      imageReadError: string;
      nameHelp: string;
      slugHelp: string;
      bioHelp: string;
      logoHelp: string;
    };
    /** Members / Staff — the workspace roster (account roles owner/admin/member). */
    members: {
      title: string;
      subtitle: string;
      rosterLabel: string;
      invite: string;
      inviteTitle: string;
      inviteLead: string;
      emailLabel: string;
      emailPlaceholder: string;
      emailInvalid: string;
      emailTaken: string;
      roleLabel: string;
      roleOwner: string;
      roleAdmin: string;
      roleMember: string;
      sendInvite: string;
      cancel: string;
      you: string;
      noEmail: string;
      statusActive: string;
      statusInvited: string;
      statusDisabled: string;
      enable: string;
      disable: string;
      remove: string;
      ownerLock: string;
      lastOwnerTitle: string;
      roleUpdated: string;
      statusUpdated: string;
      memberInvited: string;
      memberRemoved: string;
      genericError: string;
      noAccessTitle: string;
      noAccessBody: string;
    };
    connections: {
      pageDesc: string;
      dialogTitle: string;
      dialogSubtitle: string;
      close: string;
      providerGoogle: string;
      providerOutlook: string;
      syncOnTitle: string;
      syncOnDesc: string;
      connectButton: string;
      syncOffTitle: string;
      syncOffDesc: string;
      syncOffSetPre: string;
      syncOffSetPost: string;
      connectWaiting: string;
      connectHint: string;
      connectDone: string;
      connectSuccess: string;
      connectCancelled: string;
      connectFailed: string;
      popupBlocked: string;
      destination: string;
      conflictCheck: string;
      disconnect: string;
      disconnectError: string;
      manualTitle: string;
      manualDesc: string;
      provider: string;
      calendarId: string;
      addConnection: string;
      healthSyncing: string;
      healthRecorded: string;
      yourCalendars: string;
      connectAnother: string;
      addEventsHere: string;
      addEventsHereHelp: string;
      checkForConflicts: string;
      checkForConflictsHelp: string;
      summaryDestination: string;
      summaryNoDestination: string;
      summaryConflictsNone: string;
      summaryConflictsOne: string;
      summaryConflictsMany: string;
      healthChecking: string;
      healthOk: string;
      healthError: string;
      recheck: string;
      /** Persisted-health caption: {time} interpolates the last probe time. */
      lastChecked: string;
      neverChecked: string;
      emptyTitle: string;
      emptyBody: string;
      emptyConflicts: string;
      emptyDestination: string;
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
    settingsGeneral: {
      displayName: string;
      publicHandle: string;
      timezone: string;
      saved: string;
      save: string;
      saving: string;
    };
    notifications: {
      title: string;
      subtitle: string;
      attendeeSection: string;
      attendeeSectionDesc: string;
      hostSection: string;
      hostSectionDesc: string;
      labels: Record<NotificationEmailKey, string>;
      descriptions: Record<NotificationEmailKey, string>;
      customizedBadge: string;
      editTemplate: string;
      updated: string;
      updateFailed: string;
      reminderLeads: string;
      reminderLeadsHint: string;
      reminderLeadsInvalid: string;
      followUpLead: string;
      followUpLeadHint: string;
      editorSubject: string;
      editorBody: string;
      variables: string;
      variablesHint: string;
      unknownTokensWarn: string;
      preview: string;
      usingDefault: string;
      usingCustom: string;
      reset: string;
      resetDone: string;
      save: string;
      saving: string;
      saved: string;
      saveFailed: string;
      back: string;
    };
    developer: {
      apiKeys: string;
      noKeys: string;
      revoke: string;
      revoked: string;
      copyOnce: string;
      name: string;
      scopes: string;
      createKey: string;
      webhooks: string;
      noWebhooks: string;
      subscriberUrl: string;
      events: string;
      addWebhook: string;
      ping: string;
      delete: string;
      active: string;
      cancel: string;
    };
    bookingPageHeader: {
      title: string;
      subtitle: string;
    };
    studio: {
      unsavedChanges: string;
      allChangesSaved: string;
      saved: string;
      reset: string;
      save: string;
      saving: string;
      saveFailed: string;
      profile: string;
      brand: string;
      appearance: string;
      meetings: string;
      displayName: string;
      publicHandle: string;
      /** The compact shareable-link unit + vanity slug claim (short-links §5). */
      yourLink: string;
      linkCopy: string;
      linkCopied: string;
      linkOpen: string;
      vanityLabel: string;
      vanityHint: string;
      vanityIncluded: string;
      vanityIncludedLink: string;
      bio: string;
      tryHandle: string;
      accent: string;
      contrast: string;
      adjustedNote: string;
      photoAvatar: string;
      coverImage: string;
      custom: string;
      customizeAppearance: string;
      axisTemplate: string;
      axisCardStyle: string;
      axisCorners: string;
      axisButtons: string;
      axisDensity: string;
      axisFont: string;
      axisSlotLayout: string;
      axisDayGroup: string;
      axisSlotSelect: string;
      show: string;
      hide: string;
      noEvents: string;
      orderVisibilityNote: string;
      configureEventTypes: string;
      showLandingPage: string;
      sendVisitorsTo: string;
      chooseEvent: string;
      pickDefaultEvent: string;
      eventHidden: string;
      eventShown: string;
      couldNotUpdateVisibility: string;
      moveUp: string;
      moveDown: string;
      previewProfile: string;
      bookingFlow: string;
      desktop: string;
      mobile: string;
      checking: string;
      available: string;
      taken: string;
      invalid: string;
      uploadImage: string;
      clear: string;
      orPasteUrl: string;
      imageInvalid: string;
      imageTooLarge: string;
      couldNotRead: string;
      introCall: string;
      minSuffix: string;
    };
  };
}

export const en: BookingMessages = {
  booking: {
    selectTime: 'Select a time',
    durationMinutes: '{minutes} min',
    timezoneLabel: 'Times shown in {timeZone}',
    timezone: 'Timezone',
    noSlots: 'No available times in this range.',
    noTimesNow: 'No times are available right now. Please check back soon.',
    timesUnavailable: 'Times are temporarily unavailable. Please try again in a few minutes.',
    calendarUnavailableTitle: 'This time could not be confirmed',
    calendarUnavailableBody:
      'We could not confirm this time right now. Please try again in a few minutes.',
    book: 'Book',
    confirm: 'Confirm booking',
    confirming: 'Confirming…',
    confirmed: 'Booking confirmed',
    requested: 'Booking requested',
    awaitingConfirmation: 'Awaiting the host’s confirmation. We’ll email {email} once it’s confirmed.',
    confirmationSentTo: 'A confirmation was sent to {email}.',
    yourName: 'Your name',
    yourEmail: 'Your email',
    notes: 'Notes (optional)',
    heldUntil: 'Held until {time}',
    slotTaken: 'That time was just taken.',
    holdExpired: 'Your hold expired',
    pickAnother: 'Pick another time',
    retry: 'Try again',
    poweredBy: 'Powered by Dapta Calendars',
    with: 'with',
    seatsLeft: '{n} left',
    full: 'Full',
  },
  scheduling: {
    round_robin: 'Round-robin',
    collective: 'Collective',
    fixed_round_robin: 'Fixed round-robin',
    round_robin_hint: 'Rotate bookings fairly across hosts — one host per booking.',
    collective_hint: 'Everyone attends — offer only times when all hosts are free.',
    fixed_round_robin_hint: 'A fixed host always attends, plus one rotating host.',
  },
  manage: {
    title: 'Manage your booking',
    reschedule: 'Reschedule',
    rescheduling: 'Rescheduling…',
    rescheduleTo: 'Reschedule to',
    cancel: 'Cancel booking',
    cancelling: 'Cancelling…',
    cancelReason: 'Reason (optional)',
    cancelled: 'Your booking has been cancelled.',
    rescheduled: 'Your booking has been rescheduled. Check your email for the updated invite.',
    cannotChange: 'This booking can no longer be changed.',
    withLabel: 'With',
    bookingIs: 'This booking is {status}.',
    alreadyTookPlace: 'This booking has already taken place.',
    statusPending: 'pending',
    statusCancelled: 'cancelled',
    statusRejected: 'rejected',
    cancelThis: 'Cancel this booking',
    noOpenTimes: 'No open times in the next 3 weeks.',
    whereLabel: 'Where',
    joinMeeting: 'Join the meeting',
  },
  growth: {
    madeWith: 'Made with Dapta Calendars',
    ctaQuestion: 'Want your own booking page?',
    ctaAction: 'Get Dapta Calendars — free',
    seoProfile: 'Book time with {name} online.',
    seoEvent: 'Book {event} with {name} — {minutes} min, online scheduling.',
  },
  admin: {
    nav: {
      home: 'Home',
      bookings: 'Bookings',
      availability: 'Availability',
      eventTypes: 'Events',
      teams: 'Teams',
      calendars: 'Calendars',
      settings: 'Settings',
      bookingPage: 'Booking page',
    },
    common: {
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      delete: 'Delete',
      deleting: 'Deleting…',
      edit: 'Edit',
      remove: 'Remove',
      add: 'Add',
      create: 'Create',
      creating: 'Creating…',
      confirm: 'Confirm',
      back: 'Back',
      retry: 'Try again',
      loading: 'Loading…',
      saved: 'All changes saved',
      search: 'Search',
      none: 'None',
      signOut: 'Sign out',
      viewPublic: 'View public page',
      language: 'Language',
      collapse: 'Collapse sidebar',
      expand: 'Expand sidebar',
      switcher: {
        trigger: 'Switch product',
        menuLabel: 'Dapta products',
        eyebrow: 'Dapta',
        comingSoon: 'Coming soon',
        opensNewTab: '(opens in a new tab)',
        forms: 'Forms',
      },
    },
    home: {
      welcome: 'Welcome',
      welcomeNamed: 'Welcome, {name}',
      subtitle: 'Your scheduling at a glance.',
      bookingLink: 'Your booking link',
      copy: 'Copy',
      copied: 'Copied ✓',
      open: 'Open',
      statEventTypes: 'Events',
      statUpcoming: 'Upcoming bookings',
      statTeams: 'Teams',
      createEvent: 'Create an event',
      createEventDesc: 'Define a bookable meeting.',
      setAvailability: 'Set your availability',
      setAvailabilityDesc: 'Weekly hours + date overrides.',
      stylePage: 'Style your booking page',
      stylePageDesc: 'Brand + 9-axis studio.',
      apiKeys: 'API keys & webhooks',
      apiKeysDesc: 'Integrate agents & automations.',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Manage your account and preferences.',
      general: 'General',
      bookingPage: 'Booking Page',
      members: 'Members',
      developer: 'Developer',
      notifications: 'Notifications',
    },
    eventTypes: {
      title: 'Events',
      newEventType: 'New event',
      emptyList: 'No events yet — create one below.',
      hidden: 'hidden',
      needsConfirmation: 'needs confirmation',
      minSuffix: 'min',
      fTitle: 'Title',
      fSlug: 'Slug',
      fDescription: 'Description',
      fLocation: 'Location',
      locationPlaceholder: 'e.g. Google Meet, Phone, or an address',
      fLength: 'Length (min)',
      fSlotInterval: 'Slot interval (min)',
      fMinNotice: 'Min. notice (min)',
      fBufferBefore: 'Buffer before (min)',
      fBufferAfter: 'Buffer after (min)',
      fSeats: 'Seats / slot (group)',
      fSchedule: 'Availability schedule',
      useDefaultSchedule: 'Use my default schedule',
      noSchedules: 'No schedules yet — create one in Availability',
      requiresConfirmation: 'Requires confirmation',
      hiddenLabel: 'Hidden',
      intakeQuestions: 'Intake questions',
      namePlaceholder: 'name',
      labelPlaceholder: 'Label',
      req: 'req',
      addQuestion: '+ Add question',
      saved: 'Saved.',
      saveChanges: 'Save changes',
      createEventType: 'Create event',
      saving: 'Saving…',
      schedulingMethod: 'Scheduling method',
      hostsTitle: 'Hosts',
      priority: 'Priority',
      weight: 'Weight',
      fixedHost: 'Fixed',
      fixedHostHint: 'Always on every booking',
    },
    availability: {
      title: 'Availability',
      subtitle: 'Weekly hours and date overrides. Add multiple ranges per day (e.g. 9–12 and 14–18).',
      emptyList: 'No schedules yet — create one to set your weekly hours.',
      weeklyHours: 'Weekly hours',
      dateOverrides: 'Date overrides',
      timezone: 'Timezone',
      unavailable: 'Unavailable',
      addRange: '+ Add a range',
      addOverride: '+ Add date override',
      overrideNote: 'An override replaces the weekly hours for that specific date.',
      deleteSchedule: 'Delete',
      deletePrompt: 'Delete?',
      yes: 'Yes',
      no: 'No',
      save: 'Save availability',
      saving: 'Saving…',
      scheduleNameLabel: 'Schedule name',
      removeRange: 'Remove range',
      savedToast: 'Availability saved.',
      deletedToast: 'Schedule deleted.',
      saveError: 'Could not save availability.',
      deleteError: 'Could not delete the schedule.',
      newSchedule: 'New schedule',
      newSchedulePlaceholder: 'Schedule name',
      create: 'Create schedule',
      days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    },
    bookings: {
      title: 'Bookings',
      newBooking: '+ New booking',
      pendingConfirmation: 'Pending confirmation',
      upcoming: 'Upcoming',
      pastCancelled: 'Past & cancelled',
      nothingHere: 'Nothing here.',
      confirm: 'Confirm',
      decline: 'Decline',
      cancel: 'Cancel',
      cancelPrompt: 'Cancel?',
      yes: 'Yes',
      no: 'No',
      confirmedToast: 'Booking confirmed.',
      declinedToast: 'Booking declined.',
      cancelledToast: 'Booking cancelled.',
      cancelError: 'Could not cancel the booking.',
      genericError: 'Something went wrong.',
      statusAccepted: 'accepted',
      statusPending: 'pending',
      statusCancelled: 'cancelled',
      statusRejected: 'rejected',
      newTitle: 'New booking',
      eventType: 'Event',
      fromSlots: 'From available slots',
      anyTime: 'Any time (outside availability)',
      noSlotsRange: 'No slots in range.',
      dateTimeHost: 'Date & time (host timezone)',
      attendeeName: 'Attendee name',
      attendeeEmail: 'Attendee email',
      attendeeTimezone: 'Attendee timezone',
      pickTime: 'Pick a time.',
      creating: 'Creating…',
      createBooking: 'Create booking',
      createdTitle: 'Booking created',
      createdNote: 'The attendee has been notified.',
      backToBookings: '← Back to bookings',
      newSubtitle: 'Book on behalf of an attendee — from an open slot or any time.',
      createEventFirst: 'Create an event first.',
      noHandleNotice: 'You haven’t set your public handle yet — your booking page isn’t published. Manual bookings below still work.',
      noHandleLink: 'Set your handle in Booking Page settings',
      slotTaken: 'That time was just taken — pick another slot.',
      scheduleMissingNotice: 'This event’s schedule is missing — pick a schedule in the event settings.',
      scheduleMissingLink: 'Open event settings',
      noHoursNotice: 'No working hours configured for this event’s schedule.',
      noScheduleNotice: 'You don’t have a schedule yet — create one with your working hours.',
      availabilityLink: 'Open Availability',
      calendarUnavailableNotice:
        'Couldn’t reach the connected calendar — times are hidden to prevent double-bookings.',
      calendarUnavailableLink: 'Check Calendars',
      calendarUnavailableBooking:
        'Couldn’t reach the connected calendar — the booking was blocked to prevent a double-booking. Check Calendars and retry.',
      slotsLoadError: 'Couldn’t load times. Try again in a moment.',
    },
    teams: {
      title: 'Teams',
      subtitle: 'Team scheduling across a group of hosts — round-robin, collective, or fixed round-robin.',
      emptyList: 'No teams yet — create one below to schedule bookings across hosts.',
      newTeam: 'New team',
      name: 'Name',
      slug: 'Slug',
      timezone: 'Timezone',
      createTeam: 'Create team',
      manage: 'Manage',
      delete: 'Delete',
      cancel: 'Cancel',
      deleteError: 'Could not delete.',
      memberSingular: 'member',
      memberPlural: 'members',
      noMembers: 'No members yet. Add someone from your account below.',
      addMember: 'Add member',
      chooseSomeone: 'Choose someone…',
      role: 'Role',
      roleOwner: 'Owner',
      roleMember: 'Member',
      add: 'Add',
      allOnTeam: 'All account members are on this team.',
      remove: 'Remove',
      lastOwner: 'Last owner',
      lastOwnerTitle: 'A team must keep at least one owner',
      roleUpdated: 'Role updated.',
      memberRemoved: 'Member removed.',
      memberAdded: 'Member added.',
      genericError: 'Something went wrong.',
      backToTeams: '← Teams',
      viewPublicTeam: 'View public team page →',
      roundRobin: 'round-robin scheduling',
      members: 'Members',
      teamEventTypes: 'Team events',
      noTeamEventTypes: 'No team events yet.',
      inviteTitle: 'Add a member',
      inviteLead: 'Invite someone from your account to this team by email.',
      emailLabel: 'Email',
      emailPlaceholder: 'name@company.com',
      emailInvalid: 'Enter a valid email address.',
      sendInvite: 'Add member',
      ownerLock: 'Owners can’t be removed — change their role first.',
      memberPending: 'Pending',
      noAccountMember: 'No account member with that email — they need to sign up first.',
      createTitle: 'New team',
      createSubtitle: 'Round-robin bookings across a group of hosts. You can add members after creating.',
      bioLabel: 'Bio',
      bioPlaceholder: 'A short description shown on the team’s public page.',
      logoLabel: 'Logo',
      uploadImage: 'Upload image',
      orPasteUrl: '…or paste an image URL',
      clearImage: 'Clear',
      imageTooLarge: 'Image must be 1MB or smaller.',
      imageInvalidType: 'Please choose an image file.',
      creating: 'Creating…',
      backToTeamsList: '← Teams',
      imageReadError: 'Could not read that file.',
      nameHelp: 'Shown at the top of the team’s public booking page.',
      slugHelp: 'Used in the public URL. Lowercase letters, numbers and dashes.',
      bioHelp: 'A short line under the team name on the public page.',
      logoHelp: 'Square image works best. Max 1MB.',
    },
    members: {
      title: 'Members',
      subtitle: 'Invite your team and control who can administer this workspace.',
      rosterLabel: 'Workspace members',
      invite: 'Invite member',
      inviteTitle: 'Invite a member',
      inviteLead: 'They’ll join your workspace with the role you choose.',
      emailLabel: 'Email',
      emailPlaceholder: 'name@company.com',
      emailInvalid: 'Enter a valid email address.',
      emailTaken: 'A member with that email already exists.',
      roleLabel: 'Role',
      roleOwner: 'Owner',
      roleAdmin: 'Admin',
      roleMember: 'Member',
      sendInvite: 'Send invite',
      cancel: 'Cancel',
      you: 'You',
      noEmail: 'No email',
      statusActive: 'Active',
      statusInvited: 'Invited',
      statusDisabled: 'Disabled',
      enable: 'Enable',
      disable: 'Disable',
      remove: 'Remove',
      ownerLock: 'Owners can’t be removed — change their role first.',
      lastOwnerTitle: 'A workspace must keep at least one owner',
      roleUpdated: 'Role updated.',
      statusUpdated: 'Member updated.',
      memberInvited: 'Invitation sent.',
      memberRemoved: 'Member removed.',
      genericError: 'Something went wrong.',
      noAccessTitle: 'You don’t have access',
      noAccessBody: 'This section is available to workspace admins and owners.',
    },
    connections: {
      pageDesc: 'Connect a calendar so {product} can check conflicts (busy times) and write your booked events to it.',
      dialogTitle: 'Connect a calendar',
      dialogSubtitle: 'Choose a provider to link.',
      close: 'Close',
      providerGoogle: 'Google Calendar',
      providerOutlook: 'Outlook / Microsoft 365',
      syncOnTitle: 'Calendar sync is on.',
      syncOnDesc: 'Connect Google or Outlook to check conflicts and write events.',
      connectButton: 'Connect a calendar',
      syncOffTitle: 'Calendar sync is off in this build',
      syncOffDesc: 'No external calendar provider is configured, so busy times aren’t being read and events aren’t being written yet. Connections you add below are recorded but not synced.',
      syncOffSetPre: 'To turn sync on, set',
      syncOffSetPost: 'and configure a provider adapter in your deployment.',
      connectWaiting: 'Waiting for you to finish connecting…',
      connectHint: 'Finish signing in and granting access in the popup window, then return here.',
      connectDone: 'I’ve finished connecting',
      connectSuccess: 'Calendar connected.',
      connectCancelled: 'Connect cancelled — no calendar was linked.',
      connectFailed: 'Could not start the connect flow. Please try again.',
      popupBlocked: 'Your browser blocked the popup. Allow popups for this site and try again.',
      destination: 'Destination',
      conflictCheck: 'Conflict check',
      disconnect: 'Disconnect',
      disconnectError: 'Could not disconnect.',
      manualTitle: 'Link a calendar manually',
      manualDesc: 'Advanced: record a calendar reference by id (used when a provider adapter is configured, or for testing).',
      provider: 'Provider',
      calendarId: 'Calendar id / email',
      addConnection: 'Add connection',
      healthSyncing: 'Syncing',
      healthRecorded: 'Recorded only',
      yourCalendars: 'Your calendars',
      connectAnother: 'Connect another',
      addEventsHere: 'Add new events here',
      addEventsHereHelp: 'Booked events are written to this calendar. Only one calendar can receive events.',
      checkForConflicts: 'Check for conflicts',
      checkForConflictsHelp: 'Busy times on this calendar block new bookings. You can check any number of calendars.',
      summaryDestination: 'New events are added to',
      summaryNoDestination: 'No calendar is set to receive new events yet.',
      summaryConflictsNone: 'No calendars checked for conflicts',
      summaryConflictsOne: '1 calendar checked for conflicts',
      summaryConflictsMany: '{n} calendars checked for conflicts',
      healthChecking: 'Checking…',
      healthOk: 'Connected',
      healthError: 'Needs attention',
      recheck: 'Re-check',
      lastChecked: 'Checked {time}',
      neverChecked: 'Not checked yet',
      emptyTitle: 'No calendars connected yet',
      emptyBody: 'Connect Google or Outlook so {product} can read your busy times and add booked events to your calendar. You can connect more than one account.',
      emptyConflicts: 'Check for conflicts so busy times block new bookings',
      emptyDestination: 'Pick one calendar to receive your booked events',
    },
    login: {
      title: 'Sign in',
      subtitle: 'Open-source scheduling. This build uses the local dev provider — enter your email to sign in as yourself.',
      continue: 'Continue',
      footnote: 'Local mode: any email signs you into its own workspace. Configure WorkOS in your deployment for real accounts.',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      emailInvalid: 'Enter a valid email address.',
      workosCta: 'Continue with Dapta',
      workosSubtitle: 'You’ll be redirected to sign in securely.',
      error: 'Something went wrong signing in. Please try again.',
      retry: 'Try again',
    },
    settingsGeneral: {
      displayName: 'Display name',
      publicHandle: 'Public handle',
      timezone: 'Timezone',
      saved: 'Saved.',
      save: 'Save',
      saving: 'Saving…',
    },
    notifications: {
      title: 'Notifications',
      subtitle: 'Choose which booking emails go out and edit their templates.',
      attendeeSection: 'Attendee emails',
      attendeeSectionDesc: 'Sent to the person who booked.',
      hostSection: 'Host emails',
      hostSectionDesc: 'Sent to you and any co-hosts.',
      labels: {
        attendee_confirmation: 'Booking confirmed',
        attendee_pending: 'Request received',
        attendee_declined: 'Request declined',
        attendee_reschedule: 'Booking rescheduled',
        attendee_cancellation: 'Booking cancelled',
        attendee_reminder: 'Reminders',
        host_booked: 'New booking',
        host_rescheduled: 'Booking rescheduled',
        host_cancelled: 'Booking cancelled',
        host_declined: 'Request declined',
        follow_up: 'Follow-up after the meeting',
        host_reminder: 'Reminders',
      },
      descriptions: {
        attendee_confirmation: 'Confirmation with calendar invite when a booking is accepted.',
        attendee_pending: 'Acknowledgement when a booking still needs your approval.',
        attendee_declined: 'Notice when you decline a pending request.',
        attendee_reschedule: 'Updated invite when the time changes.',
        attendee_cancellation: 'Cancellation notice with the calendar removal.',
        attendee_reminder: 'Nudges before the meeting starts.',
        host_booked: 'A new booking or booking request came in.',
        host_rescheduled: 'A booking of yours moved to a new time.',
        host_cancelled: 'A booking of yours was cancelled.',
        host_declined: 'Confirmation that a pending request was declined.',
        follow_up: 'Thank-you note with a book-again link, sent after the meeting ends. Off by default.',
        host_reminder: 'Your own nudge before the meeting starts.',
      },
      customizedBadge: 'Customized',
      editTemplate: 'Edit template',
      updated: 'Updated.',
      updateFailed: 'Could not update — try again.',
      reminderLeads: 'Send reminders before start',
      reminderLeadsHint: 'Minutes before start, comma-separated (e.g. 1440, 60). Up to 5.',
      reminderLeadsInvalid: 'Whole minutes between 5 and 40320, up to 5 values.',
      followUpLead: 'Send after the meeting ends',
      followUpLeadHint: 'Minutes after the end time, comma-separated (e.g. 60). Up to 5.',
      editorSubject: 'Subject',
      editorBody: 'Body',
      variables: 'Variables',
      variablesHint: 'Click to insert. Lines whose variables are all empty are left out of the email.',
      unknownTokensWarn: 'Unknown variables render empty:',
      preview: 'Preview',
      usingDefault: 'Using the default template',
      usingCustom: 'Using a custom template',
      reset: 'Reset to default',
      resetDone: 'Template reset to default.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      saveFailed: 'Save failed.',
      back: 'Back to notifications',
    },
    developer: {
      apiKeys: 'API keys',
      noKeys: 'No API keys.',
      revoke: 'Revoke',
      revoked: 'revoked',
      copyOnce: 'Copy this now — it won’t be shown again:',
      name: 'Name',
      scopes: 'Scopes',
      createKey: 'Create key',
      webhooks: 'Webhooks',
      noWebhooks: 'No webhooks.',
      subscriberUrl: 'Subscriber URL',
      events: 'Events',
      addWebhook: 'Add webhook',
      ping: 'Ping',
      delete: 'Delete',
      active: 'active',
      cancel: 'Cancel',
    },
    bookingPageHeader: {
      title: 'Booking Page',
      subtitle: 'Style your public page. Preview updates live — what you see is what visitors get.',
    },
    studio: {
      unsavedChanges: 'Unsaved changes',
      allChangesSaved: 'All changes saved',
      saved: 'Saved.',
      reset: 'Reset',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'Save failed.',
      profile: 'Profile',
      brand: 'Brand',
      appearance: 'Appearance',
      meetings: 'Meetings',
      displayName: 'Display name',
      publicHandle: 'Public handle',
      yourLink: 'Your booking link',
      linkCopy: 'Copy',
      linkCopied: 'Copied \u2713',
      linkOpen: 'Open',
      vanityLabel: 'Custom link (vanity)',
      vanityHint: 'Included with your Dapta AI subscription. 3\u201330 lowercase letters, numbers, or hyphens; your short code keeps working.',
      vanityIncluded: 'Custom links are included with your Dapta AI subscription.',
      vanityIncludedLink: 'Learn more',
      bio: 'Bio',
      tryHandle: 'Try {handle} →',
      accent: 'Accent',
      contrast: 'Contrast {ratio}:1',
      adjustedNote: ' · adjusted to {hex} for legibility (AA)',
      photoAvatar: 'Photo / avatar',
      coverImage: 'Cover image',
      custom: 'Custom',
      customizeAppearance: 'Customize appearance',
      axisTemplate: 'Template',
      axisCardStyle: 'Card style',
      axisCorners: 'Corners',
      axisButtons: 'Buttons',
      axisDensity: 'Density',
      axisFont: 'Font',
      axisSlotLayout: 'Slot layout',
      axisDayGroup: 'Day group',
      axisSlotSelect: 'Slot select',
      show: 'Show',
      hide: 'Hide',
      noEvents: 'No events yet.',
      orderVisibilityNote: 'Order + visibility apply to your public page.',
      configureEventTypes: 'Configure events →',
      showLandingPage: 'Show the landing page (list of events)',
      sendVisitorsTo: 'Send visitors directly to',
      chooseEvent: 'Choose an event…',
      pickDefaultEvent: 'Pick a default event, or keep the landing page on.',
      eventHidden: 'Event hidden.',
      eventShown: 'Event shown.',
      couldNotUpdateVisibility: 'Could not update visibility.',
      moveUp: 'Move up',
      moveDown: 'Move down',
      previewProfile: 'Profile',
      bookingFlow: 'Booking flow',
      desktop: 'desktop',
      mobile: 'mobile',
      checking: 'Checking…',
      available: '✓ Available',
      taken: '✗ Taken',
      invalid: 'Invalid (3–40 chars, a–z 0–9 -)',
      uploadImage: 'Upload image',
      clear: 'Clear',
      orPasteUrl: '…or paste an image URL',
      imageInvalid: 'Please choose an image file.',
      imageTooLarge: 'Image must be under 1 MB.',
      couldNotRead: 'Could not read that file.',
      introCall: 'Intro Call',
      minSuffix: 'min',
    },
  },
};

export const es: BookingMessages = {
  booking: {
    selectTime: 'Selecciona un horario',
    durationMinutes: '{minutes} min',
    timezoneLabel: 'Horarios en {timeZone}',
    timezone: 'Zona horaria',
    noSlots: 'No hay horarios disponibles en este rango.',
    noTimesNow: 'No hay horarios disponibles por el momento. Vuelve a intentarlo pronto.',
    timesUnavailable:
      'Los horarios no están disponibles temporalmente. Inténtalo de nuevo en unos minutos.',
    calendarUnavailableTitle: 'No se pudo confirmar este horario',
    calendarUnavailableBody:
      'No pudimos confirmar este horario en este momento. Inténtalo de nuevo en unos minutos.',
    book: 'Reservar',
    confirm: 'Confirmar reserva',
    confirming: 'Confirmando…',
    confirmed: 'Reserva confirmada',
    requested: 'Reserva solicitada',
    awaitingConfirmation: 'Esperando la confirmación del anfitrión. Te escribiremos a {email} cuando se confirme.',
    confirmationSentTo: 'Enviamos una confirmación a {email}.',
    yourName: 'Tu nombre',
    yourEmail: 'Tu correo',
    notes: 'Notas (opcional)',
    heldUntil: 'Reservado hasta las {time}',
    slotTaken: 'Ese horario acaba de ocuparse.',
    holdExpired: 'Tu reserva temporal expiró',
    pickAnother: 'Elige otro horario',
    retry: 'Reintentar',
    poweredBy: 'Con la tecnología de Dapta Calendars',
    with: 'con',
    seatsLeft: '{n} disponibles',
    full: 'Lleno',
  },
  scheduling: {
    round_robin: 'Por turnos',
    collective: 'Colectiva',
    fixed_round_robin: 'Turnos con anfitrión fijo',
    round_robin_hint: 'Reparte las reservas de forma equitativa entre anfitriones — uno por reserva.',
    collective_hint: 'Todos asisten — ofrece solo horarios en que todos los anfitriones están libres.',
    fixed_round_robin_hint: 'Un anfitrión fijo siempre asiste, más uno por turnos.',
  },
  manage: {
    title: 'Gestiona tu reserva',
    reschedule: 'Reprogramar',
    rescheduling: 'Reprogramando…',
    rescheduleTo: 'Reprogramar para',
    cancel: 'Cancelar reserva',
    cancelling: 'Cancelando…',
    cancelReason: 'Motivo (opcional)',
    cancelled: 'Tu reserva ha sido cancelada.',
    rescheduled: 'Tu reserva fue reprogramada. Revisa tu correo para la invitación actualizada.',
    cannotChange: 'Esta reserva ya no se puede cambiar.',
    withLabel: 'Con',
    bookingIs: 'Esta reserva está {status}.',
    alreadyTookPlace: 'Esta reserva ya se realizó.',
    statusPending: 'pendiente',
    statusCancelled: 'cancelada',
    statusRejected: 'rechazada',
    cancelThis: 'Cancelar esta reserva',
    noOpenTimes: 'No hay horarios disponibles en las próximas 3 semanas.',
    whereLabel: 'Dónde',
    joinMeeting: 'Unirse a la reunión',
  },
  growth: {
    madeWith: 'Hecho con Dapta Calendars',
    ctaQuestion: '¿Quieres tu propia página de reservas?',
    ctaAction: 'Consigue Dapta Calendars — gratis',
    seoProfile: 'Reserva un horario con {name} en línea.',
    seoEvent: 'Reserva {event} con {name} — {minutes} min, agenda en línea.',
  },
  admin: {
    nav: {
      home: 'Inicio',
      bookings: 'Reservas',
      availability: 'Disponibilidad',
      eventTypes: 'Eventos',
      teams: 'Equipos',
      calendars: 'Calendarios',
      settings: 'Ajustes',
      bookingPage: 'Página de reservas',
    },
    common: {
      save: 'Guardar',
      saving: 'Guardando…',
      cancel: 'Cancelar',
      delete: 'Eliminar',
      deleting: 'Eliminando…',
      edit: 'Editar',
      remove: 'Quitar',
      add: 'Añadir',
      create: 'Crear',
      creating: 'Creando…',
      confirm: 'Confirmar',
      back: 'Volver',
      retry: 'Reintentar',
      loading: 'Cargando…',
      saved: 'Todos los cambios guardados',
      search: 'Buscar',
      none: 'Ninguno',
      signOut: 'Cerrar sesión',
      viewPublic: 'Ver página pública',
      language: 'Idioma',
      collapse: 'Contraer barra lateral',
      expand: 'Expandir barra lateral',
      switcher: {
        trigger: 'Cambiar producto',
        menuLabel: 'Productos Dapta',
        eyebrow: 'Dapta',
        comingSoon: 'Próximamente',
        opensNewTab: '(se abre en una pestaña nueva)',
        forms: 'Forms',
      },
    },
    home: {
      welcome: 'Bienvenido',
      welcomeNamed: 'Bienvenido, {name}',
      subtitle: 'Tu agenda de un vistazo.',
      bookingLink: 'Tu enlace de reservas',
      copy: 'Copiar',
      copied: 'Copiado ✓',
      open: 'Abrir',
      statEventTypes: 'Eventos',
      statUpcoming: 'Próximas reservas',
      statTeams: 'Equipos',
      createEvent: 'Crear un evento',
      createEventDesc: 'Define una reunión reservable.',
      setAvailability: 'Configura tu disponibilidad',
      setAvailabilityDesc: 'Horas semanales + excepciones por fecha.',
      stylePage: 'Personaliza tu página de reservas',
      stylePageDesc: 'Marca + estudio de 9 ejes.',
      apiKeys: 'Claves API y webhooks',
      apiKeysDesc: 'Integra agentes y automatizaciones.',
    },
    settings: {
      title: 'Ajustes',
      subtitle: 'Gestiona tu cuenta y preferencias.',
      general: 'General',
      bookingPage: 'Página de reservas',
      members: 'Miembros',
      developer: 'Desarrollador',
      notifications: 'Notificaciones',
    },
    eventTypes: {
      title: 'Eventos',
      newEventType: 'Nuevo evento',
      emptyList: 'Aún no hay eventos — crea uno abajo.',
      hidden: 'oculto',
      needsConfirmation: 'requiere confirmación',
      minSuffix: 'min',
      fTitle: 'Título',
      fSlug: 'Identificador',
      fDescription: 'Descripción',
      fLocation: 'Ubicación',
      locationPlaceholder: 'p. ej. Google Meet, Teléfono o una dirección',
      fLength: 'Duración (min)',
      fSlotInterval: 'Intervalo entre horarios (min)',
      fMinNotice: 'Antelación mínima (min)',
      fBufferBefore: 'Margen antes (min)',
      fBufferAfter: 'Margen después (min)',
      fSeats: 'Cupos / horario (grupo)',
      fSchedule: 'Horario de disponibilidad',
      useDefaultSchedule: 'Usar mi horario predeterminado',
      noSchedules: 'Aún no hay horarios — crea uno en Disponibilidad',
      requiresConfirmation: 'Requiere confirmación',
      hiddenLabel: 'Oculto',
      intakeQuestions: 'Preguntas del formulario',
      namePlaceholder: 'nombre',
      labelPlaceholder: 'Etiqueta',
      req: 'obl.',
      addQuestion: '+ Añadir pregunta',
      saved: 'Guardado.',
      saveChanges: 'Guardar cambios',
      createEventType: 'Crear evento',
      saving: 'Guardando…',
      schedulingMethod: 'Método de programación',
      hostsTitle: 'Anfitriones',
      priority: 'Prioridad',
      weight: 'Peso',
      fixedHost: 'Fijo',
      fixedHostHint: 'Siempre en cada reserva',
    },
    availability: {
      title: 'Disponibilidad',
      subtitle: 'Horas semanales y excepciones por fecha. Añade varios rangos por día (p. ej. 9–12 y 14–18).',
      emptyList: 'Aún no hay horarios — crea uno para definir tus horas semanales.',
      weeklyHours: 'Horas semanales',
      dateOverrides: 'Excepciones por fecha',
      timezone: 'Zona horaria',
      unavailable: 'No disponible',
      addRange: '+ Añadir un rango',
      addOverride: '+ Añadir excepción por fecha',
      overrideNote: 'Una excepción reemplaza las horas semanales para esa fecha específica.',
      deleteSchedule: 'Eliminar',
      deletePrompt: '¿Eliminar?',
      yes: 'Sí',
      no: 'No',
      save: 'Guardar disponibilidad',
      saving: 'Guardando…',
      scheduleNameLabel: 'Nombre del horario',
      removeRange: 'Quitar rango',
      savedToast: 'Disponibilidad guardada.',
      deletedToast: 'Horario eliminado.',
      saveError: 'No se pudo guardar la disponibilidad.',
      deleteError: 'No se pudo eliminar el horario.',
      newSchedule: 'Nuevo horario',
      newSchedulePlaceholder: 'Nombre del horario',
      create: 'Crear horario',
      days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
    },
    bookings: {
      title: 'Reservas',
      newBooking: '+ Nueva reserva',
      pendingConfirmation: 'Pendientes de confirmación',
      upcoming: 'Próximas',
      pastCancelled: 'Pasadas y canceladas',
      nothingHere: 'Nada por aquí.',
      confirm: 'Confirmar',
      decline: 'Rechazar',
      cancel: 'Cancelar',
      cancelPrompt: '¿Cancelar?',
      yes: 'Sí',
      no: 'No',
      confirmedToast: 'Reserva confirmada.',
      declinedToast: 'Reserva rechazada.',
      cancelledToast: 'Reserva cancelada.',
      cancelError: 'No se pudo cancelar la reserva.',
      genericError: 'Algo salió mal.',
      statusAccepted: 'aceptada',
      statusPending: 'pendiente',
      statusCancelled: 'cancelada',
      statusRejected: 'rechazada',
      newTitle: 'Nueva reserva',
      eventType: 'Evento',
      fromSlots: 'Desde horarios disponibles',
      anyTime: 'Cualquier hora (fuera de disponibilidad)',
      noSlotsRange: 'No hay horarios en el rango.',
      dateTimeHost: 'Fecha y hora (zona del anfitrión)',
      attendeeName: 'Nombre del invitado',
      attendeeEmail: 'Correo del invitado',
      attendeeTimezone: 'Zona horaria del invitado',
      pickTime: 'Elige una hora.',
      creating: 'Creando…',
      createBooking: 'Crear reserva',
      createdTitle: 'Reserva creada',
      createdNote: 'Se ha notificado al invitado.',
      backToBookings: '← Volver a reservas',
      newSubtitle: 'Reserva en nombre de un invitado — desde un horario libre o cualquier hora.',
      createEventFirst: 'Primero crea un evento.',
      noHandleNotice: 'Aún no has definido tu identificador público — tu página de reservas no está publicada. Las reservas manuales de abajo sí funcionan.',
      noHandleLink: 'Define tu identificador en Ajustes de Página de reservas',
      slotTaken: 'Ese horario acaba de ocuparse — elige otro.',
      scheduleMissingNotice:
        'Falta el horario de este evento — elige un horario en la configuración del evento.',
      scheduleMissingLink: 'Abrir configuración del evento',
      noHoursNotice: 'No hay horas de trabajo configuradas para el horario de este evento.',
      noScheduleNotice: 'Aún no tienes un horario — crea uno con tus horas de trabajo.',
      availabilityLink: 'Abrir Disponibilidad',
      calendarUnavailableNotice:
        'No se pudo acceder al calendario conectado — los horarios se ocultan para evitar dobles reservas.',
      calendarUnavailableLink: 'Revisar Calendarios',
      calendarUnavailableBooking:
        'No se pudo acceder al calendario conectado — la reserva se bloqueó para evitar una doble reserva. Revisa Calendarios y reintenta.',
      slotsLoadError: 'No se pudieron cargar los horarios. Inténtalo de nuevo en un momento.',
    },
    teams: {
      title: 'Equipos',
      subtitle: 'Programación de equipo entre un grupo de anfitriones — por turnos, colectiva o con anfitrión fijo.',
      emptyList: 'Aún no hay equipos — crea uno abajo para programar reservas entre anfitriones.',
      newTeam: 'Nuevo equipo',
      name: 'Nombre',
      slug: 'Identificador',
      timezone: 'Zona horaria',
      createTeam: 'Crear equipo',
      manage: 'Gestionar',
      delete: 'Eliminar',
      cancel: 'Cancelar',
      deleteError: 'No se pudo eliminar.',
      memberSingular: 'miembro',
      memberPlural: 'miembros',
      noMembers: 'Aún no hay miembros. Añade a alguien de tu cuenta abajo.',
      addMember: 'Añadir miembro',
      chooseSomeone: 'Elige a alguien…',
      role: 'Rol',
      roleOwner: 'Propietario',
      roleMember: 'Miembro',
      add: 'Añadir',
      allOnTeam: 'Todos los miembros de la cuenta están en este equipo.',
      remove: 'Quitar',
      lastOwner: 'Último propietario',
      lastOwnerTitle: 'Un equipo debe conservar al menos un propietario',
      roleUpdated: 'Rol actualizado.',
      memberRemoved: 'Miembro eliminado.',
      memberAdded: 'Miembro añadido.',
      genericError: 'Algo salió mal.',
      backToTeams: '← Equipos',
      viewPublicTeam: 'Ver página pública del equipo →',
      roundRobin: 'programación por turnos',
      members: 'Miembros',
      teamEventTypes: 'Eventos del equipo',
      noTeamEventTypes: 'Aún no hay eventos del equipo.',
      inviteTitle: 'Añadir un miembro',
      inviteLead: 'Invita por correo a alguien de tu cuenta a este equipo.',
      emailLabel: 'Correo',
      emailPlaceholder: 'nombre@empresa.com',
      emailInvalid: 'Introduce un correo válido.',
      sendInvite: 'Añadir miembro',
      ownerLock: 'Los propietarios no se pueden quitar — cambia su rol primero.',
      memberPending: 'Pendiente',
      noAccountMember: 'No hay ningún miembro de la cuenta con ese correo — primero debe registrarse.',
      createTitle: 'Nuevo equipo',
      createSubtitle: 'Reparte reservas por turnos entre un grupo de anfitriones. Puedes añadir miembros después de crearlo.',
      bioLabel: 'Biografía',
      bioPlaceholder: 'Una breve descripción que se muestra en la página pública del equipo.',
      logoLabel: 'Logo',
      uploadImage: 'Subir imagen',
      orPasteUrl: '…o pega una URL de imagen',
      clearImage: 'Quitar',
      imageTooLarge: 'La imagen debe pesar 1MB o menos.',
      imageInvalidType: 'Elige un archivo de imagen.',
      creating: 'Creando…',
      backToTeamsList: '← Equipos',
      imageReadError: 'No se pudo leer el archivo.',
      nameHelp: 'Se muestra en la parte superior de la página pública del equipo.',
      slugHelp: 'Se usa en la URL pública. Minúsculas, números y guiones.',
      bioHelp: 'Una línea breve bajo el nombre del equipo en la página pública.',
      logoHelp: 'Una imagen cuadrada funciona mejor. Máx. 1MB.',
    },
    members: {
      title: 'Miembros',
      subtitle: 'Invita a tu equipo y controla quién puede administrar este espacio.',
      rosterLabel: 'Miembros del espacio',
      invite: 'Invitar miembro',
      inviteTitle: 'Invitar a un miembro',
      inviteLead: 'Se unirá a tu espacio con el rol que elijas.',
      emailLabel: 'Correo',
      emailPlaceholder: 'nombre@empresa.com',
      emailInvalid: 'Introduce un correo válido.',
      emailTaken: 'Ya existe un miembro con ese correo.',
      roleLabel: 'Rol',
      roleOwner: 'Propietario',
      roleAdmin: 'Administrador',
      roleMember: 'Miembro',
      sendInvite: 'Enviar invitación',
      cancel: 'Cancelar',
      you: 'Tú',
      noEmail: 'Sin correo',
      statusActive: 'Activo',
      statusInvited: 'Invitado',
      statusDisabled: 'Desactivado',
      enable: 'Activar',
      disable: 'Desactivar',
      remove: 'Quitar',
      ownerLock: 'Los propietarios no se pueden quitar — cambia su rol primero.',
      lastOwnerTitle: 'Un espacio debe conservar al menos un propietario',
      roleUpdated: 'Rol actualizado.',
      statusUpdated: 'Miembro actualizado.',
      memberInvited: 'Invitación enviada.',
      memberRemoved: 'Miembro eliminado.',
      genericError: 'Algo salió mal.',
      noAccessTitle: 'No tienes acceso',
      noAccessBody: 'Esta sección está disponible para administradores y propietarios del espacio.',
    },
    connections: {
      pageDesc: 'Conecta un calendario para que {product} pueda verificar conflictos (horas ocupadas) y escribir en él tus reservas.',
      dialogTitle: 'Conectar un calendario',
      dialogSubtitle: 'Elige un proveedor para vincular.',
      close: 'Cerrar',
      providerGoogle: 'Google Calendar',
      providerOutlook: 'Outlook / Microsoft 365',
      syncOnTitle: 'La sincronización de calendario está activa.',
      syncOnDesc: 'Conecta Google u Outlook para verificar conflictos y escribir eventos.',
      connectButton: 'Conectar un calendario',
      syncOffTitle: 'La sincronización de calendario está desactivada en esta versión',
      syncOffDesc: 'No hay ningún proveedor de calendario externo configurado, así que aún no se leen horas ocupadas ni se escriben eventos. Las conexiones que añadas abajo se registran pero no se sincronizan.',
      syncOffSetPre: 'Para activar la sincronización, define',
      syncOffSetPost: 'y configura un adaptador de proveedor en tu despliegue.',
      connectWaiting: 'Esperando a que termines de conectar…',
      connectHint: 'Termina de iniciar sesión y de dar acceso en la ventana emergente y luego vuelve aquí.',
      connectDone: 'Ya terminé de conectar',
      connectSuccess: 'Calendario conectado.',
      connectCancelled: 'Conexión cancelada: no se vinculó ningún calendario.',
      connectFailed: 'No se pudo iniciar la conexión. Inténtalo de nuevo.',
      popupBlocked: 'Tu navegador bloqueó la ventana emergente. Permite ventanas emergentes e inténtalo de nuevo.',
      destination: 'Destino',
      conflictCheck: 'Verificar conflictos',
      disconnect: 'Desconectar',
      disconnectError: 'No se pudo desconectar.',
      manualTitle: 'Vincular un calendario manualmente',
      manualDesc: 'Avanzado: registra una referencia de calendario por id (se usa cuando hay un adaptador de proveedor configurado, o para pruebas).',
      provider: 'Proveedor',
      calendarId: 'Id de calendario / correo',
      addConnection: 'Añadir conexión',
      healthSyncing: 'Sincronizando',
      healthRecorded: 'Solo registrado',
      yourCalendars: 'Tus calendarios',
      connectAnother: 'Conectar otro',
      addEventsHere: 'Añadir eventos nuevos aquí',
      addEventsHereHelp: 'Las reservas se escriben en este calendario. Solo un calendario puede recibir eventos.',
      checkForConflicts: 'Verificar conflictos',
      checkForConflictsHelp: 'Las horas ocupadas en este calendario bloquean nuevas reservas. Puedes verificar cualquier número de calendarios.',
      summaryDestination: 'Los eventos nuevos se añaden a',
      summaryNoDestination: 'Aún no hay un calendario configurado para recibir eventos nuevos.',
      summaryConflictsNone: 'Ningún calendario verificado por conflictos',
      summaryConflictsOne: '1 calendario verificado por conflictos',
      summaryConflictsMany: '{n} calendarios verificados por conflictos',
      healthChecking: 'Comprobando…',
      healthOk: 'Conectado',
      healthError: 'Requiere atención',
      recheck: 'Volver a comprobar',
      lastChecked: 'Comprobado {time}',
      neverChecked: 'Sin comprobar todavía',
      emptyTitle: 'Aún no hay calendarios conectados',
      emptyBody: 'Conecta Google u Outlook para que {product} pueda leer tus horas ocupadas y añadir las reservas a tu calendario. Puedes conectar más de una cuenta.',
      emptyConflicts: 'Verifica conflictos para que las horas ocupadas bloqueen nuevas reservas',
      emptyDestination: 'Elige un calendario para recibir tus reservas',
    },
    login: {
      title: 'Iniciar sesión',
      subtitle: 'Programación de código abierto. Esta versión usa el proveedor de desarrollo local — introduce tu correo para entrar como tú mismo.',
      continue: 'Continuar',
      footnote: 'Modo local: cualquier correo entra a su propio espacio. Configura WorkOS en tu despliegue para cuentas reales.',
      emailLabel: 'Correo',
      emailPlaceholder: 'tu@ejemplo.com',
      emailInvalid: 'Introduce un correo válido.',
      workosCta: 'Continuar con Dapta',
      workosSubtitle: 'Te redirigiremos para iniciar sesión de forma segura.',
      error: 'Algo salió mal al iniciar sesión. Inténtalo de nuevo.',
      retry: 'Reintentar',
    },
    settingsGeneral: {
      displayName: 'Nombre visible',
      publicHandle: 'Identificador público',
      timezone: 'Zona horaria',
      saved: 'Guardado.',
      save: 'Guardar',
      saving: 'Guardando…',
    },
    notifications: {
      title: 'Notificaciones',
      subtitle: 'Elige qué correos de reservas se envían y edita sus plantillas.',
      attendeeSection: 'Correos al asistente',
      attendeeSectionDesc: 'Enviados a la persona que reservó.',
      hostSection: 'Correos al anfitrión',
      hostSectionDesc: 'Enviados a ti y a los co-anfitriones.',
      labels: {
        attendee_confirmation: 'Reserva confirmada',
        attendee_pending: 'Solicitud recibida',
        attendee_declined: 'Solicitud rechazada',
        attendee_reschedule: 'Reserva reprogramada',
        attendee_cancellation: 'Reserva cancelada',
        attendee_reminder: 'Recordatorios',
        host_booked: 'Nueva reserva',
        host_rescheduled: 'Reserva reprogramada',
        host_cancelled: 'Reserva cancelada',
        host_declined: 'Solicitud rechazada',
        follow_up: 'Seguimiento tras la reunión',
        host_reminder: 'Recordatorios',
      },
      descriptions: {
        attendee_confirmation: 'Confirmación con invitación de calendario al aceptar la reserva.',
        attendee_pending: 'Acuse de recibo cuando la reserva requiere tu aprobación.',
        attendee_declined: 'Aviso cuando rechazas una solicitud pendiente.',
        attendee_reschedule: 'Invitación actualizada cuando cambia la hora.',
        attendee_cancellation: 'Aviso de cancelación con la eliminación del calendario.',
        attendee_reminder: 'Avisos antes de que empiece la reunión.',
        host_booked: 'Entró una nueva reserva o solicitud de reserva.',
        host_rescheduled: 'Una de tus reservas cambió de hora.',
        host_cancelled: 'Una de tus reservas fue cancelada.',
        host_declined: 'Confirmación de que una solicitud pendiente fue rechazada.',
        follow_up: 'Nota de agradecimiento con enlace para reservar de nuevo, enviada al terminar la reunión. Desactivada por defecto.',
        host_reminder: 'Tu propio aviso antes de que empiece la reunión.',
      },
      customizedBadge: 'Personalizada',
      editTemplate: 'Editar plantilla',
      updated: 'Actualizado.',
      updateFailed: 'No se pudo actualizar — inténtalo de nuevo.',
      reminderLeads: 'Enviar recordatorios antes del inicio',
      reminderLeadsHint: 'Minutos antes del inicio, separados por comas (p. ej. 1440, 60). Hasta 5.',
      reminderLeadsInvalid: 'Minutos enteros entre 5 y 40320, hasta 5 valores.',
      followUpLead: 'Enviar después de que termine la reunión',
      followUpLeadHint: 'Minutos después de la hora de fin, separados por comas (p. ej. 60). Hasta 5.',
      editorSubject: 'Asunto',
      editorBody: 'Cuerpo',
      variables: 'Variables',
      variablesHint: 'Haz clic para insertar. Las líneas cuyas variables queden vacías se omiten del correo.',
      unknownTokensWarn: 'Variables desconocidas se muestran vacías:',
      preview: 'Vista previa',
      usingDefault: 'Usando la plantilla predeterminada',
      usingCustom: 'Usando una plantilla personalizada',
      reset: 'Restablecer predeterminada',
      resetDone: 'Plantilla restablecida.',
      save: 'Guardar',
      saving: 'Guardando…',
      saved: 'Guardado.',
      saveFailed: 'Error al guardar.',
      back: 'Volver a notificaciones',
    },
    developer: {
      apiKeys: 'Claves API',
      noKeys: 'No hay claves API.',
      revoke: 'Revocar',
      revoked: 'revocada',
      copyOnce: 'Cópiala ahora — no se volverá a mostrar:',
      name: 'Nombre',
      scopes: 'Permisos',
      createKey: 'Crear clave',
      webhooks: 'Webhooks',
      noWebhooks: 'No hay webhooks.',
      subscriberUrl: 'URL del suscriptor',
      events: 'Eventos',
      addWebhook: 'Añadir webhook',
      ping: 'Probar',
      delete: 'Eliminar',
      active: 'activo',
      cancel: 'Cancelar',
    },
    bookingPageHeader: {
      title: 'Página de reservas',
      subtitle: 'Personaliza tu página pública. La vista previa se actualiza en vivo — lo que ves es lo que reciben los visitantes.',
    },
    studio: {
      unsavedChanges: 'Cambios sin guardar',
      allChangesSaved: 'Todos los cambios guardados',
      saved: 'Guardado.',
      reset: 'Restablecer',
      save: 'Guardar',
      saving: 'Guardando…',
      saveFailed: 'Error al guardar.',
      profile: 'Perfil',
      brand: 'Marca',
      appearance: 'Apariencia',
      meetings: 'Reuniones',
      displayName: 'Nombre visible',
      publicHandle: 'Identificador público',
      yourLink: 'Tu enlace de reservas',
      linkCopy: 'Copiar',
      linkCopied: 'Copiado \u2713',
      linkOpen: 'Abrir',
      vanityLabel: 'Enlace personalizado (vanity)',
      vanityHint: 'Incluido con tu suscripción de Dapta AI. De 3 a 30 letras minúsculas, números o guiones; tu código corto sigue funcionando.',
      vanityIncluded: 'Los enlaces personalizados están incluidos con tu suscripción de Dapta AI.',
      vanityIncludedLink: 'Saber más',
      bio: 'Biografía',
      tryHandle: 'Prueba {handle} →',
      accent: 'Color de acento',
      contrast: 'Contraste {ratio}:1',
      adjustedNote: ' · ajustado a {hex} para mejor legibilidad (AA)',
      photoAvatar: 'Foto / avatar',
      coverImage: 'Imagen de portada',
      custom: 'Personalizado',
      customizeAppearance: 'Personalizar apariencia',
      axisTemplate: 'Plantilla',
      axisCardStyle: 'Estilo de tarjeta',
      axisCorners: 'Esquinas',
      axisButtons: 'Botones',
      axisDensity: 'Densidad',
      axisFont: 'Fuente',
      axisSlotLayout: 'Disposición de horarios',
      axisDayGroup: 'Agrupación por día',
      axisSlotSelect: 'Selección de horario',
      show: 'Mostrar',
      hide: 'Ocultar',
      noEvents: 'Aún no hay eventos.',
      orderVisibilityNote: 'El orden y la visibilidad se aplican a tu página pública.',
      configureEventTypes: 'Configurar eventos →',
      showLandingPage: 'Mostrar la página de inicio (lista de eventos)',
      sendVisitorsTo: 'Enviar a los visitantes directamente a',
      chooseEvent: 'Elige un evento…',
      pickDefaultEvent: 'Elige un evento predeterminado o deja activa la página de inicio.',
      eventHidden: 'Evento oculto.',
      eventShown: 'Evento visible.',
      couldNotUpdateVisibility: 'No se pudo actualizar la visibilidad.',
      moveUp: 'Subir',
      moveDown: 'Bajar',
      previewProfile: 'Perfil',
      bookingFlow: 'Flujo de reserva',
      desktop: 'escritorio',
      mobile: 'móvil',
      checking: 'Comprobando…',
      available: '✓ Disponible',
      taken: '✗ Ocupado',
      invalid: 'No válido (3–40 caracteres, a–z 0–9 -)',
      uploadImage: 'Subir imagen',
      clear: 'Quitar',
      orPasteUrl: '…o pega una URL de imagen',
      imageInvalid: 'Elige un archivo de imagen.',
      imageTooLarge: 'La imagen debe pesar menos de 1 MB.',
      couldNotRead: 'No se pudo leer el archivo.',
      introCall: 'Llamada de introducción',
      minSuffix: 'min',
    },
  },
};

export const messages = { en, es } as const;

/** Pick messages for a locale, defaulting to English. */
export function getMessages(locale: string): BookingMessages {
  return locale.startsWith('es') ? es : en;
}

/** Interpolate `{name}` placeholders in a message string. */
export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Localized display name for an event type's scheduling_type. Null/personal
 * events (no team method) fall back to `personal`; unknown values echo through.
 */
export function schedulingMethodLabel(
  m: BookingMessages,
  type: string | null | undefined,
  personal = 'Personal',
): string {
  if (!type) return personal;
  if (type === 'round_robin' || type === 'collective' || type === 'fixed_round_robin') {
    return m.scheduling[type];
  }
  return type;
}
