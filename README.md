(Yes this app is vibe-coded, don't disintegrate me. This only work when paired with the [jar mod found here](https://github.com/freshebred/grimac-web-replay-jar))
# Grim Replay

Self-hosted 3D incident capture and replay system for Fabric Minecraft servers running GrimAC.

The system consists of two parts that run independently and communicate over HTTPS:

1. **The Web Dashboard & API (`server/` + `web/`)** — Hosted on your VPS. Receives compressed recordings from your Minecraft server, enforces Discord OAuth2 sign-in with an admin allowlist, expires online recordings after 24 hours, and renders interactive 3D replays in the browser.
2. **The Fabric Server Mod (`mod/`)** — Installed in your Minecraft server's `mods/` folder (works on Exaroton, Pterodactyl, or any dedicated Fabric host). Maintains a bounded rolling buffer of nearby chunks, block changes, and player movement, and uploads incident bundles to your VPS when Grim flags a player or an admin triggers a save.

---

## Architecture & Capabilities

- **3×3 Chunk Rolling Capture + Nearby Entities & Actions:** Records loaded-world block states (including stair directions, slabs, doors), server-side player movement/rotation/poses/held items, nearby entities within a configurable radius (`entityRadius`, default 24 blocks), and discrete combat/interaction events (entity hits with exact reach distance in blocks, damage/hurt states, arm swings, block placements, block breaks, and block/item interactions).
- **Dual Playback Modes (Server-Rendered 5-Camera 3×3 MP4 + Fast Interactive 3D):**
  - **5-Cam Video (3×3 Matrix):** Upon ingestion, the VPS renders a synchronized 3×3 composite MP4 in the background featuring **1st-Person POV** in the center (`2;2`), elevated 3rd-person cameras from **North**, **West**, **East**, and **South** around it, and 4 live telemetry HUD panels in the corners. If a moderator opens an incident before encoding completes, the UI notifies them and displays a live 5-camera 3×3 preview until the MP4 is ready.
  - **Interactive 3D Mode:** Uses incremental 16×16×16 chunk-section meshes with hidden-face culling so block changes and timeline scrubbing run smoothly without rebuilding the entire world. Renders suspect and target hitboxes, hurt flashes, arm swings, reach raycast lines, and block interaction highlights.
- **Discord Allowlist Authentication:** Only Discord user IDs listed in `DISCORD_ALLOWED_IDS` can view incidents, attach logs, stream videos, or download bundles.
- **24-Hour Online Retention + Offline Archive:** Accepted recordings (and their rendered MP4 videos) automatically expire after 24 hours. Admins can download self-contained `.grimreplay` files (which embed the 3D world recording, entities, actions, and any attached Grim log text) and drag-and-drop them back into the dashboard anytime in the future without re-uploading them to the VPS.
- **Fidelity Scope:** Captures server-authoritative world state, nearby entities, and server-observed interactions. It does not reconstruct incidents prior to mod installation, does not represent a lagging client's unacknowledged packet view, and uses simplified generic block geometry rather than Mojang assets.

## Project Layout

| Path | Purpose |
| --- | --- |
| `mod/` | Fabric server recorder mod (`grim-replay-bridge`) and `/replay` commands |
| `server/` | Node.js API, Discord OAuth2, SQLite index, and disk storage |
| `web/` | Browser dashboard and Three.js 3D replay viewer |
| `docs/protocol.md` | `.grimreplay` v1 format specification and HTTP API contract |
| `docs/operations.md` | Day-to-day administration, token rotation, and backup guide |
| `.env.example` | Template for all VPS environment variables |
| `compose.yaml`, `Dockerfile`, `deploy/Caddyfile` | Production Docker Compose + automatic HTTPS via Caddy |

---

## Part 1: Install the Web Dashboard & API on Your VPS

### 1. Prerequisites & DNS

1. Use a Linux VPS with **Docker** and **Docker Compose** installed (or Node.js 22.13+ for manual non-Docker deployment).
2. Point a DNS `A` record (for example, `replay.example.com`) to your VPS IPv4 address.
3. Ensure inbound TCP ports `80` and `443` are open in your firewall so Caddy can obtain and renew TLS certificates automatically.

### 2. Create a Discord OAuth2 Application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. Go to **OAuth2** in the left sidebar:
   - Copy the **Client ID** (`DISCORD_CLIENT_ID`).
   - Reset/copy the **Client Secret** (`DISCORD_CLIENT_SECRET`).
   - Under **Redirects**, add your exact callback URL:
     ```text
     https://replay.example.com/auth/discord/callback
     ```
     *(Replace `replay.example.com` with your actual domain).*
3. Find the numeric **Discord User IDs** (17–20 digits) of the admins who should have access. Enable **Developer Mode** in Discord (*User Settings → Advanced → Developer Mode*), right-click a user profile, and click **Copy User ID**.

### 3. Configure `.env` on the VPS

Clone this repository onto your VPS and create your `.env` file:

```sh
git clone https://github.com/freshebred/grimac-web-replay.git
cd grimac-web-replay
cp .env.example .env
chmod 600 .env
```

Generate a random 32-byte `INGEST_TOKEN`:

```sh
node scripts/generate-secrets.mjs
# Or: openssl rand -hex 32
```

Open `.env` and fill in your domain, Discord credentials, allowed Discord user IDs, and the generated `INGEST_TOKEN`:

```dotenv
PUBLIC_URL=https://replay.example.com
SITE_HOST=replay.example.com

DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_ALLOWED_IDS=100000000000000001,100000000000000002

INGEST_TOKEN=your_generated_64_char_hex_token
```

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_URL` | *(required)* | Full HTTPS origin used for OAuth redirects and CSRF origin checks |
| `SITE_HOST` | *(required)* | Hostname used by Caddy to provision HTTPS certificates |
| `DISCORD_CLIENT_ID` | *(required)* | Discord OAuth2 Application Client ID |
| `DISCORD_CLIENT_SECRET` | *(required)* | Discord OAuth2 Application Client Secret |
| `DISCORD_ALLOWED_IDS` | *(required)* | Comma-separated numeric Discord user IDs allowed to sign in |
| `INGEST_TOKEN` | *(required)* | Shared secret (32+ chars) used by the Fabric mod to upload recordings |
| `RETENTION_HOURS` | `24` | Hours before uploaded recordings expire from the VPS |
| `SESSION_HOURS` | `12` | Browser login session lifetime in hours |
| `MAX_STORAGE_BYTES` | `21474836480` | Maximum disk space for active recordings (default 20 GiB) |
| `MAX_UPLOAD_BYTES` | `33554432` | Maximum compressed `.grimreplay` upload size (default 32 MiB) |
| `MAX_EXPANDED_BYTES` | `134217728` | Maximum uncompressed JSON size (default 128 MiB) |
| `GRIM_RAW_URL_TEMPLATE` | *(empty)* | Optional verified HTTPS raw-paste endpoint containing `{code}` |

### 4. Start the Web Service

```sh
docker compose up -d --build
docker compose logs -f app caddy
```

- Open `https://replay.example.com` in your browser and sign in with Discord.
- Whenever you edit `.env` later (for example, to add or remove a Discord user ID), apply the changes by recreating the container:
  ```sh
  docker compose up -d --force-recreate app
  ```

---

## Part 2: Install the Fabric Mod on Your Minecraft Server

The recorder mod targets **Minecraft 26.3**, **Fabric Loader 0.20.1+**, **Fabric API 0.165.2+26.3**, and **Java 25**. It is a **server-side only** mod—players do not need to install anything on their clients.

### 1. Build or Download the Mod JAR

To build from source (requires JDK 25):

```sh
cd mod
./gradlew build
```

The compiled mod JAR will be located at:
```text
mod/build/libs/grim-replay-bridge-0.1.0.jar
```
*(Use `grim-replay-bridge-0.1.0.jar`, not the `-sources.jar`. You can also download the pre-built artifact from the repository's GitHub Actions tab).*

### 2. Upload and Configure on Your Minecraft Host

1. Stop your Minecraft server.
2. Upload `grim-replay-bridge-0.1.0.jar` and the matching **Fabric API** JAR into your server's `mods/` directory (alongside GrimAC).
3. Start the server once so it generates its configuration directory (`config/grim-replay/`), then stop it (or edit while running and use `/replay reload`).
4. Open `config/grim-replay/web-credential.json` and paste the exact same `INGEST_TOKEN` from your VPS `.env`:
   ```json
   {"web-token":"PASTE_THE_SAME_INGEST_TOKEN_FROM_THE_VPS"}
   ```
5. Open `config/grim-replay/config.json` and set `apiUrl` to your VPS base URL (do **not** append `/api/ingest`; the mod adds that automatically) and choose a `serverId`:
   ```json
   {
     "serverId": "survival-1",
     "apiUrl": "https://replay.example.com",
     "enabled": true,
     "autoRecord": true,
     "grimEvents": true
   }
   ```
   *(Alternatively, run `replay set apiUrl https://replay.example.com` and `replay set serverId survival-1` directly in the server console).*
6. Start the server (or run `replay reload` in the console) and check `replay status`.

---

## Part 3: Admin Commands & GrimAC Integration

### In-Game OP & Console Commands

All commands require OP permission level 2+ (`COMMANDS_GAMEMASTER`) or the server console (omit the leading `/` in console):

| Command | Description |
| --- | --- |
| `/replay status` | Shows tracked player buffers, upload queue size, last/max tick capture time (ms), Grim hook state, and last upload result |
| `/replay start <player>` | Starts/retains manual rolling capture for a player |
| `/replay save <player> [paste-code]` | Immediately snapshots and uploads the player's current rolling buffer (optionally linking a Grim paste code) |
| `/replay stop <player> [paste-code]` | Saves the current buffer and pauses recording for that player for the current session |
| `/replay flag <player> <check>` | Triggers a flag capture (records for `postSeconds` more seconds, then uploads) |
| `/replay set <key> <value>` | Updates and saves a setting in `config.json` (e.g. `/replay set maxPlayers 8`, `/replay set sectionsPerTick 4`) |
| `/replay reload` | Reloads `config/grim-replay/config.json` from disk |
| `/replay retry` | Retries uploading any failed `.grimreplay` bundles stored in `config/grim-replay/spool/` |

### Automatic GrimAC Flag Capture

By default (`"grimEvents": true`), the mod automatically attaches to GrimAC's public `FlagEvent` channel on startup. Run `replay status` in console to confirm it reports:
```text
Grim=connected (public FlagEvent channel)
```
When Grim flags a player, the mod preserves the preceding rolling buffer (default 30s) and continues recording for `postSeconds` (default 15s) before compressing and uploading the incident.

**Fallback via Grim `punishments.yml`:** If your build of Grim does not expose the public event API, set `"grimEvents": false` in `config/grim-replay/config.json` and add the following command to your check groups in Grim's `punishments.yml`:
```yaml
commands:
  - "1:1 replay flag %player% %check_name%"
```

### Linking Grim Paste Codes (`/<paste-code>`)

Grim's internal violation number (e.g. `/grim log 186`) is local to the game server until uploaded to `paste.grim.ac/<paste-code>`.
- You can pass a paste code when saving in-game (`/replay save <player> <paste-code>`), or attach the paste code and raw log text to any incident directly inside the web dashboard.
- Once linked, visiting `https://replay.example.com/<paste-code>` (or `https://replay.example.com/<incident-uuid>`) opens that 3D replay directly.

---

## Part 4: Manual Deployment Without Docker

If you already run Nginx/Caddy on your VPS and prefer running the Node service directly on the host:

1. Install **Node.js 22.13+** (required for the built-in `node:sqlite` module).
2. Configure `.env` in the repository root (`HOST=127.0.0.1`, `PORT=3000`).
3. Build and start:
   ```sh
   npm run setup
   npm test
   npm run build
   npm start
   ```
4. Reverse-proxy your HTTPS domain to `http://127.0.0.1:3000`.

---

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Discord OAuth says `Invalid Redirect URI` | Ensure `PUBLIC_URL` in `.env` matches your domain and `https://<your-domain>/auth/discord/callback` is saved in the Discord Developer Portal |
| Signed-in Discord user gets `403 Access Denied` | Ensure their numeric 17–20 digit Discord user ID is in `DISCORD_ALLOWED_IDS`, then run `docker compose up -d --force-recreate app` |
| Mod status shows `Upload HTTP 401` | Ensure `web-token` in `config/grim-replay/web-credential.json` matches `INGEST_TOKEN` in your VPS `.env` |
| Mod status shows `Upload HTTP 413` | Bundle exceeds `MAX_UPLOAD_BYTES`; lower `verticalRadius` or `historySeconds`, or increase `MAX_UPLOAD_BYTES` |
| Mod status shows `Upload HTTP 507` | VPS storage limit (`MAX_STORAGE_BYTES`) reached; delete old incidents or raise the limit in `.env` |
| Missing terrain in viewer | Only chunks that were loaded on the server and sampled within the rolling window are included; inspect bundle warnings in the viewer |

## License

GNU General Public License v3.0 (see [`LICENSE`](LICENSE)). No Mojang assets, game binaries, or proprietary GrimAC internals are bundled.
