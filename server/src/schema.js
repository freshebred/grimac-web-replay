const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const validCode = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function validateBundle(b) {
  const fail = m => { throw Object.assign(new Error(`Invalid bundle: ${m}`), { status: 400 }); };
  const str = (v, max = 1024) => typeof v === 'string' && v.length <= max;
  const state=v=>str(v,512)&&/^[a-z0-9_.-]+:[a-z0-9_/.-]+(?:\[[a-z0-9_=,.-]+\])?$/.test(v);
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const number = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 60000000;
  if (!b || b.schemaVersion !== 1 || !str(b.id,36) || !uuid.test(b.id) || !str(b.player?.uuid,36) || !uuid.test(b.player?.uuid) || !str(b.player?.name,64) || !str(b.serverId,128) || !str(b.dimension,128) || !str(b.createdAt,64) || !Number.isFinite(Date.parse(b.createdAt))) fail('identity');
  if (!integer(b.startTick,0,Number.MAX_SAFE_INTEGER) || !integer(b.endTick,b.startTick,b.startTick+72000) || !integer(b.tickRate,1,100)) fail('timeline');
  const tick = v => integer(v,b.startTick,b.endTick);
  for (const key of ['flags','snapshots','blockChanges','frames','entities','warnings']) if (!Array.isArray(b[key])) fail(key);
  if (b.entities.length !== 0 || b.frames.length === 0 || b.frames.length > 72001 || b.blockChanges.length > 500000 || b.snapshots.length > 4096 || b.flags.length > 10000 || b.warnings.length > 1000) fail('collection size');
  let last = -1;
  for (const f of b.frames) { if (!tick(f.tick) || f.tick <= last || ![f.x,f.y,f.z,f.yaw,f.pitch].every(number) || !str(f.pose,64) || typeof f.onGround !== 'boolean') fail('frame'); last=f.tick; }
  let sections=0;last=-1;
  for (const snapshot of b.snapshots) {
    if (!tick(snapshot.tick) || snapshot.tick<last || !Array.isArray(snapshot.chunks) || snapshot.chunks.length>1024) fail('snapshot');
    last=snapshot.tick;
    for (const c of snapshot.chunks) {
      if (!integer(c.x,-2000000,2000000) || !integer(c.z,-2000000,2000000) || !Array.isArray(c.sections) || c.sections.length>128) fail('chunk');
      for (const s of c.sections) {
        if (++sections>2048 || !integer(s.y,-2048,2048) || !Array.isArray(s.palette) || !s.palette.length || s.palette.length>4096 || !s.palette.every(state) || !Array.isArray(s.indices) || s.indices.length!==4096 || !s.indices.every(i=>integer(i,0,s.palette.length-1))) fail('section');
      }
    }
  }
  last=-1;
  for (const c of b.blockChanges) { if (!tick(c.tick) || c.tick<last || ![c.x,c.y,c.z].every(v=>integer(v,-60000000,60000000)) || !state(c.state)) fail('block change'); last=c.tick; }
  for (const f of b.flags) if (!tick(f.tick) || !str(f.check,256) || !number(f.vl) || !str(f.verbose,16384) || (f.logCode!=null&&!validCode(f.logCode))) fail('flag');
  if (!b.warnings.every(w=>str(w,4096))) fail('warnings');
  if (!b.grimLog || (b.grimLog.code!=null&&!validCode(b.grimLog.code)) || (b.grimLog.text!=null&&!str(b.grimLog.text,2000000))) fail('Grim log');
  return b;
}
