export const MAX_COMPRESSED = 32 * 1024 * 1024;
export const MAX_EXPANDED = 128 * 1024 * 1024;
const fail = (m) => { throw new Error(`Invalid replay: ${m}`); };
const num = (v, name, max=60_000_000) => { if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v)>max) fail(name); };
const integer = (v,n,max) => {num(v,n,max);if(!Number.isSafeInteger(v))fail(n);};
const str = (v,n,max=4096) => {if(typeof v!=='string'||v.length>max)fail(n);};
const arr = (v,n,max) => {if(!Array.isArray(v)||v.length>max)fail(n);};
const state = (v) => { str(v,'block state',512);if(!/^[a-z0-9_.-]+:[a-z0-9_/.-]+(?:\[[a-z0-9_=,.-]+\])?$/.test(v))fail('block state syntax'); };
export function validateBundle(b) {
 if(!b || b.schemaVersion!==1)fail('unsupported schema version');
 str(b.id,'id',128);str(b.serverId,'serverId',128);str(b.createdAt,'createdAt',64);str(b.dimension,'dimension',128);
 if(!b.player)fail('player');str(b.player.name,'player name',64);str(b.player.uuid,'player uuid',64);
 integer(b.startTick,'startTick',Number.MAX_SAFE_INTEGER);integer(b.endTick,'endTick',Number.MAX_SAFE_INTEGER);
 if(b.endTick<b.startTick||b.endTick-b.startTick>72000)fail('tick range');
 num(b.tickRate,'tickRate',100);if(b.tickRate<=0)fail('tickRate');
 const tick=v=>{integer(v,'tick',Number.MAX_SAFE_INTEGER);if(v<b.startTick||v>b.endTick)fail('tick outside range');};
 arr(b.frames,'frames',72001);let prev=-Infinity;
 for(const f of b.frames){tick(f.tick);if(f.tick<=prev)fail('frames must be strictly ordered');prev=f.tick;for(const p of ['x','y','z','yaw','pitch'])num(f[p],p);if(f.pose!==undefined)str(f.pose,'pose',64);}
 if(!b.frames.length)fail('no movement frames');
 arr(b.snapshots,'snapshots',4096);let sections=0;prev=-Infinity;
 for(const s of b.snapshots){tick(s.tick);if(s.tick<prev)fail('snapshot order');prev=s.tick;arr(s.chunks,'chunks',1024);for(const c of s.chunks){integer(c.x,'chunk x',4000000);integer(c.z,'chunk z',4000000);arr(c.sections,'sections',128);for(const sec of c.sections){if(++sections>2048)fail('too many sections');integer(sec.y,'section y',4096);arr(sec.palette,'palette',4096);sec.palette.forEach(state);arr(sec.indices,'indices',4096);if(sec.indices.length!==4096)fail('section must have 4096 indices');for(const i of sec.indices){if(!Number.isInteger(i)||i<0||i>=sec.palette.length)fail('palette index');}}}}
 arr(b.blockChanges,'blockChanges',500000);prev=-Infinity;for(const c of b.blockChanges){tick(c.tick);if(c.tick<prev)fail('block change order');prev=c.tick;for(const p of ['x','y','z'])integer(c[p],p);state(c.state);}
 arr(b.flags,'flags',10000);for(const f of b.flags){tick(f.tick);str(f.check,'check',256);if(f.verbose!=null)str(f.verbose,'verbose',16384);if(f.logCode!=null)str(f.logCode,'logCode',128);}
 arr(b.warnings??=[],'warnings',1000);b.warnings.forEach(v=>str(v,'warning',4096));
 arr(b.entities??=[],'entities',200000);
 if(b.grimLog!=null){if(b.grimLog.text!=null)str(b.grimLog.text,'Grim log',2_000_000);if(b.grimLog.code!=null)str(b.grimLog.code,'Grim code',128);}
 return b;
}
export async function decodeBundle(buffer){
 if(buffer.byteLength>MAX_COMPRESSED)throw new Error('Replay exceeds the 32 MiB browser import limit.');
 const reader=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const pieces=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_EXPANDED){await reader.cancel();throw new Error('Replay exceeds the 128 MiB expanded limit.');}pieces.push(value);}}finally{reader.releaseLock();}
 const all=new Uint8Array(bytes);let offset=0;for(const p of pieces){all.set(p,offset);offset+=p.length;}
 return validateBundle(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all)));
}
