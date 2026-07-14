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
  };
  badges: {
    contact: string;
    logic: string;
    /** "{n} rules" */
    rules: string;
    /** "1 rule" */
    ruleOne: string;
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
    contactHint: string;
    delete: string;
    deleteConfirm: string;
    empty: string;
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
    scratch: string;
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
  },
  badges: {
    contact: 'Contact',
    logic: 'Logic',
    rules: '{n} rules',
    ruleOne: '1 rule',
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
    scoringHint: 'Points from the selected option add to the total score. Set ranges in Results.',
    contactHint: 'Contact field — doesn’t affect the score.',
    delete: 'Delete question',
    deleteConfirm: 'Delete this question?',
    empty: 'Select a question to edit it.',
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
    subtitle: 'Start from a template and edit every question live — or begin with a blank canvas.',
    scratch: 'or start from scratch — add your first question',
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
  },
  badges: {
    contact: 'Contacto',
    logic: 'Lógica',
    rules: '{n} reglas',
    ruleOne: '1 regla',
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
    scoringHint: 'Los puntos de la opción elegida suman al total. Define los rangos en Resultados.',
    contactHint: 'Campo de contacto — no afecta el puntaje.',
    delete: 'Eliminar pregunta',
    deleteConfirm: '¿Eliminar esta pregunta?',
    empty: 'Selecciona una pregunta para editarla.',
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
    subtitle: 'Empieza desde una plantilla y edita cada pregunta en vivo — o comienza con un lienzo en blanco.',
    scratch: 'o empieza desde cero — añade tu primera pregunta',
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
