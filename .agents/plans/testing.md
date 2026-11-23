# Testing plan

Foundry has no automated tests and no CI. `architecture.md` says the tenant-scoped loader and the save actions should get tests first, so this plan starts there and follows the integration-first approach in `.agents/skills/testing`.

## What we're testing

The backend has four surfaces:

- **Server actions** in `apps/web/app/factories/actions.ts`. These are plain async functions.
- **Route handlers** under `apps/web/app/oauth/*`. Each is a `GET(NextRequest)` that returns a `Response`.
- **Data layer** in `packages/factory/src/db.ts` (`loadFactoryConfig`, `getFactory`) and `packages/factory/src/auth/*` (sign-in, token refresh).
- **eve dynamic files** in `agent/lib/factory.ts`, which build each factory's agent before every model call.

The UI is the builder in `apps/web/app/factories/[factoryId]/`. It autosaves each edit through the server actions above. Phase 6 covers a few of its flows end to end.

The third parties we'll mock:

- MCP servers and their OAuth servers
- Google's token endpoint and APIs
- Vercel Connect and Vercel OIDC
- ClawHub
- AI Gateway

The database is Postgres 17 from Homebrew. Docker isn't installed.

## Tooling

### Test runner

- Use **Vitest** with one root `vitest.config.ts`.
- Split it into two projects:
  - `unit`: files named `*.test.ts`. No database. Runs in parallel.
  - `db`: files named `*.db.test.ts`. Uses the real database. Runs one file at a time.
- Vitest compiles TypeScript itself, so the TS 7 (root) and TS 5 (`apps/web`) split doesn't matter.
- Exclude `apps/web/e2e/`, which Playwright runs.

### HTTP contract

- There's no Express app or `http.Server`, so Supertest has nothing to bind to.
- Instead, call the route handlers directly with a real `NextRequest`, then assert on the `Response`: status, `set-cookie`, and body. This tests the same request/response contract without opening a port.
- Call server actions directly, like any other function.
- **This departs from the testing skill. Confirm before we build it.**

### Database

- Use a separate `foundry_test` database on the local Postgres.
- globalSetup runs `prisma migrate deploy` against it once.
- `beforeEach` truncates every table except `_prisma_migrations`.
- Real migrations run, so the check constraint on `Agent.slot`, the unique keys, and the cascades are all exercised.
- **Safety guard:** globalSetup refuses to run unless `DATABASE_URL` contains `_test`, so truncation can never touch the dev database.
- `getDb()` keeps one client on `globalThis`, so the test env must be set before anything calls it. Disconnect in `afterAll`.

### External HTTP

- Use **MSW** (`msw/node`) to intercept `fetch`.
- Set `onUnhandledRequest: "error"` so nothing reaches the real network.
- A local fake server won't work, because `isAllowedMcpUrl` blocks localhost. The fake MCP and OAuth server lives at `https://mcp.example.test` instead.
- Handlers keep hit counters, so tests can assert things like "the token endpoint was called once".

### Vercel Connect

- `vi.mock("@vercel/connect")` and `vi.mock("@vercel/oidc")`. They're third-party SDKs, so mocking them is allowed.

### Time

- Use `vi.useFakeTimers({ toFake: ["Date"] })`.
- Faking every timer can hang the pg pool. Faking only `Date` is enough for token expiry and the 10-minute sign-in limit.

### Env

Test setup sets:

- `DATABASE_URL` pointing at `foundry_test`
- a fixed test `FOUNDRY_SECRETS_KEY`
- test values for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

## File layout

Tests sit next to the code they test. Shared setup lives in one root `test/` folder.

```
vitest.config.ts
test/
  global-setup.ts      # _test guard, then migrate deploy
  setup.db.ts          # env, truncate before each test, MSW lifecycle, disconnect
  seed.ts              # seedFactory({ skills, tools, connections, subagents, gates, credential })
  oauth-server.ts      # MSW handlers for a fake MCP + auth server, with hit counters

packages/factory/src/index.test.ts
packages/factory/src/secrets.test.ts
packages/factory/src/db.db.test.ts
packages/factory/src/auth/oauth.db.test.ts
packages/factory/src/auth/index.db.test.ts

apps/web/app/factories/actions.db.test.ts
apps/web/app/factories/connect.db.test.ts
apps/web/app/oauth/oauth.db.test.ts
apps/web/app/oauth/sign-in.test.ts
apps/web/app/factories/[factoryId]/_components/schedule.test.ts
apps/web/app/factories/[factoryId]/_components/builder.test.ts
apps/web/app/factories/[factoryId]/_components/activity.test.ts

agent/lib/factory.db.test.ts
agent/lib/gates.test.ts
agent/lib/plugin-tools.db.test.ts
agent/channels/eve.db.test.ts

apps/web/playwright.config.ts
apps/web/instrumentation.ts      # starts MSW only when FOUNDRY_E2E=1
apps/web/e2e/home.spec.ts
apps/web/e2e/builder.spec.ts
apps/web/e2e/sign-in.spec.ts
```

Arrange with `seedFactory` (Prisma directly). Act with the real action, route, or loader. Assert by querying the database afterwards.

## Phase 0: Infrastructure

1. Add `vitest` and `msw` as root dev dependencies.
2. Add scripts: `test`, `test:unit`, `test:db`, and `db:test:prepare` (creates `foundry_test` and migrates it).
3. Write `vitest.config.ts` and the `test/` files above.
4. **Spike:** confirm Vitest can import `actions.ts`. It has `"use server"` and calls `redirect` from `next/navigation`. Find out what `redirect` throws, so `createFactory` can assert on the redirect path.
5. **Spike:** confirm an eve `defineDynamic(...)` result can be called with a hand-built context (`session.auth.initiator.attributes.factoryId`, `memo`, `turn`). Phase 5 depends on this.
6. Add a GitHub Actions workflow:
   - a `postgres:17` service container
   - `npm ci`
   - `prisma migrate deploy`
   - `vitest run`
   - `playwright test`, once Phase 6 lands

## Phase 1: Tenant isolation and the loader

File: `packages/factory/src/db.db.test.ts`

This comes first. A bug here leaks one factory's data into another.

### `loadFactoryConfig` isolation

- Seed factories A and B with same-named skills, tools, and connections.
- `loadFactoryConfig(A)` returns only A's items.
- `loadFactoryConfig(A)` returns only A's tool gates.
- An unknown factory id returns `[]`.

### What it drops

- Tools whose template left the catalog
- Unknown plugin ids
- Unknown services
- MCP URLs that fail the safety check: `http:`, localhost, `.local`, IP literals

### How it resolves

- An empty skill description becomes "Load when relevant."
- An empty agent description becomes "The <name> specialist."
- Tools get their template's description and model when theirs are empty.
- Service connections go in `services`, not `mcps`.
- `allowedTools` is `null` (every tool), `[]` (none), or a list, depending on `restrictTools`.
- `signedInAt` is set only when the credential's `serverUrl` matches the connection's current URL.

### `getFactory`

- The output never includes `encrypted`, tokens, or plugin secret values anywhere. Check the serialized JSON.
- Plugin secrets show up as names only.
- A sign-in for an old URL shows as `signIn: null`.

### `loadToolModel`

- Returns the tool's model override, or the template's default.
- Throws for a tool name that belongs to another factory.

## Phase 2: Save actions

File: `apps/web/app/factories/actions.db.test.ts`

Each test calls the action, then queries the database to confirm the result.

### `createFactory`

- Creates the orchestrator at slot 0 with the default model.
- Creates `web_search` and `web_fetch` tools and attaches them to the orchestrator.
- Creates the web channel.
- Redirects to `/factories/:id`.
- A blank name becomes "Untitled factory".

### `saveAgent`

- Skill, tool, and connection ids from another factory are silently dropped.
- Attachments are replaced, not merged.
- Renaming the orchestrator renames the factory.
- `toolAllow` maps to `restrictTools` and `allowedTools`.
- Unknown plugin ids are filtered out.
- The database rejects slot 4 (check constraint) and a second slot 0 (unique key).

### Saving across factories

- Saving factory A's skill, tool, connection, or agent id through factory B must leave A's row unchanged.
- Today the upsert finds nothing in B, tries to create the row, and fails on the unique id. The test pins this down. See open question 3.

### `saveSkill`

- Names are slugged.
- An empty name becomes `skill`.

### `saveConnection`

- Names are slugged with no `_`.
- Changing the URL deletes the credential.
- `service` can't change after creation.
- A service's URL is always saved as empty.
- An unknown service throws.

### `saveTool`

- The template can't change after creation.
- Reserved names (plugin tool names, `subagent_N`) are rejected.
- Templates without a model never store one.
- Descriptions are cut to 10,000 characters.
- An unknown template throws.

### `saveChannel` and `saveSchedule`

- An unknown channel kind throws.
- A second channel of the same kind in one factory is rejected.
- Schedules save their fields as given.

### `saveFolders`

- Malformed folders are dropped.
- Folder names are cut to 80 characters.

### `deleteItem`

- The orchestrator can't be deleted.
- Deleting a subagent, skill, or tool cascades to its attachment rows.
- Deleting a tool deletes its gate.
- Deleting a connection deletes its `connectionId:*` gates and its credential.
- Deleting an id that belongs to another factory does nothing.

### `savePluginSecret`

- An unknown plugin throws.
- A name the plugin doesn't declare throws.
- An empty value deletes the secret.
- The stored row isn't the plaintext, and decrypts back to it.
- Values over 16,384 characters are rejected.

### `saveToolGate`

- `run: never` with `result: never` deletes the row.
- `result` is only kept for library tools. Plugin and connection tools get `never`.
- An invalid `run` value becomes `never`.
- The criterion is trimmed.

## Phase 3: Sign-in

Files: `packages/factory/src/auth/*.db.test.ts`, `apps/web/app/oauth/oauth.db.test.ts`, and `apps/web/app/factories/connect.db.test.ts`. All use the MSW fake server.

### Discovery

- Follows the 401 `WWW-Authenticate` header to resource metadata, then to authorization-server metadata.
- Falls back to the well-known paths when the header doesn't say.
- Rejects an issuer that doesn't match its metadata.
- Rejects a resource that isn't a prefix of the server URL.
- Rejects endpoints that aren't public https.
- Doesn't follow redirects.

### Client choice

- Picks client-metadata when the server supports it and Foundry is on a public origin.
- Otherwise uses dynamic registration.
- Two sign-ins to the same server call the registration endpoint once, and reuse the cached `RegisteredClient` row.

### The full route flow

- `GET /oauth/start`:
  - redirects to the consent page with PKCE and `state`
  - sets an httpOnly cookie scoped to `/oauth/callback`
- `GET /oauth/callback` with the cookie and a code:
  - stores an encrypted `ConnectionCredential`
  - returns a 200 page that posts the `foundry:sign-in` message
  - clears the cookie

### Callback rejections

Each of these returns 400 and writes no credential row:

- missing cookie
- tampered cookie
- wrong `state`
- attempt older than 10 minutes
- connection URL changed during the sign-in
- `iss` doesn't match the issuer
- the server sent an `error` parameter

### `connectionToken`

- A fresh token is returned without a refresh.
- A URL other than the one that signed in throws `NotSignedInError`.
- Another factory's connection id throws `NotSignedInError`.
- An expired token is refreshed, and a rotated refresh token is saved.
- A server that doesn't rotate keeps the old refresh token.
- `invalid_grant` sets `needsReconnect`, and later calls throw `NotSignedInError`.
- **Concurrency:** two refreshes at once hit the token endpoint once. This proves the row lock works.
- Tokens copied to another connection's row fail to decrypt.

### Google

- Missing `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` gives a clear error.
- A grant missing any requested scope is refused.
- Refresh reads the client secret from env, not from the stored tokens.

### Vercel Connect

- Without an OIDC token, sign-in falls back to Foundry's own client.
- Signing out revokes the Connect grant.
- Deleting the connection revokes the Connect grant.
- A signed-out Connect grant sets `needsReconnect`.

### `listMcpTools`

- Lists tools from a JSON reply and from an SSE reply.
- Sends the token only to the URL that signed in. An unsaved URL edit lists without one.
- Refuses redirects.
- Rejects non-public URLs before any request.

## Phase 4: Unit tests

Pure logic. No network, no database.

### `packages/factory/src/index.ts`

- `isAllowedMcpUrl`, as a list of cases:
  - allows a normal `https://` host
  - rejects `http://`
  - rejects `localhost`, `*.localhost`, `*.local`, `*.internal`
  - rejects IPv4 literals, `[::1]`, and encoded forms like `https://0x7f000001/`
  - rejects unparseable strings
- `toSlug` and `toConnectionSlug`
- `parseFolders`
- `toolGate`
- `effectiveToolSettings`
- `reservedToolNames`

### `packages/factory/src/secrets.ts`

- Encrypt then decrypt returns the original value.
- A different context fails to decrypt.
- Tampered ciphertext fails.
- A key that isn't 32 bytes gives the setup error.
- An unknown format version fails.

### `packages/factory/src/plugins.ts`

- `cliToolSpec`
- `pluginToolNames`
- `pluginOfTool` and `pluginOfSkill`

### Builder helpers

- `schedule.ts`: `toCron` and `fromCron` round-trip every repeat option, and `describeCron` reads them back.
- `builder.ts`: `uniqueName`, `nextLaneY`, `attachedItems`, `parseConnectionToolId`.
- `activity.ts`: `canvasActivity` and `agentTraces`.

### `apps/web/app/oauth/sign-in.ts`

- `signInPage` escapes HTML in error messages.
- It escapes `<` in the script's JSON, so a message can't close the script tag.

### `agent/lib/gates.ts`

- `runPolicy` maps each `run` value to the right eve policy.
- `connectionHasRunGate` only counts that connection's gates.
- `connectionRunPolicy` returns `not-applicable` for other connections' tools.

## Phase 5: Agent runtime

Real database, with a hand-built eve context (see the Phase 0 spike).

### `factoryTools` (`agent/lib/factory.db.test.ts`)

- A factory's agent gets exactly its own library tools, plugin tools, and service tools.
- Service tools are named `<connection>__<tool>` and respect the allow list.
- A gate with `run` set wraps the tool with an approval policy.
- `result: always` swaps in the reviewed workflow tool.
- No `factoryId` in the session returns `null`.

### `factoryConnections`

- `instanceKey` includes the factory id and `signedInAt`.
- An empty allow list hides the connection.
- Only signed-in connections get `auth`.

### `cliTool` (`agent/lib/plugin-tools.db.test.ts`)

Uses a fake `SandboxSession` that records commands. It stands in for a process boundary.

- Programs outside the CLI's allow list are refused.
- `'; rm -rf /'` stays one literal argument.
- Secret values are redacted from stdout and stderr.
- A missing env var throws an error that names it.
- Long output is truncated.

### `channels/eve.ts` `onMessage`

- An unknown factory id throws.
- A known factory id is pinned into the session's auth attributes, and the title is the factory name.

### `agent/lib/google-api.ts`

- Retries once with a fresh token on a 401 (MSW).
- Passes Google's error message through.

## Phase 6: UI tests

A handful of Playwright tests for the builder flows the product depends on. Not exhaustive: each one covers a flow where a break would lose someone's work or misreport what's saved. Each test acts through the UI, then checks the database, like the integration tests.

### Setup

- Use `@playwright/test` with Chromium only, in `apps/web`.
- `apps/web/playwright.config.ts` starts the app with `webServer`:
  - `next build && next start -p 3200` (3123 is taken on this machine)
  - `DATABASE_URL` pointing at `foundry_test`
  - `FOUNDRY_E2E=1`
- Use one worker. Each test truncates the database with the shared `test/seed.ts` helpers, then seeds what it needs.
- **Server-side HTTP:** the builder page fetches the AI Gateway model list and ClawHub on the server, where Playwright can't intercept them. `apps/web/instrumentation.ts` starts the MSW server from `test/` only when `FOUNDRY_E2E=1`, with:
  - a small fixed model list
  - ClawHub failing, so the connector picker shows Foundry's and Connect's services and its error notice
  - the fake OAuth server from Phase 3
- **Browser-side HTTP:** `context.route` stands in for the fake server's consent page and sends the popup straight to `/oauth/callback` with a code.
- **Waiting:** wait for the header to read "Saved", never a fixed timeout. Saves fire 600ms after the last edit.
- **Locators:** use roles and visible text. Where a control has no accessible name (the chip's ×, the section + buttons), add an `aria-label` rather than a test id.
- **Spike:** confirm Playwright's `dragTo` drives the library's HTML5 drag and drop. The rows and cards pass the item through `dataTransfer`, which Chromium supports, but check before writing the attach tests.

### Create a factory (`home.spec.ts`)

- Type a name on the home page and press Create.
- It lands on `/factories/:id`, with the name in the header and on the orchestrator card.
- The orchestrator shows `web_search` and `web_fetch` chips.
- Back on the home page, the factory is in the list.

### Edits autosave and survive a reload (`builder.spec.ts`)

- Edit the orchestrator's instructions and rename it.
- The header goes from "Saving…" to "Saved".
- After a reload, both edits are still there, and the header shows the new name.
- The database has the new instructions and the factory's new name.

### Attach and detach

- Add a skill, then drag it onto the orchestrator card right away. This covers save order: the skill's create has to land before the agent's save attaches it.
- The chip appears, and the skill's "Used by" lists the orchestrator.
- Reload. The chip is still there, and the database has the `AgentSkill` row.
- Click the chip's ×, then reload. The chip and the row are gone.

### Deleting an item detaches it everywhere

- Seed a skill attached to the orchestrator and to a subagent.
- Delete it from the library.
- Both chips disappear without a reload, and stay gone after one.

### Subagents stop at three

- Add subagents until the button reads 3/3 and is disabled.
- Each new card sits in the right-hand lane.
- The database has slots 1, 2, and 3.

### Tool picker and gates

- Add `generate_image` twice from the tool picker. The second is named `generate_image_2`.
- On the first, set "Before it runs" to "Every call".
- Duplicate it. The copy has the same settings and gate.
- Reload. Everything is still there, and the database has two `ToolGate` rows.

### Sign in to a connection (`sign-in.spec.ts`)

- Seed an MCP connection at the fake server's URL.
- Click Sign in. The popup goes through `/oauth/start`, the stubbed consent page, and `/oauth/callback`, then closes.
- The inspector shows the connection signed in without a reload. This proves the BroadcastChannel message arrives.
- Sign out. The status clears, and the credential row is gone.

### A failed save says so

- Make the next save fail: `page.route` aborts the POST that carries the `next-action` header.
- Edit something.
- The header reads "Save failed. Reload to see what was kept."

### Not covered

- The chat. It needs a real model; Phase 7 covers the runtime instead.
- Edits lost when someone leaves within 600ms. That's a known issue, not behavior to pin.
- Plugin secret fields, until a plugin declares env vars.
- Layout, styling, and React Flow sizing.

## Phase 7: Agent evals

Kept small.

### eve evals with `mockModel`

- Seed factories A and B.
- Chat as A. The mock model reports the tool names it was given.
- Assert it sees A's tools and none of B's.
- This is the strongest isolation check, because it goes through the real channel, session, and dynamic files.
- Needs a test-only model switch, and a way to send `x-foundry-factory` from the eval client.

## Open questions

1. Is it OK to skip Supertest and call the Next route handlers and server actions directly?
2. Should database tests run one file at a time (simplest), or get one database per worker (faster later)?
3. Phase 2 will pin down behavior that may be worth fixing:
   - Saving another factory's id fails with a raw unique-key error instead of a clear one.
   - `saveToolGate` accepts any `toolKey`, even one that isn't in the factory.
   - `saveSchedule` doesn't validate cron.

   Fix these, or just record them?
4. Is a test-only model switch in `agent/agent.ts` acceptable for the Phase 7 evals?
5. Is a test hook in app code acceptable for the UI tests? `apps/web/instrumentation.ts` would start MSW only when `FOUNDRY_E2E=1`. The alternative is letting the server reach the real AI Gateway and ClawHub, which makes the tests flaky.
6. The UI tests need `aria-label`s on a few icon-only controls. Is that fine?

## Order of work

1. Phase 0, including both spikes
2. Phase 1
3. Phase 2
4. Phase 4, which can run alongside phases 1 and 2
5. Phase 3
6. Phase 6, which reuses Phase 3's fake OAuth server
7. Phase 5
8. Phase 7
