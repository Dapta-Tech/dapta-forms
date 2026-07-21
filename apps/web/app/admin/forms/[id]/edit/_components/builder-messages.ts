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
    tabResults: string;
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
    copied: string;
    openForm: string;
  };
  badges: {
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
    /** Popover: privacy nudge about collecting unfinished answers. */
    tipNotify: string;
    /** Popover: where partials appear in the admin. */
    tipWhere: string;
    /** Popover extra line when the marker sits after the LAST question. */
    tipAfterLast: string;
    /** One-line pointer left in the Design tab (the select moved to the spine). */
    designNote: string;
  };
  /** The reveal-screen marker in the question spine (V4-04 — mirrors `partial`). */
  revealPoint: {
    /** Marker-row label ("Reveal screen"). */
    label: string;
    /** aria-label of the marker's remove (×) button. */
    remove: string;
    /** aria-label of the marker's drag grip. */
    move: string;
    /** aria-label of the info toggle on the marker row. */
    info: string;
    /** Popover: what the reveal marker does. */
    tipPlays: string;
    /** Popover line when the marker sits after the LAST question. */
    tipEnd: string;
    /** Popover line when the marker sits mid-form. */
    tipMid: string;
    /** Popover: where the reveal copy/duration is edited. */
    tipEdit: string;
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
    /** Name-step preview defaults — MUST mirror the shared catalog's
     *  `renderer.name.*` so the canvas shows exactly what publishes. */
    nameFirstPlaceholder: string;
    nameLastPlaceholder: string;
  };
  settings: {
    title: string;
    questionType: string;
    required: string;
    options: string;
    addOption: string;
    logic: string;
    addRule: string;
    noRules: string;
    scoring: string;
    scoringHint: string;
    /** Shown near the toggle when scoring is on but no points are assigned yet. */
    scoringZeroHint: string;
    contactHint: string;
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
    /** Small kicker above a scored outcome node. */
    outcomeKicker: string;
  };
  results: {
    pointsTitle: string;
    /** "Each answer adds to a score. Highest possible: {n}." */
    pointsHint: string;
    endTitle: string;
    endHint: string;
    addRange: string;
    rangeLabel: string;
    rangeLabelPlaceholder: string;
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
  | 'message';

export type TemplateId = 'lead' | 'contact' | 'feedback' | 'rsvp';

const en: BuilderMessages = {
  shell: {
    back: 'Forms',
    formNamePlaceholder: 'Untitled form',
    tabBuild: 'Build',
    tabLogic: 'Logic',
    tabResults: 'Results',
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
    copied: 'Copied',
    openForm: 'Open form',
  },
  badges: {
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
    tipNotify: 'Consider letting respondents know their answers may be collected before they submit.',
    tipWhere: 'View them in Submissions with the “Partial” filter.',
    tipAfterLast: 'After the last question it never fires — the final submit already captures everything.',
    designNote: 'Configured in the question list on the Build tab — look for the “Partial submit point” card.',
  },
  revealPoint: {
    label: 'Reveal screen',
    remove: 'Remove reveal screen',
    move: 'Move reveal screen',
    info: 'About the reveal screen',
    tipPlays: 'Plays a short processing screen for respondents at this point in the form.',
    tipEnd: 'At the end it plays right before the result — never mid-form.',
    tipMid: 'Here it plays after this question, then the form continues.',
    tipEdit: 'Edit its headline, subtitle and duration in Design.',
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
    nameFirstPlaceholder: 'First name',
    nameLastPlaceholder: 'Last name',
  },
  settings: {
    title: 'Question settings',
    questionType: 'Question type',
    required: 'Required',
    options: 'Options',
    addOption: 'Add option',
    logic: 'Logic',
    addRule: 'Add rule',
    noRules: 'No rules — everyone sees this question.',
    scoring: 'Scoring',
    scoringHint:
      'Scoring applies to the whole form, not just this question. Points from the selected option add to the total; set ranges in Results.',
    scoringZeroHint: 'Assign points to your answers to enable ranges.',
    contactHint: 'Contact field — doesn’t affect the score.',
    delete: 'Delete question',
    deleteConfirm: 'Delete this question?',
    empty: 'Select a question to edit it.',
  },
  tokens: {
    hint: 'Type @ to insert a previous answer',
    pickerLabel: 'Insert a previous answer',
    pickerEmpty: 'No earlier answers yet — this is the first question.',
    pickerNoMatch: 'No matching fields.',
    warnLater: '“{token}” is asked after this step — it will be empty here.',
    warnUnknown: '“{token}” doesn’t exist in this form.',
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
    outcomeKicker: 'Ending',
  },
  results: {
    pointsTitle: 'Points',
    pointsHint: 'Each answer adds to a score. Highest possible: {n}.',
    endTitle: 'What happens at the end',
    endHint: 'Map score ranges to an outcome. The first matching range wins.',
    addRange: 'Add a range',
    rangeLabel: 'Label',
    rangeLabelPlaceholder: 'e.g. Hot lead',
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
    tabResults: 'Resultados',
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
    copied: 'Copiado',
    openForm: 'Abrir formulario',
  },
  badges: {
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
    tipNotify: 'Considera avisar a tus respondientes de que sus respuestas pueden recopilarse antes de enviar.',
    tipWhere: 'Míralos en Envíos con el filtro «Parciales».',
    tipAfterLast: 'Después de la última pregunta nunca se activa — el envío final ya lo captura todo.',
    designNote:
      'Se configura en la lista de preguntas, en la pestaña Construir — busca la tarjeta «Punto de envío parcial».',
  },
  revealPoint: {
    label: 'Pantalla de revelación',
    remove: 'Quitar la pantalla de revelación',
    move: 'Mover la pantalla de revelación',
    info: 'Acerca de la pantalla de revelación',
    tipPlays: 'Muestra una breve pantalla de procesamiento en este punto del formulario.',
    tipEnd: 'Al final se muestra justo antes del resultado — nunca a mitad del formulario.',
    tipMid: 'Aquí se muestra después de esta pregunta y luego el formulario continúa.',
    tipEdit: 'Edita su titular, subtítulo y duración en Diseño.',
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
    nameFirstPlaceholder: 'Nombre',
    nameLastPlaceholder: 'Apellidos',
  },
  settings: {
    title: 'Ajustes de la pregunta',
    questionType: 'Tipo de pregunta',
    required: 'Obligatoria',
    options: 'Opciones',
    addOption: 'Añadir opción',
    logic: 'Lógica',
    addRule: 'Añadir regla',
    noRules: 'Sin reglas — todos ven esta pregunta.',
    scoring: 'Puntaje',
    scoringHint:
      'El puntaje se aplica a todo el formulario, no solo a esta pregunta. Los puntos de la opción elegida suman al total; define los rangos en Resultados.',
    scoringZeroHint: 'Asigna puntos a tus respuestas para habilitar los rangos.',
    contactHint: 'Campo de contacto — no afecta el puntaje.',
    delete: 'Eliminar pregunta',
    deleteConfirm: '¿Eliminar esta pregunta?',
    empty: 'Selecciona una pregunta para editarla.',
  },
  tokens: {
    hint: 'Escribe @ para insertar una respuesta anterior',
    pickerLabel: 'Insertar una respuesta anterior',
    pickerEmpty: 'Aún no hay respuestas anteriores — esta es la primera pregunta.',
    pickerNoMatch: 'Ningún campo coincide.',
    warnLater: '«{token}» se pregunta después de este paso — quedará vacío.',
    warnUnknown: '«{token}» no existe en este formulario.',
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
    outcomeKicker: 'Final',
  },
  results: {
    pointsTitle: 'Puntos',
    pointsHint: 'Cada respuesta suma al puntaje. Máximo posible: {n}.',
    endTitle: 'Qué pasa al final',
    endHint: 'Asigna rangos de puntaje a un resultado. Gana el primer rango que coincida.',
    addRange: 'Añadir un rango',
    rangeLabel: 'Etiqueta',
    rangeLabelPlaceholder: 'p. ej. Lead caliente',
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
