# Ticket Order Bot

Watches for new `Ticket-1234` style channels, prompts the customer with an order form, parses their reply (text **and** attached images), and posts a neat order summary in a staff channel with a ping.

## How it works

1. A channel named like `Ticket-1234` (case-insensitive, exactly four digits) is created.
2. After a short, configurable delay (default 5 seconds) — so any ticket-tool controls and messages appear first — the bot posts an order form with a copy-paste template, mentioning the ticket opener when it can identify them (from the channel topic or a member permission overwrite).
3. The customer replies with the filled template and attaches screenshots to the **same message**.
4. The bot parses the fields, re-uploads the images, and posts an embed to `ORDER_CHANNEL_ID`:
   - one embed field per question,
   - extra labelled answers under "Additional information",
   - the images attached directly to the order message (so they survive ticket deletion),
   - a ping for the configured roles/users.
5. The ticket gets a ✅ confirmation with the order reference.

If required fields are missing, the bot replies in the ticket with what is still needed and keeps listening. The form prompt expires after `FORM_TIMEOUT_MINUTES` of inactivity.

## Requirements

- Node.js 20.6 or newer
- A Discord application/bot

## Setup

1. Create an application at <https://discord.com/developers/applications>, add a **Bot**.
2. In **Bot → Privileged Gateway Intents**, enable **Message Content Intent** (required to read form answers).
3. Invite the bot with the `bot` and `applications.commands` scopes and these permissions: View Channels, Send Messages, Read Message History, Manage Messages, Embed Links, Attach Files.
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=125952&scope=bot%20applications.commands
   ```
   If you ping roles on new orders, the bot also needs to be able to mention those roles (role must be mentionable).
4. Install dependencies:
   ```bash
   npm install
   ```
5. Copy `.env.example` to `.env` and fill it in (at minimum `DISCORD_TOKEN` and `ORDER_CHANNEL_ID`).
6. Start the bot:
   ```bash
   npm start
   ```

Run the parser tests with `npm test`.

## Hosting

The bot keeps a Discord gateway (WebSocket) connection open, so it needs a **long-running process** — a serverless function or Cloudflare Worker is not a fit. Run **exactly one instance**: two copies would both post forms and duplicate orders.

### On your own PC (Windows)

```powershell
npm install
copy .env.example .env
notepad .env        # fill in the token, channel ID and ping IDs
npm start
```

For an always-on setup use PM2:

```powershell
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs ticket-order-bot
```

PM2 does not start itself on Windows boot — create a Task Scheduler task that runs `pm2 resurrect` at logon/startup, or install the bot as a service with [NSSM](https://nssm.cc/) (`node.exe` + `src\index.js`, with the project folder as the working directory). Disable sleep/hibernation, otherwise the bot goes offline and misses ticket channels created while the PC is asleep.

### VPS with Docker (recommended for 24/7)

Any small Linux VPS works (Hetzner, DigitalOcean, Vultr, Oracle free tier…). On the server:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
# upload/copy the project, then:
cd ticket-order-bot
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f
```

Update later with `docker compose up -d --build` after copying the new files. The container restarts automatically (`restart: unless-stopped`) and reads configuration from `.env`.

### VPS with systemd (no Docker)

Install Node.js 20.6+ (for example via NodeSource or nvm), then:

```bash
sudo useradd --system --create-home discordbot
sudo mkdir -p /opt/ticket-order-bot
# copy the project there and set the owner:
sudo chown -R discordbot:discordbot /opt/ticket-order-bot
cd /opt/ticket-order-bot
sudo -u discordbot npm ci --omit=dev
sudo -u discordbot cp .env.example .env
sudo -u discordbot nano .env
sudo cp deploy/ticket-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ticket-bot
journalctl -u ticket-bot -f
```

Check `which node` and adjust `ExecStart` in the unit file if Node is installed elsewhere.

### Managed platforms

- **Railway** — deploy the repo, set the env variables in the dashboard, start command `npm start`. One replica.
- **Render** — use a **Background Worker** (not a Web Service), build `npm ci`, start `npm start`.
- **Fly.io** — the repo includes a root `fly.toml` with no `app` key, so the Fly dashboard's GitHub launch UI can supply the app name/region. Deploy from the dashboard, then add secrets in the app's **Secrets** page. No public HTTP service is created. The CLI equivalent is in `deploy/fly.toml.example`.

On every platform, set the variables from `.env.example` in the host's secret/environment settings rather than committing `.env`.

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot token (required) |
| `ORDER_CHANNEL_ID` | — | Where finished orders are posted (required) |
| `PING_ROLE_IDS` | empty | Comma-separated role IDs pinged on every order |
| `PING_USER_IDS` | empty | Comma-separated user IDs pinged on every order |
| `PURGE_ALLOWED_USER_IDS` | empty (uses `PING_USER_IDS`) | User IDs allowed to run `/purge` |
| `ORDER_PING_MESSAGE` | `New order received!` | Text that accompanies the ping |
| `TICKET_CHANNEL_REGEX` | `^ticket-\d{4}$` | Channel name pattern (case-insensitive) |
| `TICKET_RESPONSE_DELAY_SECONDS` | `5` | Wait before posting the form so ticket-tool controls appear first (max 60, `0` disables) |
| `FORM_TIMEOUT_MINUTES` | `1440` | How long the bot waits for a form reply |
| `MAX_ATTACHMENTS` | `10` | Max files forwarded per order |
| `MAX_ATTACHMENT_MB` | `20` | Max total upload size |
| `EMBED_COLOR` | `f1c40f` | Embed accent colour |
| `DRY_RUN` | `false` | Log orders instead of posting them |

IDs can be pasted as raw IDs or as mentions (`<@&123…>` / `<@123…>`); both work.

## Commands

### `/purge`

Mass deletes recent messages in the current channel, or in the channel you pick.

- `amount` — 1 to 1000 messages.
- `channel` — optional; defaults to the channel where you run the command.

Only user IDs in `PURGE_ALLOWED_USER_IDS` can run it (falls back to `PING_USER_IDS`, i.e. the users mentioned for new orders). The reply is ephemeral, so it is not caught in the purge.

Discord only lets bots bulk-delete messages younger than 14 days; older messages are skipped and reported. The bot needs **Manage Messages** and **Read Message History** in the target channel. Commands are registered per server on startup, which requires the `applications.commands` invite scope.

## Customising the form

Edit `FIELDS` in `src/form.js`. Each field has:

- `key` — internal name (keep it unique),
- `label` — shown in the prompt and in the forwarded order,
- `required` — the order is only forwarded once all required fields are present,
- `hint` — helper text in the prompt,
- `aliases` — extra labels the parser accepts (e.g. `qty` for Quantity).

The parser accepts labelled lines (`Full name: Jane Doe`), numbered answers (`1. Jane Doe`, mapped in field order), and values placed on the line after a label. Unrecognised labelled lines are forwarded under "Additional information".

## Notes and limitations

- Images are downloaded and re-uploaded, so they stay available after the ticket is deleted. Files over `MAX_ATTACHMENT_MB` total (or beyond `MAX_ATTACHMENTS`) are skipped and noted in the order embed.
- Ask customers to attach screenshots to the **same message** as the filled form. The bot forwards the order as soon as all required fields are present, so files sent afterwards are not included. Files sent before the completed form are included.
- Ticket-opener detection uses a mention (`<@id>`) or `user: <id>` in the channel topic, or the single member permission overwrite. Bots are never picked. If neither exists, the first human to reply in the ticket is treated as the customer.
- Discord only sends `CHANNEL_CREATE` for channels the bot can already see. If your ticket tool creates channels with restricted permissions, add the bot's role to the ticket tool's staff/bot permissions (or to the ticket category) so it receives the event. The bot retries for ~13 seconds in case permissions settle after creation.
- The bot also notices matching channels renamed into the `Ticket-####` pattern.
- The bot only reacts to channels created while it is running. It does not retroactively prompt existing ticket channels after a restart, and open form sessions are lost on restart.
- `Message Content Intent` must stay enabled, otherwise text answers arrive empty.

## Troubleshooting

- **No form posted:** make sure the bot can View Channel and Send Messages in the new ticket, that the channel name matches `TICKET_CHANNEL_REGEX`, and that tickets are not created in a category the bot cannot see.
- **Form appears before the ticket controls:** increase `TICKET_RESPONSE_DELAY_SECONDS` (e.g. `8` or `10`).
- **Form replies are ignored:** enable the Message Content Intent for the bot and restart it. The console also logs a warning when it receives an empty message.
- **No ping:** the configured role must be mentionable, and the bot needs permission to mention it. Pings are sent in the order channel message, not in the ticket.
- **Bot starts, then exits:** check the console output. Missing `DISCORD_TOKEN` or `ORDER_CHANNEL_ID` is reported at startup.
