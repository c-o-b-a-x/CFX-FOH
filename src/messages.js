import { EmbedBuilder, codeBlock } from 'discord.js';
import { FIELDS, buildFormTemplate } from './form.js';

function truncate(value, max = 1024) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function buildPromptEmbed({ color, timeoutLabel }) {
  const questions = FIELDS.map((field, index) => {
    const requirement = field.required ? 'required' : 'optional';
    return `**${index + 1}. ${field.label}** *(${requirement})*\n${field.hint}`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🎫 New order form')
    .setDescription(
      [
        'Thanks for opening a ticket! Please fill out this short form so we can process your order.',
        [
          '**How to submit**',
          '• Copy the template below and fill in each line.',
          '• Attach screenshots or reference images **to the same message**.',
          "• Send it here — I'll forward everything to the team for you.",
        ].join('\n'),
        ['**Questions**', questions].join('\n'),
      ].join('\n\n'),
    )
    .addFields({
      name: '📋 Copy-paste template',
      value: codeBlock(buildFormTemplate()),
    })
    .setFooter({ text: `This form prompt expires after ${timeoutLabel}.` });
}

export function buildOrderEmbed({
  color,
  channelName,
  submitter,
  submitterId,
  data,
  extras = [],
  fileCount = 0,
  attachmentCount = 0,
  failedAttachments = [],
  skippedAttachments = [],
}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎫 New order — #${channelName}`)
    .setTimestamp(new Date());

  if (submitter) {
    const tag = submitter.user?.tag ?? submitter.tag ?? submitter.username ?? 'Customer';
    const icon =
      submitter.displayAvatarURL?.({ size: 128 }) ??
      submitter.user?.displayAvatarURL?.({ size: 128 });
    embed.setAuthor(icon ? { name: tag, iconURL: icon } : { name: tag });
  }

  embed.setDescription(
    submitterId
      ? `Submitted by <@${submitterId}> in \`#${channelName}\`.`
      : `Submitted in \`#${channelName}\`.`,
  );

  const inlineKeys = new Set(['name', 'email', 'quantity', 'budget', 'deadline']);
  for (const field of FIELDS) {
    const value = data[field.key];
    if (!value) continue;
    embed.addFields({
      name: field.label,
      value: truncate(value),
      inline: inlineKeys.has(field.key) && value.length <= 100 && !value.includes('\n'),
    });
  }

  if (extras.length > 0) {
    const text = extras
      .map((extra) => `**${truncate(extra.label, 80)}:** ${truncate(extra.value, 300)}`)
      .join('\n');
    embed.addFields({ name: '📝 Additional information', value: truncate(text) });
  }

  if (attachmentCount > 0) {
    const lines = [`📎 ${fileCount} of ${attachmentCount} file(s) attached to this message.`];
    for (const failed of failedAttachments) {
      lines.push(`⚠️ [${failed.name}](${failed.url}) could not be re-uploaded (${failed.reason}).`);
    }
    if (skippedAttachments.length > 0) {
      lines.push(
        `⚠️ Skipped: ${skippedAttachments.map((skipped) => `${skipped.name} (${skipped.reason})`).join(', ')}`,
      );
    }
    embed.addFields({ name: 'Attachments', value: truncate(lines.join('\n')) });
  }

  embed.setFooter({ text: `Ticket: #${channelName}` });

  return embed;
}

export function buildConfirmationEmbed({ channelName, orderUrl }) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Order submitted')
    .setDescription(
      "Your order has been forwarded to the team. We'll follow up with you here in this ticket.",
    )
    .addFields({ name: 'Reference', value: `\`${channelName}\``, inline: true });

  if (orderUrl) {
    embed.addFields({ name: 'Order message', value: `[Jump to message](${orderUrl})`, inline: true });
  }

  return embed.setTimestamp();
}

export function buildTimeoutEmbed({ color, timeoutLabel }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('⌛ Form still open')
    .setDescription(
      `No form was received in the last ${timeoutLabel}. Fill out the template above and send it here, or ping a team member for help.`,
    );
}

export function buildErrorEmbed({ color, message }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('⚠️ Could not forward your order')
    .setDescription(message);
}
