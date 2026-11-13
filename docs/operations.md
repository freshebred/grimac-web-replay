# Operations

## Daily checks

- Open dashboard Settings to check configured retention/capacity and storage usage (which accounts for both compressed `.grimreplay` bundles and rendered 5-camera `.mp4` videos).
- Use Minecraft's `replay status` in console to check capture and upload state.
- Inspect `docker compose logs --since=1h app` for ingestion/storage errors.
- Monitor actual disk free space as well as the logical evidence limit. OS files, SQLite journals, and atomic replacement files need headroom beyond `MAX_STORAGE_BYTES`.

## Change admin access

Edit `DISCORD_ALLOWED_IDS` in `.env`, then run `docker compose up -d --force-recreate app`. IDs are checked on every authenticated request against the running configuration. Removing an ID revokes its access after recreation, even if its browser still holds a session cookie.

## Rotate the ingestion token

Generate a fresh token. Replace `INGEST_TOKEN` in the VPS `.env` and `web-token` in the Minecraft recorder's credential JSON. Recreate the API container and reload the recorder as documented. Expect uploads during the transition to fail authentication and remain pending; retry the spool after both ends agree. Never enter tokens into in-game commands.

## Change domain

Change DNS, `PUBLIC_URL`, `SITE_HOST`, the Discord registered redirect URI, and the recorder's `apiUrl` base origin. Recreate Caddy and app. Browser sessions from the previous origin are not portable; sign in again. Old saved replay files remain usable.

## Retention changes

Retention is assigned to each accepted incident. Updating `RETENTION_HOURS` affects newly accepted incidents; existing expiry times do not get rewritten. Downloading does not pin or extend a case. Download first, then delete explicitly if needed.

## Backups

For a consistent application backup, stop the API and back up its data volume, including `index.sqlite` and recording files. Restart afterward. Treat backups as separate retained copies: the app's 24-hour cleanup does not delete backups, filesystem snapshots, browser downloads, or copies held by admins. Protect and expire those separately.

## Full storage or upload outage

Uploads are serialized with `503 Retry-After` backpressure while another recording mutation is in progress. Capacity exhaustion returns `507`. There is no requests-per-minute upload quota. Recording uploads must not block the Minecraft tick thread. Spool/queue capacity is finite; check the recorder status and logs when retries cannot proceed. The dashboard showing an incident means the VPS accepted it; a queued ID in Minecraft is not yet proof of acceptance.

## Updates

Read the changelog and back up configuration. Rebuild with `docker compose up -d --build`. Build the recorder for the exact target Minecraft version; do not assume a JAR works across game releases. Stop Minecraft before replacing the JAR. After each update run a small manual capture and download/open test.

## Performance acceptance

Start with one player, a bounded vertical capture range, and the default upload queue. Compare server tick timings and memory with recording disabled/enabled over the same representative workload. Include block-heavy activity, multiple players in separate chunks, chunk transitions, and an unavailable API. Record CPU, memory, maximum capture time, queued/spooled evidence, and disk growth. Increase limits only with observed headroom. Do not treat a zero-error startup as a performance benchmark.
