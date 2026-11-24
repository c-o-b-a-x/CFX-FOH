import {
  ChannelType,
  Events,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config.js';
import { FIELDS, formatDuration, parseFormResponse } from './form.js';
import { downloadAttachments } from './attachments.js';
import {
  buildConfirmationEmbed,
  buildErrorEmbed,
  buildOrderEmbed,
  buildPromptEmbed,
  buildTimeoutEmbed,
} from './messages.js';

/** channelId -> open form session */
const sessions = new Map();
/** channels that already received a form in this process */
const handledChannels = new Set();
/** channels currently being prompted (guards create/update races) */
const pendingChannels = new Set();
let warnedAboutContentIntent = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerTicketHandlers(client) {
  client.on(Events.ChannelCreate, (channel) => {
    void handleChannelCreate(client, channel);
  });

  // Some ticket tools create the channel first and rename it afterwards.
  client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
    if (oldChannel.name === newChannel.name) return;
    void handleChannelCreate(client, newChannel);
  });

  client.on(Events.ChannelDelete, (channel) => {
    sessions.get(channel.id)?.collector?.stop('deleted');
    sessions.delete(channel.id);
    handledChannels.delete(channel.id);
  });
}

export async function checkOrderChannel(client) {
  try {
    const channel = await client.channels.fetch(config.orderChannelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('the ID does not point to a text channel');
    }
    console.log(`[startup] Orders will be posted to #${channel.name}`);
    return true;
  } catch (error) {
    console.error(
      `[startup] Cannot access ORDER_CHANNEL_ID ${config.orderChannelId}: ${error.message}`,
    );
    return false;
  }
}

async function handleChannelCreate(client, channel) {
  if (!channel?.guild) return;
  if (channel.type !== ChannelType.GuildText) return;
  if (!config.ticketChannelPattern.test(channel.name)) return;
  if (handledChannels.has(channel.id)) return;
  if (sessions.has(channel.id)) return;
  if (pendingChannels.has(channel.id)) return;

  pendingChannels.add(channel.id);
  console.log(`[ticket] New ticket channel #${channel.name} (${channel.id})`);

  try {
    // Give the ticket tool time to post its controls/messages first.
    const responseDelayMs = config.responseDelaySeconds * 1000;
    if (responseDelayMs > 0) {
      console.log(
        `[ticket] Waiting ${config.responseDelaySeconds}s before posting the form in #${channel.name}`,
      );
      await sleep(responseDelayMs);
    }

    const openerId = await findOpenerId(channel, client);
    const timeoutLabel = formatDuration(config.formTimeoutMinutes);

    try {
      await sendPromptWithRetry(channel, openerId, timeoutLabel);
    } catch (error) {
      console.error(`[ticket] Could not send the form to #${channel.name}: ${error.message}`);
      return;
    }

    handledChannels.add(channel.id);
    startSession(channel, openerId, timeoutLabel);
  } finally {
    pendingChannels.delete(channel.id);
  }
}

/** Ticket channels are created before permissions settle, so retry briefly. */
async function sendPromptWithRetry(channel, openerId, timeoutLabel) {
  const delays = [0, 1_500, 4_000, 8_000];
  let lastError;

  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      return await channel.send({
        content: openerId ? `<@${openerId}>` : undefined,
        embeds: [buildPromptEmbed({ color: config.embedColor, timeoutLabel })],
        allowedMentions: openerId ? { parse: [], users: [openerId] } : { parse: [] },
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function findOpenerId(channel, client) {
  const topic = channel.topic ?? '';
  const topicMatch =
    topic.match(/<@!?(\d{17,20})>/) ?? topic.match(/\b(?:user|opened by|owner)\s*[:#=]?\s*(\d{17,20})\b/i);

  if (topicMatch) {
    return (await isHumanUser(client, topicMatch[1])) ? topicMatch[1] : null;
  }

  const memberOverwrites = channel.permissionOverwrites.cache.filter(
    (overwrite) =>
      overwrite.type === OverwriteType.Member &&
      overwrite.id !== client.user.id &&
      overwrite.allow.has(PermissionFlagsBits.ViewChannel),
  );

  if (memberOverwrites.size === 1) {
    const candidate = memberOverwrites.firstKey();
    return (await isHumanUser(client, candidate)) ? candidate : null;
  }

  return null;
}

/** Guard against picking the ticket bot (or another bot) as the customer. */
async function isHumanUser(client, userId) {
  try {
    const user = await client.users.fetch(userId, { force: false });
    return !user.bot;
  } catch {
    return false;
  }
}

function startSession(channel, openerId, timeoutLabel) {
  const session = {
    channel,
    submitterId: openerId,
    data: Object.create(null),
    extras: new Map(),
    attachments: new Map(),
    submitting: false,
    nudged: false,
    collector: null,
  };

  sessions.set(channel.id, session);

  session.collector = channel.createMessageCollector({
    filter: (message) =>
      !message.author.bot &&
      (!session.submitterId || message.author.id === session.submitterId),
    idle: config.formTimeoutMinutes * 60_000,
  });

  session.collector.on('collect', (message) => {
    void handleFormMessage(session, message);
  });

  session.collector.on('end', async (_collected, reason) => {
    if (sessions.get(channel.id) === session) {
      sessions.delete(channel.id);
    }
    if (reason !== 'idle') return;

    await channel
      .send({
        embeds: [buildTimeoutEmbed({ color: config.embedColor, timeoutLabel })],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  });

  session.collector.on('error', (error) => {
    console.error(`[ticket] Collector error in #${channel.name}: ${error.message}`);
  });
}

async function handleFormMessage(session, message) {
  if (session.submitting) return;
  if (!session.submitterId) session.submitterId = message.author.id;

  const addedAttachments = addAttachments(session, [...message.attachments.values()]);
  const parsed = parseFormResponse(message.content ?? '');

  // A message with only files: acknowledge it (or retry a previous failure).
  if (parsed.isBlank) {
    if (message.attachments.size > 0) {
      if (missingFields(session.data).length === 0) {
        await attemptSubmit(session, message);
        return;
      }

      const ack =
        addedAttachments > 0
          ? `📎 Saved ${session.attachments.size} file(s).`
          : `📎 I already have ${session.attachments.size} file(s) (max ${config.maxAttachments}).`;

      await message
        .reply({
          content: `${ack} ${missingSummary(session.data)}\nCopy the template from the form message above and fill in the missing fields.`,
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
      return;
    }

    // No text and no files at all: this is the signature of a disabled intent.
    if (!message.content?.trim()) {
      warnAboutContentIntent();
      return;
    }

    if (parsed.hasFormLabels) {
      await message
        .reply({
          content: `It looks like the form is still empty. ${missingSummary(session.data)}\nFill in a value after each label and send it again.`,
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
      return;
    }

    if (!session.nudged) {
      session.nudged = true;
      await message
        .reply({
          content:
            "I couldn't read that as an order form. Copy the template from the form message above, fill it in, and send it here — I'll take care of the rest.",
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
    }
    return;
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    session.data[key] = value;
  }
  for (const extra of parsed.extras) {
    session.extras.set(extra.label.toLowerCase(), extra);
  }

  const missing = missingFields(session.data);
  if (missing.length > 0) {
    await message
      .reply({
        content: `I still need: ${missing.map((field) => `**${field.label}**`).join(', ')}.\nSend the missing lines using the template above (e.g. \`Full name: Jane Doe\`).`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
    return;
  }

  await attemptSubmit(session, message);
}

async function attemptSubmit(session, message) {
  if (session.submitting) return;
  session.submitting = true;

  try {
    await submitOrder(session, message);
    session.collector?.stop('submitted');
  } catch (error) {
    session.submitting = false;
    console.error(`[ticket] Failed to forward order from #${session.channel.name}: ${error.message}`);

    await message
      .reply({
        embeds: [
          buildErrorEmbed({
            color: config.embedColor,
            message: `Something went wrong while forwarding your order (${error.message}). Your answers are saved — please try again, or ping a team member.`,
          }),
        ],
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  }
}

async function submitOrder(session, message) {
  const orderChannel = await session.channel.client.channels
    .fetch(config.orderChannelId)
    .catch(() => null);

  if (!orderChannel || !orderChannel.isTextBased()) {
    throw new Error('the order channel is unavailable');
  }
  if (orderChannel.id === session.channel.id) {
    throw new Error('the order channel is the same as the ticket channel');
  }

  const attachmentList = [...session.attachments.values()];
  const { files, failed, skipped } = await downloadAttachments(attachmentList, {
    maxFiles: config.maxAttachments,
    maxTotalBytes: config.maxAttachmentMb * 1024 * 1024,
  });

  const embed = buildOrderEmbed({
    color: config.embedColor,
    channelName: session.channel.name,
    submitter: message.member ?? message.author,
    submitterId: session.submitterId,
    data: session.data,
    extras: [...session.extras.values()],
    fileCount: files.length,
    attachmentCount: attachmentList.length,
    failedAttachments: failed,
    skippedAttachments: skipped,
  });

  const content = buildPingContent();
  const payload = {
    content,
    embeds: [embed],
    files,
    allowedMentions: {
      parse: [],
      roles: config.pingRoleIds,
      users: config.pingUserIds,
    },
  };

  let orderMessage = null;

  if (config.dryRun) {
    console.log(
      `[dry-run] Order from #${session.channel.name}:`,
      JSON.stringify({ data: session.data, extras: [...session.extras.values()] }, null, 2),
    );
  } else {
    if (files.length === 0) delete payload.files;
    orderMessage = await orderChannel.send(payload);
  }

  await session.channel
    .send({
      embeds: [
        buildConfirmationEmbed({
          channelName: session.channel.name,
          orderUrl: orderMessage?.url,
        }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch((error) => {
      console.warn(`[ticket] Could not confirm in #${session.channel.name}: ${error.message}`);
    });

  console.log(
    `[order] Forwarded ${session.channel.name} (${attachmentList.length} attachment(s), ${files.length} uploaded)`,
  );
}

function buildPingContent() {
  const parts = [
    ...config.pingRoleIds.map((id) => `<@&${id}>`),
    ...config.pingUserIds.map((id) => `<@${id}>`),
    config.pingMessage,
  ].filter((part) => part && part.trim().length > 0);

  return parts.length > 0 ? parts.join(' ') : undefined;
}

function addAttachments(session, attachments) {
  let added = 0;
  for (const attachment of attachments) {
    if (session.attachments.size >= config.maxAttachments) break;
    if (!session.attachments.has(attachment.id)) {
      session.attachments.set(attachment.id, attachment);
      added += 1;
    }
  }
  return added;
}

function missingFields(data) {
  return FIELDS.filter((field) => field.required && !data[field.key]);
}

function missingSummary(data) {
  const missing = missingFields(data);
  if (missing.length === 0) return 'All required details are in.';
  return `I still need: ${missing.map((field) => `**${field.label}**`).join(', ')}.`;
}

/** A human message with no text and no files usually means the intent is off. */
function warnAboutContentIntent() {
  if (warnedAboutContentIntent) return;
  warnedAboutContentIntent = true;
  console.warn(
    '[warn] Received a message with no readable text. If form replies are not being parsed, enable MESSAGE CONTENT INTENT for your bot in the Discord Developer Portal (Bot → Privileged Gateway Intents).',
  );
}
