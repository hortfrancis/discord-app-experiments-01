import { DiscordSDK } from "@discord/embedded-app-sdk";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const userEl = document.getElementById("user");
const contextEl = document.getElementById("context");
const participantsEl = document.getElementById("participants");
const debugEl = document.getElementById("debug");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// Dump any object into a collapsible <details> block (and the console), so we
// can see the full shape of what Discord returns. Redacts obvious secrets.
function dump(label, data, open = false) {
  console.log(`[discord] ${label}`, data);
  const json = JSON.stringify(data, redactSecrets, 2);
  const details = document.createElement("details");
  details.open = open;
  details.innerHTML = `<summary>${label}</summary><pre>${escapeHtml(json)}</pre>`;
  debugEl.appendChild(details);
}

function redactSecrets(key, value) {
  return /token|secret/i.test(key) && value ? "«redacted»" : value;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
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
    // rpc.activities.write lets us call setActivity() to set Rich Presence.
    // (Adding a scope re-triggers the consent modal once.)
    scope: ["identify", "guilds", "rpc.activities.write"],
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
  setupActions(discordSdk);

  // Raw payloads for exploration.
  dump("authenticate() response", auth, true);
  dump("SDK properties", {
    instanceId: discordSdk.instanceId,
    channelId: discordSdk.channelId,
    guildId: discordSdk.guildId,
    platform: discordSdk.platform,
    sdkVersion: discordSdk.sdkVersion,
    mobileAppVersion: discordSdk.mobileAppVersion,
  });
  dump("Available RPC commands", Object.keys(discordSdk.commands).sort());

  // getPlatformBehaviors needs no scope; getRelationships needs the
  // allowlist-only `relationships.read` scope, so it will usually throw —
  // we dump the error to make that requirement visible.
  await dumpCommand("getPlatformBehaviors()", () =>
    discordSdk.commands.getPlatformBehaviors(),
  );
  await dumpCommand("getRelationships()", () =>
    discordSdk.commands.getRelationships(),
  );
}

// Run a command and dump either its result or the error it threw.
async function dumpCommand(label, fn) {
  try {
    dump(label, await fn());
  } catch (err) {
    dump(`${label} — error`, { message: err.message ?? String(err) });
  }
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
      dump("getChannel() response", channel);
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
    const initial = await discordSdk.commands.getInstanceConnectedParticipants();
    paint(initial);
    dump("getInstanceConnectedParticipants() response", initial);
    // Keep it live as people join/leave the activity.
    discordSdk.subscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", paint);
  } catch {
    participantsEl.innerHTML = "<li class='muted'>Unavailable</li>";
  }
}

// Wire up the interactive buttons. These write to / open things in Discord,
// unlike the read-only get* calls above.
function setupActions(discordSdk) {
  const resultEl = document.getElementById("action-result");
  const setResult = (msg, isError = false) => {
    resultEl.textContent = msg;
    resultEl.classList.toggle("error", isError);
  };

  const run = (label, fn) => async () => {
    setResult(`${label}…`);
    try {
      const res = await fn();
      console.log(`[discord] ${label}`, res);
      setResult(`${label} ✓`);
    } catch (err) {
      console.error(`[discord] ${label} failed`, err);
      setResult(`${label} failed: ${err.message ?? err}`, true);
    }
  };

  // setActivity → Rich Presence on your profile ("Playing my-first-app").
  document.getElementById("btn-activity").addEventListener(
    "click",
    run("setActivity", () =>
      discordSdk.commands.setActivity({
        activity: {
          type: 0, // 0 = Playing
          details: "Experimenting with the Embedded App SDK",
          state: "Poking at the API",
          timestamps: { start: Date.now() }, // shows an elapsed timer
        },
      }),
    ),
  );

  // Clear it again by passing a null activity.
  document.getElementById("btn-clear-activity").addEventListener(
    "click",
    run("clearActivity", () =>
      discordSdk.commands.setActivity({ activity: null }),
    ),
  );

  // openInviteDialog → the native "invite friends" dialog. Needs a guild
  // context and CREATE_INSTANT_INVITE permission, else it throws.
  document.getElementById("btn-invite").addEventListener(
    "click",
    run("openInviteDialog", () => discordSdk.commands.openInviteDialog()),
  );
}

start().catch((err) => {
  console.error(err);
  setStatus(err.message ?? String(err), true);
});
