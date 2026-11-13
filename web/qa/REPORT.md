# Dashboard verification

GATE: FAIL 26 (round 1 of 3)

The requested taste skill was installed and used: first palette forest-pale-lime; first typography Chivo/Chivo Mono, locally hosted. The implementation follows one spacing/control system, equal outer edges, accessible input labels, 44px controls, visible focus, reduced motion, minimal copy and real evidence only. No assumed business facts, external photographs or demo records in production.

The finish gate is a **marketing-page checker**. Its open findings (hero-fill, hero-screen, section-height, one-section, moment-none, CTA, copy-headline, copy-actions, text-only, container/.wrap/container-edges, off-grid, flush, run-on) demand a full-screen marketing hero, sales headline, final CTA, decorative moment, prescribed wide gutters and section layout. These conflict with the user's explicit functional admin dashboard and minimal decorative text request. The working viewer therefore keeps a compact incident header, world canvas, transport and inspector. No kit files were changed and no findings were hidden. No formal waivers applied.

The shader-lint finding is a false positive on Three.js's standard preprocessor chunk `#include <common>`: it is not a GLSL variable declaration. The gate's forced shader rejection also produces gl-fallback. The real renderer renders correctly in Chrome; actual constructor/shader failure displays a readable unavailable state with log/download access, rather than an invented world still. GPU shader failure reporting was explicitly added after the gate review.

## Passed

- `npm run build`: production build succeeds; Three.js is lazy-loaded when opening a replay.
- `npm test`: eight tests pass: gzip/schema, invalid palette and finite coordinates, negative chunks/deltas/rewind, same-tick snapshot ordering, principal slab/stair/door state, observed-frame lookup, ordering/schema rejection, bounded live terrain allocation.
- Browser QA through the skill's own `shoot.mjs`, localhost-only synthetic fixture. `browser-results.json`: local `.grimreplay` import renders WebGL, ±1 tick, timeline forward/rewind, flag seek, follow/reset, play/pause, local file has no remote delete. The harness is outside the production app and is never a production auth bypass.
- Visually inspected screenshots at 1440×900 and 390×844: terrain, stairs and outlined player are drawn; controls and inspector remain usable; phone layout stacks without horizontal overflow.
- `shots/replay-1440.png`, `shots/replay-390.png`, `shots/local-controls-1440.png` are synthetic QA only.

## Limits and remaining live checks

- Real Discord OAuth requires the operator's registered application; real Grim logs, exaroton uploads, game performance and custom/modded world blocks require deployment testing.
- Generic geometry is approximate; stair corners, connected fence/wall shapes, fluid levels, custom block models and entity playback are not exact/supported. The UI states this. Player outline is not a collision verdict.
- Local imports are decoded entirely in a worker, capped at 32 MiB compressed / 128 MiB expanded; 2,048 total sections, 72,001 frames, 500,000 block changes; 1 million live occupied blocks and 200,000 displayed geometry parts. Over-limit worlds report a visible limit; display truncation warns.
- No capture benchmark or full GPU performance certification is claimed. The marketing gate failed for the reasons above. Intermediate tablet widths and formal perf.mjs were not separately certified.

## Reproduce browser QA

From repository root, `npm --prefix web run build`, then `node web/qa/serve-fixture.mjs` (binds only 127.0.0.1:4179). Use the installed skill's `scripts/shoot.mjs --url http://127.0.0.1:4179/fixture --w 1440 --out web/qa/shots/replay-1440.png --no-tiles --wait 2000`.

To exercise controls, use `--url 'http://127.0.0.1:4179/?exercise=1' --wait 3000`; results are written to `web/qa/browser-results.json`. Stop the fixture server after testing. It uses synthetic data only, and the application build never includes the QA directory.
