import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config, validateConfig } from './config.js';
import { handlePurge, registerCommands } from './commands.js';
import { checkOrderChannel, registerTicketHandlers } from './tickets.js';

try {
  validateConfig();
} catch (error) {
  console.error(`[config] ${error.message}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

registerTicketHandlers(client);
registerCommands(client);

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'purge') {
    void handlePurge(interaction);
  }
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[ready] Logged in as ${readyClient.user.tag}`);
  console.log(`[ready] Watching for channels matching ${config.ticketChannelPattern}`);
  await checkOrderChannel(readyClient);
});

client.on(Events.Error, (error) => {
  console.error('[client error]', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason);
});

async function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, disconnecting…`);
  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

client.login(config.token).catch((error) => {
  console.error(`[login] ${error.message}`);
  process.exitCode = 1;
});
