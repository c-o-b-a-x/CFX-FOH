import {
  ApplicationCommandOptionType,
  ChannelType,
  Events,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from './config.js';

const MAX_PURGE = 1_000;
const BULK_LIMIT = 100;
const MAX_BULK_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

export const purgeCommand = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk delete recent messages in a channel')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((option) =>
    option
      .setName('amount')
      .setDescription('Number of messages to delete (1-1000)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_PURGE),
  )
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Channel to purge (defaults to this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

export function registerCommands(client) {
  const registerForGuild = async (guild) => {
    try {
      await guild.commands.set([purgeCommand]);
      console.log(`[commands] Registered /purge in ${guild.name}`);
    } catch (error) {
      console.error(
        `[commands] Could not register /purge in ${guild.name}: ${error.message}. ` +
          'Re-invite the bot with the applications.commands scope.',
      );
    }
  };

  client.once(Events.ClientReady, (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      void registerForGuild(guild);
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    void registerForGuild(guild);
  });
}

export async function handlePurge(interaction) {
  if (!config.purgeAllowedUserIds.includes(interaction.user.id)) {
    await interaction
      .reply({
        content: 'You are not allowed to use this command.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction
      .reply({
        content: 'This command only works inside a server.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const amount = interaction.options.getInteger('amount', true);
  const selectedChannel = interaction.options.getChannel('channel');
  const targetChannel = selectedChannel ?? interaction.channel;

  if (!targetChannel || !targetChannel.isTextBased() || !('bulkDelete' in targetChannel)) {
    await interaction
      .reply({
        content: 'That channel does not support bulk deleting messages.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  const permissions = targetChannel.permissionsFor(me);

  if (!permissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction
      .reply({
        content: `I need the **Manage Messages** permission in ${targetChannel} to delete messages there.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
    await interaction
      .reply({
        content: `I need the **Read Message History** permission in ${targetChannel} to find messages to delete.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await purgeMessages(targetChannel, amount);
    await interaction.editReply({ content: buildResultMessage(targetChannel, amount, result) });
    console.log(
      `[purge] ${interaction.user.tag} deleted ${result.deleted} message(s) in #${targetChannel.name}`,
    );
  } catch (error) {
    console.error(`[purge] Failed in #${targetChannel.name}: ${error.message}`);
    await interaction
      .editReply({ content: `Purge failed: ${error.message}` })
      .catch(() => {});
  }
}

/**
 * Deletes up to `amount` recent messages. Discord only bulk-deletes messages
 * younger than 14 days, so older ones are counted and left alone.
 */
export async function purgeMessages(channel, amount) {
  const cutoff = Date.now() - MAX_BULK_AGE_MS;
  let deleted = 0;
  let skippedOld = 0;
  let failed = 0;
  let before;

  while (deleted + skippedOld < amount) {
    const want = Math.min(BULK_LIMIT, amount - deleted - skippedOld);
    const batch = await channel.messages.fetch({
      limit: want,
      ...(before ? { before } : {}),
    });

    if (batch.size === 0) break;

    const messages = [...batch.values()];
    before = messages.at(-1).id;

    const deletable = messages.filter((message) => message.createdTimestamp > cutoff);
    skippedOld += messages.length - deletable.length;

    if (deletable.length === 0) break;

    try {
      if (deletable.length === 1) {
        await deletable[0].delete();
        deleted += 1;
      } else {
        const removed = await channel.bulkDelete(deletable, false);
        deleted += removed.size;
      }
    } catch {
      // One undeletable message should not block the rest of the batch.
      for (const message of deletable) {
        try {
          await message.delete();
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    }

    if (batch.size < want) break;
  }

  return { deleted, skippedOld, failed };
}

function buildResultMessage(channel, amount, { deleted, skippedOld, failed }) {
  const lines = [
    `Deleted **${deleted}** message${deleted === 1 ? '' : 's'} in ${channel} (requested ${amount}).`,
  ];

  if (skippedOld > 0) {
    lines.push(
      `${skippedOld} message${skippedOld === 1 ? ' was' : 's were'} older than Discord's 14-day bulk delete limit and were skipped.`,
    );
  }
  if (failed > 0) {
    lines.push(`${failed} message${failed === 1 ? '' : 's'} could not be deleted.`);
  }

  return lines.join('\n');
}
