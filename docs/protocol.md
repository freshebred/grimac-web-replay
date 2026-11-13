# Replay bundle v1

Gzip-compressed UTF-8 JSON, extension `.grimreplay`, media type `application/octet-stream`. All coordinates in Minecraft world units. Bundle:
```json
{
  "schemaVersion": 1,
  "id": "UUID",
  "serverId": "configurable",
  "createdAt": "ISO8601",
  "player": { "uuid": "UUID", "name": "name" },
  "dimension": "minecraft:overworld",
  "startTick": 0,
  "endTick": 900,
  "tickRate": 20,
  "flags": [{ "tick": 600, "check": "Reach", "vl": 2.5, "verbose": "", "logCode": null }],
  "grimLog": { "code": null, "text": null },
  "snapshots": [{ "tick": 0, "chunks": [{ "x": 0, "z": 0, "sections": [{ "y": 4, "palette": ["minecraft:air", "minecraft:stone"], "indices": [0, 1] }] }] }],
  "blockChanges": [{ "tick": 1, "x": 0, "y": 64, "z": 0, "state": "minecraft:stone" }],
  "frames": [{ "tick": 0, "x": 0, "y": 65, "z": 0, "yaw": 0, "pitch": 0, "pose": "standing", "onGround": true, "swinging": false, "hurt": false, "using": false, "sprinting": false, "mainHand": "minecraft:diamond_sword" }],
  "entities": [
    {
      "id": "UUID",
      "type": "minecraft:player",
      "name": "TargetPlayer",
      "width": 0.6,
      "height": 1.8,
      "frames": [{ "tick": 0, "x": 3.2, "y": 65, "z": 0.5, "yaw": 90, "pitch": 0, "hurt": true }]
    }
  ],
  "events": [
    { "tick": 50, "type": "attack", "targetId": "UUID", "targetName": "TargetPlayer", "distance": 3.42, "x": 3.2, "y": 66.0, "z": 0.5 },
    { "tick": 55, "type": "place", "x": 1, "y": 65, "z": 0, "state": "minecraft:cobblestone" },
    { "tick": 60, "type": "break", "x": 1, "y": 65, "z": 0, "state": "minecraft:cobblestone" },
    { "tick": 62, "type": "interact", "x": 0, "y": 65, "z": 1, "state": "minecraft:oak_door[facing=north,open=true]" },
    { "tick": 65, "type": "hurt", "attackerId": "UUID", "attackerName": "TargetPlayer", "x": 0, "y": 65, "z": 0 }
  ],
  "warnings": []
}
```
Section indices MUST contain 4096 integers, index `(y&15)*256+(z&15)*16+(x&15)`. Section y is `floor(worldY/16)`. Palette entries are canonical blockstate strings `minecraft:oak_stairs[facing=north,...]`. Snapshot tick applies before same-tick changes/frames. Later snapshot replaces its supplied chunk sections. A recorder may supply only initial snapshot plus deltas. Missing regions must be explicit warnings. No claims of exact client perspective. Frames must have strictly increasing tick order. Full-height capture configurable; default vertical radius 32. Nearby entities within `entityRadius` (default 24 blocks) and discrete player interaction events (`attack`, `hurt`, `place`, `break`, `interact`, `use_item`, `swing`) are included when observed on the server thread. Bundles must be self-contained including Grim log text when available. Per-file compressed SHA256 is response metadata (avoid circular hash).

API contract (all UI routes require Discord session):
- `GET /api/me` -> `{user:{id,username,avatar}|null}`; 401 if unauthenticated acceptable.
- `GET /auth/discord`; `GET /auth/discord/callback`; `POST /auth/logout` (Origin checked).
- `GET /api/incidents?search=` -> `{incidents:[{id,playerName,playerUuid,createdAt,expiresAt,bytes,code,check,serverId,videoStatus,videoReady}], storage:{usedBytes,maxBytes}, retentionHours:24}`
- `GET /api/incidents/:id` -> same metadata (including `videoStatus: 'pending'|'rendering'|'ready'|'failed'` and `videoReady: boolean`)
- `GET /api/incidents/:id/bundle` -> gzip bundle download
- `GET /api/incidents/:id/video` -> server-rendered 5-camera 3×3 matrix MP4 (`video/mp4`) when `videoStatus === 'ready'`, or `202 Accepted` `{ready:false,videoStatus,error}` while rendering is still in progress
- `DELETE /api/incidents/:id` -> `{ok:true}` (Origin checked; removes both `.grimreplay` and `.mp4`)
- `GET /api/resolve/:code` -> `{incident:<metadata>|null,log:{code,text}|null}`; only known case codes, no arbitrary proxy
- `POST /api/ingest`, `Authorization: Bearer token`, `Content-Type: application/octet-stream`, raw gzip body -> `{id,duplicate:boolean}`; durable idempotent storage by id/content, rejects conflict, and enqueues background 5-camera MP4 rendering.
- `PATCH /api/incidents/:id/log` `{code,text?}` -> metadata; browser admin or ingest bearer; server may fetch text via configured `GRIM_RAW_URL_TEMPLATE` only if verified operator-configured. Manual supplied text works without upstream.
- `GET /api/settings` -> nonsecret effective config/storage metrics; no web secret editing.

Browser `/:code` resolves published paste code or own incident UUID. `/` is incident list. Local import reads gzip in browser and does not upload. Viewer supports both **Interactive 3D** (section-partitioned face-culled meshes with entity hitboxes, reach raycasts, and block interaction highlights) and **5-Cam Video (3×3)** (North, West, 1st-Person POV at center `2;2`, East, South + 4 telemetry HUD panels).
