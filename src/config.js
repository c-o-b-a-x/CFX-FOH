import process from 'node:process';

try {
  process.loadEnvFile();
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.warn(`[config] Could not load .env: ${error.message}`);
  }
}

const raw = (name, fallback = '') => (process.env[name] ?? fallback).trim();

function parseIdList(value) {
  return value
    .split(/[\s,;]+/)
    .map((id) => id.replace(/[<@&!>]/g, '').trim())
    .filter((id) => /^\d{17,20}$/.test(id));
}

function parseTicketPattern(source) {
  if (!source) return /^ticket-\d{4}$/i;
  try {
    return new RegExp(source, 'i');
  } catch (error) {
    throw new Error(`TICKET_CHANNEL_REGEX is not a valid regular expression (${source}): ${error.message}`);
  }
}

function parseColor(value) {
  const hex = value.replace(/^#/, '').replace(/^0x/i, '');
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : 0xf1c40f;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  token: raw('DISCORD_TOKEN'),
  orderChannelId: raw('ORDER_CHANNEL_ID'),
  pingRoleIds: parseIdList(raw('PING_ROLE_IDS')),
  pingUserIds: parseIdList(raw('PING_USER_IDS')),
  purgeAllowedUserIds: (() => {
    const explicit = parseIdList(raw('PURGE_ALLOWED_USER_IDS'));
    return explicit.length > 0 ? explicit : parseIdList(raw('PING_USER_IDS'));
  })(),
  pingMessage: raw('ORDER_PING_MESSAGE', 'New order received!'),
  ticketChannelPattern: parseTicketPattern(raw('TICKET_CHANNEL_REGEX')),
  responseDelaySeconds: Math.min(60, parseNonNegativeNumber(raw('TICKET_RESPONSE_DELAY_SECONDS'), 5)),
  formTimeoutMinutes: parsePositiveNumber(raw('FORM_TIMEOUT_MINUTES'), 1440),
  maxAttachments: Math.min(10, Math.floor(parsePositiveNumber(raw('MAX_ATTACHMENTS'), 10))),
  maxAttachmentMb: parsePositiveNumber(raw('MAX_ATTACHMENT_MB'), 20),
  embedColor: parseColor(raw('EMBED_COLOR', 'f1c40f')),
  dryRun: /^(1|true|yes)$/i.test(raw('DRY_RUN', 'false')),
};

export function validateConfig() {
  const problems = [];

  if (!config.token) {
    problems.push('DISCORD_TOKEN is missing.');
  }
  if (!/^\d{17,20}$/.test(config.orderChannelId)) {
    problems.push('ORDER_CHANNEL_ID must be a Discord channel ID (digits).');
  }
  if (config.pingRoleIds.length === 0 && config.pingUserIds.length === 0) {
    console.warn('[config] No PING_ROLE_IDS or PING_USER_IDS set — new orders will not ping anyone.');
  }
  if (config.purgeAllowedUserIds.length === 0) {
    console.warn(
      '[config] No PING_USER_IDS or PURGE_ALLOWED_USER_IDS set — /purge will reject every user.',
    );
  }

  if (problems.length > 0) {
    throw new Error(`${problems.join(' ')} Copy .env.example to .env and fill it in.`);
  }
}
