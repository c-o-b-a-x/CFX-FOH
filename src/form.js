/**
 * The order form definition and parser.
 *
 * Edit FIELDS to change the questions. `key` is stable (used internally),
 * `label` is shown to users and in the forwarded order, `aliases` are extra
 * names the parser accepts (e.g. "qty" for "Quantity").
 */
export const FIELDS = [
  {
    key: 'name',
    label: 'Full name',
    required: true,
    hint: 'Your first and last name',
    aliases: ['name', 'your name', 'customer name', 'client name'],
  },
  {
    key: 'email',
    label: 'Email',
    required: true,
    hint: 'Where we can reach you',
    aliases: ['email', 'e mail', 'email address', 'mail'],
  },
  {
    key: 'service',
    label: 'Service or product',
    required: true,
    hint: 'What are you ordering?',
    aliases: ['service', 'product', 'service product', 'item', 'order'],
  },
  {
    key: 'quantity',
    label: 'Quantity',
    required: false,
    hint: 'How many do you need?',
    aliases: ['quantity', 'qty', 'amount', 'how many'],
  },
  {
    key: 'budget',
    label: 'Budget',
    required: false,
    hint: 'Your budget or price range',
    aliases: ['budget', 'price', 'price range'],
  },
  {
    key: 'deadline',
    label: 'Deadline',
    required: false,
    hint: 'When do you need it?',
    aliases: ['deadline', 'due date', 'due', 'delivery date', 'when'],
  },
  {
    key: 'details',
    label: 'Details',
    required: true,
    hint: 'Anything else we should know',
    aliases: ['details', 'notes', 'description', 'additional info', 'additional information', 'comments', 'requirements'],
  },
];

const LABEL_PATTERN = /^([A-Za-z][A-Za-z0-9 /&'()._+-]{0,48}?)\s*[:=]\s*(.*)$/;
const NUMBER_PATTERN = /^(\d{1,2})\s*[.)]\s+(.+)$/;
const URL_PATTERN = /^https?:\/\//i;

function normalizeLabel(value) {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\?/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const aliasIndex = new Map();
for (const field of FIELDS) {
  for (const alias of [field.label, ...(field.aliases ?? [])]) {
    aliasIndex.set(normalizeLabel(alias), field.key);
  }
}

function cleanLine(line) {
  return line
    .replace(/^\s*>+\s*/, '')
    .replace(/^\s*[-•*·]\s+/, '')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .trim();
}

function appendValue(target, key, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return;
  target[key] = target[key] ? `${target[key]}\n${trimmed}` : trimmed;
}

function matchLabel(line) {
  if (URL_PATTERN.test(line)) return null;
  const match = line.match(LABEL_PATTERN);
  if (!match) return null;

  const rawLabel = match[1].trim();
  const value = match[2].trim();

  return {
    key: aliasIndex.get(normalizeLabel(rawLabel)) ?? null,
    rawLabel,
    value,
  };
}

/**
 * Parses a free-form form reply into `{ data, extras, missing, isBlank }`.
 *
 * Supported shapes (mixed freely):
 *   Full name: Jane Doe            (label: value)
 *   **Email:** jane@example.com    (bold is stripped)
 *   1. Jane Doe                    (numbered, mapped to FIELDS order)
 *   Full name:                     (value on the following line(s))
 *   Jane Doe
 */
export function parseFormResponse(text) {
  const data = Object.create(null);
  const extras = [];
  let currentKey = null;
  let currentExtra = null;
  let hasFormLabels = false;

  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of lines) {
    const cleaned = cleanLine(rawLine);
    if (!cleaned) continue;

    let numbered = null;
    let remainder = cleaned;
    const numberMatch = cleaned.match(NUMBER_PATTERN);
    if (numberMatch) {
      numbered = Number(numberMatch[1]);
      remainder = numberMatch[2].trim();
    }

    const label = matchLabel(remainder);

    if (label?.key) {
      hasFormLabels = true;
      currentKey = label.key;
      currentExtra = null;
      if (label.value) appendValue(data, label.key, label.value);
      continue;
    }

    if (numbered !== null) {
      const field = FIELDS[numbered - 1];
      if (field) {
        // Unknown label on a numbered line: treat its value positionally.
        const value = label ? label.value : remainder;
        hasFormLabels = true;
        appendValue(data, field.key, value);
        currentKey = field.key;
        currentExtra = null;
        continue;
      }
    }

    if (label) {
      if (label.value && !URL_PATTERN.test(remainder)) {
        currentKey = null;
        currentExtra = { label: label.rawLabel, value: label.value };
        extras.push(currentExtra);
      }
      continue;
    }

    if (currentExtra) {
      currentExtra.value += `\n${cleaned}`;
      continue;
    }
    if (currentKey) {
      appendValue(data, currentKey, cleaned);
    }
  }

  const missing = FIELDS.filter((field) => field.required && !data[field.key]);

  return {
    data,
    extras,
    missing,
    hasFormLabels,
    isBlank: Object.keys(data).length === 0 && extras.length === 0,
  };
}

export function buildFormTemplate() {
  return FIELDS.map((field) => `${field.label}${field.required ? '' : ' (optional)'}:`).join('\n');
}

export function formatDuration(minutes) {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded >= 1440) {
    const days = Math.round(rounded / 1440);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (rounded >= 60) {
    const hours = Math.round(rounded / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${rounded} minute${rounded === 1 ? '' : 's'}`;
}
