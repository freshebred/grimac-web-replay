# Verification record

Validation is recorded here as work completes. Test fixtures are synthetic; no real player evidence or production credentials are used.

## Passed locally

- API tests: authenticated ingestion, strict bundle validation, idempotence, conflicting IDs, origin protection, self-contained log attachment, expiry before cleanup, disk capacity rejection, gzip expansion bounds, OAuth state/PKCE/replay prevention and allowlist enforcement.
- Browser logic tests: gzip decoding, schema/palette bounds, chronological state reconstruction, negative chunks, block changes/rewind, same-tick ordering, state-aware basic shapes, frame seeking, terrain-memory bound.
- Cross-component integration: generated fixture → actual HTTP ingestion → session-authenticated log attachment → download → browser decoder → forward/rewind world state.
- Fabric recorder tests & build: Java 25 compilation (`grim-replay-bridge-0.1.0.jar`), 6 JUnit regression tests (`RecordingTest`), and isolated Minecraft 26.3 / Fabric Loader startup with the block-mutation mixin loaded.
- Browser UI QA: verified at 1440×900 and 390×844 viewports (`web/qa/REPORT.md`, `web/qa/browser-results.json`), including WebGL rendering, local `.grimreplay` file import, timeline scrubbing, ±1 tick stepping, flag jump, and camera controls.

## Requires your deployment

- Real Discord authorization using your application credentials.
- DNS, HTTPS certificate issuance, and VPS deployment. Docker is not installed in the build environment; container startup has not been exercised here.
- exaroton outbound HTTPS and an actual Minecraft capture/upload.
- Gameplay performance at your player count and mod mix.
- Live Grim paste raw download endpoint. It is intentionally operator-configured rather than guessed.

Passing automated tests does not verify these external behaviors. See the recorder README for exact capture coverage and compatibility, and web/DESIGN.md for dashboard/browser verification.
