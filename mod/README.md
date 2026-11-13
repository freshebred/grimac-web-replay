# Fabric recorder

Server-only recorder for **Minecraft 26.3**, **Fabric Loader 0.20.1+**, **Fabric API 0.165.2+26.3**, and **Java 25**. These versions were checked against Fabric's official 26.3 example and metadata. This jar is not compatible with older Minecraft versions. No client mod is needed.

## Build and install

Install a Java 25 **JDK**, then run `./gradlew build` in this directory (on Windows use WSL or install Gradle 9.8.2). The downloadable recorder is `build/libs/grim-replay-bridge-0.1.0.jar`; do not install the `-sources.jar`.

1. Back up your server. Stop it before changing mods.
2. On your Minecraft host (e.g. Exaroton, Pterodactyl, or dedicated server), select the matching Fabric server version and upload the recorder jar and matching Fabric API jar into `mods/`. Keep Grim installed.
3. Start once to create `config/grim-replay/config.json` and `config/grim-replay/web-credential.json`, then stop.
4. Set `apiUrl` to your deployment's HTTPS origin (e.g. `https://replay.example.com`, without `/api/ingest`), and set a unique `serverId`, such as `survival-1`.
5. Set `web-credential.json` to `{"web-token":"YOUR_INGEST_TOKEN"}`. The value must match `INGEST_TOKEN` on the VPS. Never commit or share this file. Discord credentials belong only on the VPS.
6. Start and run `replay status` in console. Uploads use outbound HTTPS; no incoming Minecraft web port is needed.
7. Join as an OP, wait at least 45 seconds, run `/replay save YourName`, and confirm the recording appears in the dashboard. This verifies outbound connectivity from your Minecraft host to your domain.

## Commands

Console commands omit the initial slash. Players require Minecraft's `COMMANDS_GAMEMASTER` permission (normal OP level 2+). Ordinary players cannot use these commands.

| Command | Behavior |
|---|---|
| `/replay` | Lists commands |
| `/replay status` | Active buffers, upload queue, last upload result, hook status, measured last/maximum capture time |
| `/replay start <player>` | Start/retain manual rolling recording, respecting player limit |
| `/replay save <player> [paste-code]` | Queue a snapshot of their current ring and return its incident UUID; optional code associates an existing Grim paste |
| `/replay stop <player> [paste-code]` | Save then stop recording that player for this server session; start or reload resumes |
| `/replay flag <player> <check>` | Schedule incident save after the configured post-window; supports Grim command fallback |
| `/replay retry` | Retry all locally retained pending spool files |
| `/replay reload` | Validate/reload edited config; resets capture buffers and paused-player list |
| `/replay set <key> <value>` | Validate, atomically save, and apply a config setting; resets capture buffers |

Examples: `/replay set maxPlayers 8`, `/replay set sectionsPerTick 4`, `/replay set autoRecord false`, `/replay set apiUrl https://replay.example.org`. `queueCapacity` and `grimEvents` require editing the file and restarting. Secrets are never supplied through commands or printed by status. Changing the credential file takes effect on the next upload attempt; no reload is required. Resetting buffers discards unsaved history, so save important incidents before reloading or setting values.

`save` with a paste code attaches the code, but does not magically recover Grim's log text. After upload, attach the actual text in the dashboard. A download is fully self-contained only for data actually captured/attached. No supported public raw-log route was assumed.

## Automatic Grim integration

The optional adapter uses the verified current public API:

- `GrimAPIProvider.get().getEventBus()`
- `EventBus.get(FlagEvent.class)`
- `FlagEvent.Channel.onFlagSupplier(GrimPlugin, SupplierHandler)`

It observes uncancelled flags, preserves cancellation state, copies bounded metadata, and queues it to the Minecraft thread. It never performs HTTP on a Grim packet thread. Verify `replay status` says **connected (public FlagEvent channel)**. The installed Grim build must expose this API. Compilation and Minecraft startup do not prove compatibility with your particular Grim jar; test an actual flag before relying on automatic evidence. Grim 2.3.75-e457d55 was discussed but its binary was not available for end-to-end verification.

If status says unsupported/missing API, use Grim's supported punishment commands. Add this line to the existing `commands:` list in each relevant group of Grim's `punishments.yml`:

```yaml
- "1:1 replay flag %player% %check_name%"
```

Keep the existing `[log]` line and all existing sanctions. Do not replace the whole file. Threshold `1:1` means every violation. This syntax and placeholders are documented in Grim's official [default punishments](https://github.com/GrimAnticheat/Grim/blob/2.0/common/src/main/resources/punishments/en.yml). Disable `grimEvents` and restart when using the fallback to avoid duplicate flag markers. Reload Grim using its own supported reload command. Repeated flags share the first flag's post-window rather than extend a recording forever.

The public flag event does not supply the later published paste code or the complete stored debug log. After using Grim's `/grim log <local-id>` to obtain the code, attach it and the text in the dashboard. `/<code>` then resolves to that recording. Incident UUID URLs work before linking. Automatically identifying the published paste is not implemented; the adapter does not guess local IDs or scrape private Grim storage.

## Config reference and resource bounds

| Field | Default | Meaning |
|---|---:|---|
| `serverId` | `minecraft-server` | Stable identifier, letters/numbers/underscore/dot/hyphen |
| `apiUrl` | `https://replay.example.com` | HTTPS API origin |
| `enabled` | `true` | Master capture switch |
| `autoRecord` | `true` | Automatically maintain rings for online players, up to player limit |
| `grimEvents` | `true` | Enable optional API hook; restart to change |
| `maxPlayers` | `4` | Simultaneous tracked players; others have no preflag ring |
| `historySeconds` | `45` | Rolling history; default incident targets 30 seconds before +15 after |
| `postSeconds` | `15` | Capture after first flag; must be less than history |
| `verticalRadius` | `32` | Blocks above/below player, rounded to whole 16-block sections |
| `sectionsPerTick` | `4` | Global sampling budget shared fairly across active players |
| `maxSectionVersions` | `1024` | Section history cap per player, maximum 2048 |
| `maxTrackedSections` | `256` | Distinct spatial sections retained per player; must not exceed versions |
| `maxBlockChanges` | `50000` | Sparse mutation cap per player |
| `entityRadius` | `24` | Radius in blocks around the player for sampling nearby entities (4..64) |
| `maxEntities` | `32` | Maximum tracked nearby entities retained per player (1..128) |
| `maxEvents` | `4096` | Maximum discrete interaction/combat events retained per player (128..50000) |
| `queueCapacity` | `4` | Pending compression jobs plus one active worker; restart to change |
| `maxSpoolMiB` | `512` | Local pending-upload disk limit |
| `uploadRetries` | `5` | Retries per file, with bounded exponential backoff |

Each section has 4096 block indices. Four section scans per tick means at most **16,384 block reads per tick**, independent of player count. A stationary player with the default height needs at most 45 sections for a complete 3×3-chunk sweep: about 0.6 seconds for one player or 2.25 seconds for four at 20 TPS. These are operation counts, not measured impact on your exaroton server. 1024 retained versions use approximately 16 MiB of raw index arrays per player, plus palettes, deltas, frames, JVM overhead, and queued incident references. A saved bundle reuses immutable arrays; pruning copies a baseline when needed. Default settings are conservative for a small server, not a performance guarantee.

Capture reads loaded chunks only. It never loads/generates chunks or makes network requests on a game tick. Compression, file writes, and HTTPS happen on one bounded background worker. One upload at a time provides backpressure rather than a request quota. Retries reuse the identical saved bytes, making ingestion idempotent. Failed uploads remain under `config/grim-replay/spool/`; correct the problem and run `replay retry`. Success deletes the local spool file. Pending spool files have a disk cap rather than the VPS's 24-hour retention; remove/export stale failures manually. A full queue rejects new saves visibly; a full spool cannot retain new evidence. In-memory unsaved rings and queued jobs are not crash-durable. A server shutdown or crash can lose them; already written spool files survive and are retried at startup.

After the first snapshot of a section, the recorder captures normal `LevelChunk.setBlockState` mutations, including placed/broken blocks and block-state properties. It retains exact tick order within a tick but does not provide sub-tick timings. It periodically rescans sections to catch differences outside normal mutation paths. Initial terrain is captured at individual section timestamps; it is not an atomic full-world snapshot. Moving into new terrain requires a new baseline. Direct section edits by other mods may bypass the mutation hook, and exhausted history/change limits produce warnings in the bundle. Terrain before its first baseline is unknown.

The recorder captures server-authoritative position, yaw/pitch, pose, grounded state, arm swing, hurt state, item usage, sprinting state, and main-hand item once per server tick, alongside nearby entities within `entityRadius` (up to `maxEntities`) and discrete combat/interaction events (`attack` with eye-to-hitbox reach distance, `hurt`, `place`, `break`, `interact`, `use_item`, `swing`). Tick rate metadata is nominal 20; wall time stretches when the server lags. It does not capture the player's packet-compensated view, client-side predicted positions, full inventories, chat, or resource-pack assets. A server-world replay alone is not proof of cheating. Dimensions are separate recordings; a dimension transition resets the ring and saves pending/manual evidence.

## Verification before production use

1. Keep the player stationary for at least one full sweep, place and break blocks, then move and jump. Save and inspect the downloaded replay around each change.
2. Verify stairs/doors retain state labels; the browser's simplified geometry is not Minecraft's exact renderer.
3. Trigger a genuine Grim check on a controlled test account/server and confirm the hook/command creates an incident containing preflag frames.
4. Stop the VPS briefly, save an incident, verify local spool retention, restore it, and run `replay retry`. Confirm one incident exists.
5. With representative concurrent players, compare Minecraft tick time/TPS with `enabled` on and off. Also inspect `replay status` capture time and JVM memory. Reduce sections/player limits if necessary; do not claim zero impact.
6. Confirm an unprivileged player cannot run `/replay` and a logged-out/nonallowlisted browser cannot retrieve evidence.

Local validation performed: Java compilation, six history/config regression tests, and isolated Minecraft26.3/Fabric startup with the mutation mixin loaded. Production exaroton networking, actual player sessions, and your Grim binary still require the checks above.
