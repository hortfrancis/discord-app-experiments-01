// Cloudflare Worker: serves the built client (via the ASSETS binding) and
// handles the one thing the browser can't do safely — the OAuth token
// exchange, which needs DISCORD_CLIENT_SECRET.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/token" && request.method === "POST") {
      return handleToken(request, env);
    }

    // Everything else is a static asset from ./dist.
    return env.ASSETS.fetch(request);
  },
};

async function handleToken(request, env) {
  let code;
  try {
    ({ code } = await request.json());
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!code) return json({ error: "missing_code" }, 400);

  const resp = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    // Shows up in `wrangler tail`. Common causes: empty client_id, wrong/missing
    // client_secret (→ invalid_client), or a stale/reused code (→ invalid_grant).
    console.error("Discord token exchange failed", resp.status, detail);
    return json({ error: "token_exchange_failed", status: resp.status, detail }, 502);
  }

  // Only hand the client what it needs — never the refresh token or secret.
  const { access_token } = await resp.json();
  return json({ access_token });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
