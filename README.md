# Foundry

A visual builder for AI agent factories, built on [eve](https://eve.dev). Lay out an orchestrator and its subagents on a canvas, then give them skills, plugins, tools, and connections to external services and MCP servers. Wire up channels like web chat and Slack, schedule recurring tasks, and chat with the factory right from the builder.

![Foundry builder](docs/screenshot.png)

POC factory runs on one shared eve deployment. Recommend forking repo for production to create separate tenants. Factories are stored as data and built into an agent at runtime, so edits apply from the next message without a redeploy. See [architecture.md](architecture.md) for details.

## Layout

- `agent/`: the shared eve agent that runs every factory
- `apps/web`: the Next.js builder
- `packages/factory`: Prisma schema, database reads, secrets, and connection sign-in

## Getting started

Add a `.env.local` at the root with:

```bash
DATABASE_URL=postgres://...
FOUNDRY_SECRETS_KEY=...
```

`FOUNDRY_SECRETS_KEY` encrypts secrets stored in the database (plugin env values and OAuth tokens). Generate it once with `openssl rand -base64 32` and never change it, or stored secrets become unreadable.

Models run through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). Either link a Vercel project (below) or add `AI_GATEWAY_API_KEY` to `.env.local`.

Then link it into `apps/web`, install, migrate, and start the builder:

```bash
ln -s ../../.env.local apps/web/.env.local
npm install
npm run db:migrate
npm run dev:web
```

To talk to the agent directly in eve's dev TUI, run `npm run dev`.

## Vercel

Linking a Vercel project gives Foundry an OIDC token, which it uses for AI Gateway and [Vercel Connect](https://vercel.com/docs/connect) sign-in to MCP servers. Without it, MCP sign-in falls back to Foundry's own OAuth, which only some servers support.

1. Link the project from the repo root: `npx vercel link`.
2. Add `DATABASE_URL`, `FOUNDRY_SECRETS_KEY`, and the Google variables below to the project's environment variables in the Vercel dashboard.
3. Pull them, along with the OIDC token, into `.env.local`: `npx vercel env pull .env.local`. This overwrites the file, so keep every variable in Vercel.

The local OIDC token expires after about 12 hours. Run `vercel env pull` again when AI Gateway or MCP sign-in starts failing.

## Google services

Gmail, Google Calendar, and Google Sheets connections sign in through your own Google OAuth app.

1. Create a project in the [Google Cloud console](https://console.cloud.google.com).
2. Enable the Gmail API, Google Calendar API, and Google Sheets API.
3. Set up the OAuth consent screen with these scopes:
    - `https://www.googleapis.com/auth/gmail.send`
    - `https://www.googleapis.com/auth/calendar.events`
    - `https://www.googleapis.com/auth/calendar.events.freebusy`
    - `https://www.googleapis.com/auth/spreadsheets`
4. While the app is in testing, add your Google account as a test user.
5. Create an OAuth client ID of type **Web application**. Add `<origin>/oauth/callback` as an authorized redirect URI for every place Foundry runs, like `http://localhost:3000/oauth/callback` and `https://your-app.vercel.app/oauth/callback`.
6. Add the client's credentials to `.env.local` (or Vercel):

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Until Google verifies the app, sign-in shows an "unverified app" warning, is capped at 100 users, and expires after 7 days in testing mode.

## Deploy

```bash
npm run deploy
```

The builder's chat is blocked in production until you replace `placeholderAuth()` in `agent/channels/eve.ts` with real auth. Foundry has no accounts yet, so anyone who can reach it can edit any factory. See the [eve deployment docs](https://eve.dev/docs/guides/deployment/vercel) for authentication and environment variables.
