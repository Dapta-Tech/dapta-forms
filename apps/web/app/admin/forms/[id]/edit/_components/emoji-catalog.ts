/**
 * A curated emoji set for option icons — hand-picked for the things forms
 * actually ask about (reactions, roles, business, tooling, status) rather than
 * the full Unicode table.
 *
 * Deliberately a local constant, not a package: pulling a full emoji-picker
 * dependency in for one field would add a payload far larger than the builder
 * itself, and the repo keeps its dependency surface small. Groups are only used
 * to break the grid into labelled sections.
 */
export interface EmojiGroup {
  /** i18n key under `admin.editor.options.emojiGroups`. */
  key: 'reactions' | 'people' | 'business' | 'tech' | 'comms' | 'status' | 'places';
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: 'reactions',
    emojis: [
      '😍', '😀', '🙂', '😐', '🙁', '😡', '🤔', '😎', '🥳', '😴',
      '🤯', '🤩', '😅', '🙌', '👏', '💪', '🫶', '🤝',
    ],
  },
  {
    key: 'people',
    emojis: [
      '👤', '👥', '🧑‍💼', '👨‍💼', '👩‍💼', '🧑‍💻', '🧑‍🔧', '🧑‍🏫',
      '🧑‍⚕️', '🧑‍🍳', '🧑‍🌾', '👶', '🧑', '👴', '🏃', '🧠',
    ],
  },
  {
    key: 'business',
    emojis: [
      '💼', '🏢', '🏭', '🏪', '🏦', '📈', '📉', '📊', '💰', '💵',
      '💳', '🧾', '🎯', '🚀', '📋', '🗂️', '📁', '✍️',
    ],
  },
  {
    key: 'tech',
    emojis: [
      '💻', '🖥️', '📱', '⌨️', '🖱️', '🌐', '☁️', '🔌', '🔒', '🔑',
      '🤖', '⚡', '⚙️', '🔧', '🛠️', '🧩', '🗄️', '📡',
    ],
  },
  {
    key: 'comms',
    emojis: [
      '📧', '✉️', '📨', '📞', '☎️', '💬', '🗨️', '📣', '🔔', '📢',
      '📝', '📮', '🤙', '📬',
    ],
  },
  {
    key: 'status',
    emojis: [
      '✅', '❌', '⭐', '❤️', '👍', '👎', '➕', '➖', '❓', '❗',
      '🔥', '💡', '🏆', '🎁', '📌', '🔍', '⏰', '⌛', '📅', '⏳',
    ],
  },
  {
    key: 'places',
    emojis: [
      '🏠', '🏥', '🏫', '🏨', '🚗', '✈️', '🚚', '🌍', '🛒', '📦',
      '🎓', '⚖️', '🏗️', '🌱',
    ],
  },
];
