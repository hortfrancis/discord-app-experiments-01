# Discord Activity on Cloudflare Workers

A minimal [Discord Embedded App SDK](https://docs.discord.com/developers/developer-tools/embedded-app-sdk)
activity that authenticates the viewer and reads Discord context (user, guild,
channel, live participants). One Cloudflare Worker serves the built client **and**
handles the OAuth token exchange.

## Architecture

```
Browser (Discord iframe)                Cloudflare Worker
────────────────────────                ─────────────────
src/main.js  ──ready()──►  Discord host
             ──authorize()──►  Discord   → code
             ──POST /api/token {code}──────────►  worker/index.js
                                                   exchanges code + SECRET
             ◄──────────── { access_token } ──────  with discord.com
             ──authenticate(token)──►  Discord  → RPC unlocked
             ──getChannel / participants──►  Discord
```

- `src/` — the client. Vite **bundles** `@discord/embedded-app-sdk` so nothing is
  fetched from a CDN at runtime (Discord's iframe CSP + proxy would block that).
- `worker/index.js` — serves `dist/` via the `ASSETS` binding and handles
  `POST /api/token`. The `client_secret` never reaches the browser.

## Setup

1. **Create the app** in the [Developer Portal](https://discord.com/developers/applications).
   Grab the **Application ID** (public) and an **OAuth2 Client Secret**.
2. **Local env** — copy the examples and fill them in:
   ```bash
   cp .env.example .env            # VITE_DISCORD_CLIENT_ID (build-time, public)
   cp .dev.vars.example .dev.vars  # DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET
   ```
3. **Install**: `npm install`

## Develop

```bash
npm run build     # build the client into dist/
npm run preview   # wrangler dev — serves dist/ + the Worker at :8787
# or, for hot-reload of the client only:
npm run dev       # vite dev server (no /api/token — use preview for full flow)
```

To test inside Discord, expose your local server with a tunnel (e.g.
`cloudflared tunnel --url http://localhost:8787`) and set that HTTPS URL as the
activity's **URL Mapping** (root `/`) in the Developer Portal.

## Deploy

```bash
npx wrangler secret put DISCORD_CLIENT_SECRET   # one-time
# set DISCORD_CLIENT_ID in wrangler.jsonc "vars" (public app id)
npm run deploy                                  # vite build && wrangler deploy
```

Then point the activity's URL Mapping at your `*.workers.dev` URL.

## Extending

`commands.authenticate()` unlocks the RPC surface. From `src/main.js` you can add
`getChannel`, `getInstanceConnectedParticipants`, activity state, layout mode,
and more — see the SDK docs. Add OAuth scopes in the `authorize()` call and keep
the same set in the token exchange.
