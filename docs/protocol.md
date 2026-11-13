# Replay bundle v1

Gzip-compressed UTF-8 JSON, extension `.grimreplay`, media type application/octet-stream. All coordinates in Minecraft world units. Bundle:
```
{ "schemaVersion":1, "id":"UUID", "serverId":"configurable", "createdAt":"ISO8601", "player":{"uuid":"UUID","name":"name"}, "dimension":"minecraft:overworld", "startTick":0, "endTick":900, "tickRate":20,
 "flags":[{"tick":600,"check":"manual","vl":0,"verbose":"","logCode":null}],
 "grimLog":{"code":null,"text":null},
 "snapshots":[{"tick":0,"chunks":[{"x":0,"z":0,"sections":[{"y":4,"palette":["minecraft:air","minecraft:stone"],"indices":[0,1]}]}]}],
 "blockChanges":[{"tick":1,"x":0,"y":64,"z":0,"state":"minecraft:stone"}],
 "frames":[{"tick":0,"x":0,"y":65,"z":0,"yaw":0,"pitch":0,"pose":"standing","onGround":true}],
 "entities":[], "warnings":[] }
```
Section indices MUST contain 4096 integers, index `(y&15)*256+(z&15)*16+(x&15)`. Section y is floor(worldY/16). Palette entries are canonical blockstate strings `minecraft:oak_stairs[facing=north,...]`. Snapshot tick applies before same-tick changes/frames. Later snapshot replaces its supplied chunk sections. A recorder may supply only initial snapshot plus deltas. Missing regions must be explicit warnings. No claims of exact client perspective. Frames must have strictly increasing tick order. Full-height capture configurable; default vertical radius 32. Version 1 entities may be empty with warning. Bundles must be self contained including Grim log text when available. Per-file compressed SHA256 is response metadata (avoid circular hash).

API contract (all UI routes require Discord session):
- GET /api/me -> {user:{id,username,avatar}|null}; 401 if unauthenticated acceptable.
- GET /auth/discord; GET /auth/discord/callback; POST /auth/logout (Origin checked).
- GET /api/incidents?search= -> {incidents:[{id,playerName,playerUuid,createdAt,expiresAt,bytes,code,check,serverId}], storage:{usedBytes,maxBytes}, retentionHours:24}
- GET /api/incidents/:id -> same metadata
- GET /api/incidents/:id/bundle -> gzip bundle download
- DELETE /api/incidents/:id -> {ok:true} (Origin checked)
- GET /api/resolve/:code -> {incident:<metadata>|null,log:{code,text}|null}; only known case codes, no arbitrary proxy
- POST /api/ingest, Authorization: Bearer token, Content-Type application/octet-stream, raw gzip body -> {id,duplicate:boolean}; durable idempotent storage by id/content, rejects conflict.
- PATCH /api/incidents/:id/log {code,text?} -> metadata; browser admin or ingest bearer; server may fetch text via configured GRIM_RAW_URL_TEMPLATE only if verified operator-configured. Manual supplied text works without upstream.
- GET /api/settings -> nonsecret effective config/storage metrics; no web secret editing.

Browser /:code resolves published paste code or own incident UUID. / is incident list. Local import reads gzip in browser and does not upload. Rendering generic state-aware blocks with explicit fallback warning is acceptable initial version; no copyrighted game assets bundled.
