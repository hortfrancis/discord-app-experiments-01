import { DiscordSDK } from "@discord/embedded-app-sdk";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const userEl = document.getElementById("user");
const contextEl = document.getElementById("context");
const participantsEl = document.getElementById("participants");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

async function start() {
  if (!CLIENT_ID) {
    setStatus("Missing VITE_DISCORD_CLIENT_ID at build time.", true);
    return;
  }

  const discordSdk = new DiscordSDK(CLIENT_ID);

  // 1. Wait for the Discord host to hand us the RPC bridge.
  setStatus("Waiting for Discord…");
  await discordSdk.ready();

  // 2. Ask the user to authorize the OAuth scopes we need.
  setStatus("Authorizing…");
  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds"],
  });

  // 3. Exchange the code for an access token on our Worker (needs the secret).
  setStatus("Exchanging token…");
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} — ${body}`);
  }
  const { access_token } = await res.json();

  // 4. Authenticate the SDK with the token — now RPC commands are unlocked.
  setStatus("Authenticating…");
  const auth = await discordSdk.commands.authenticate({ access_token });

  outputEl.hidden = false;
  setStatus("Connected ✓");

  renderUser(auth.user);
  await renderContext(discordSdk);
  await renderParticipants(discordSdk);
}

function renderUser(user) {
  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : "https://cdn.discordapp.com/embed/avatars/0.png";
  userEl.innerHTML = `
    <img class="avatar" src="${avatar}" alt="" width="48" height="48" />
    <div>
      <strong>${user.global_name ?? user.username}</strong>
      <div class="muted">${user.id}</div>
    </div>`;
}

async function renderContext(discordSdk) {
  const rows = [
    ["Guild", discordSdk.guildId ?? "—"],
    ["Channel", discordSdk.channelId ?? "—"],
    ["Instance", discordSdk.instanceId ?? "—"],
  ];

  // Channel details require the channel scope; degrade gracefully if denied.
  if (discordSdk.channelId) {
    try {
      const channel = await discordSdk.commands.getChannel({
        channel_id: discordSdk.channelId,
      });
      rows.push(["Channel name", channel.name ?? "—"]);
    } catch {
      /* channel scope not granted — that's fine */
    }
  }

  contextEl.innerHTML = rows
    .map(([k, v]) => `<div><span class="muted">${k}</span> ${v}</div>`)
    .join("");
}

async function renderParticipants(discordSdk) {
  const paint = ({ participants }) => {
    participantsEl.innerHTML = participants
      .map((p) => `<li>${p.global_name ?? p.username}</li>`)
      .join("");
  };

  try {
    paint(await discordSdk.commands.getInstanceConnectedParticipants());
    // Keep it live as people join/leave the activity.
    discordSdk.subscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", paint);
  } catch {
    participantsEl.innerHTML = "<li class='muted'>Unavailable</li>";
  }
}

start().catch((err) => {
  console.error(err);
  setStatus(err.message ?? String(err), true);
});
