export const isAir=s=>/:(?:air|cave_air|void_air)(?:\[|$)/.test(s);
export const key=(x,y,z)=>`${x},${y},${z}`;
export const sectionKey=(x,y,z)=>`${x>>4}:${z>>4}:${y>>4}`;
export function parseState(state){const [name,rest]=state.split('[');return{name,props:Object.fromEntries((rest?.slice(0,-1)||'').split(',').filter(Boolean).map(p=>p.split('=')))};}
function doorBox(d){return[d==='east'?[0,0,0,.1875,1,1]:d==='west'?[.8125,0,0,.1875,1,1]:d==='south'?[0,0,0,1,1,.1875]:[0,0,.8125,1,1,.1875]];}

const boxCache=new Map(),colorCache=new Map(),fullCache=new Map();

// Generic visual geometry only: not Minecraft's collision or resource-pack models.
export function boxesFor(state){
 let cached=boxCache.get(state);if(cached)return cached;
 const {name,props:p}=parseState(state);
 if(isAir(state))cached=[];
 else if(name.endsWith('_slab'))cached=p.type==='double'?[[0,0,0,1,1,1]]:[[0,p.type==='top'?.5:0,0,1,.5,1]];
 else if(name.endsWith('_stairs')){
  const upper=p.half==='top';const boxes=[[0,upper?.5:0,0,1,.5,1]];
  const d=p.facing||'north';boxes.push(d==='east'?[.5,upper?0:.5,0,.5,.5,1]:d==='west'?[0,upper?0:.5,0,.5,.5,1]:d==='south'?[0,upper?0:.5,.5,1,.5,.5]:[0,upper?0:.5,0,1,.5,.5]);cached=boxes;
 }else if(name.endsWith('_trapdoor')){cached=p.open!=='true'?[[0,p.half==='top'?.8125:0,0,1,.1875,1]]:doorBox(p.facing);}
 else if(name.endsWith('_door')){const dirs=['north','east','south','west'];let d=p.facing||'north';if(p.open==='true')d=dirs[(dirs.indexOf(d)+(p.hinge==='right'?3:1))%4];cached=doorBox(d);}
 else if(name.endsWith('_carpet'))cached=[[0,0,0,1,.0625,1]];
 else if(name==='minecraft:snow')cached=[[0,0,0,1,Math.min(8,Number(p.layers)||1)/8,1]];
 else if(name.endsWith('_fence')||name.endsWith('_wall'))cached=[[.375,0,.375,.25,1.5,.25]];
 else if(name.includes('torch'))cached=[[.4375,0,.4375,.125,.65,.125]];
 else cached=[[0,0,0,1,1,1]];
 boxCache.set(state,cached);
 return cached;
}

export function isFullBlock(state){
 let f=fullCache.get(state);if(f!==undefined)return f;
 const b=boxesFor(state);
 f=b.length===1&&b[0][0]===0&&b[0][1]===0&&b[0][2]===0&&b[0][3]===1&&b[0][4]===1&&b[0][5]===1;
 fullCache.set(state,f);
 return f;
}

export function colorFor(s){
 let c=colorCache.get(s);if(c!==undefined)return c;
 if(/water/.test(s))c=0x397c9f;else if(/lava/.test(s))c=0xdb8245;else if(/grass|leaves|moss/.test(s))c=0x648355;else if(/dirt|mud/.test(s))c=0x7d6550;else if(/sand|birch/.test(s))c=0xc2b585;else if(/wood|log|planks|door|fence|stairs/.test(s))c=0x998063;else if(/snow|quartz|white/.test(s))c=0xd7ddd5;else if(/glass|ice/.test(s))c=0x95b9b9;else c=0x849087;
 colorCache.set(s,c);
 return c;
}

export class WorldTimeline{
 constructor(bundle,maxBlocks=1_000_000){
  this.maxBlocks=maxBlocks;
  const seen=new Set(),early=[],rest=[];
  for(const s of bundle.snapshots){
   const earlyChunks=[],restChunks=[];
   for(const c of s.chunks){
    const earlySecs=[],restSecs=[];
    for(const sec of c.sections){
     const k=`${c.x}:${c.z}:${sec.y}`;
     if(!seen.has(k)){seen.add(k);earlySecs.push(sec);}
     else restSecs.push(sec);
    }
    if(earlySecs.length)earlyChunks.push({x:c.x,z:c.z,sections:earlySecs});
    if(restSecs.length)restChunks.push({x:c.x,z:c.z,sections:restSecs});
   }
   if(earlyChunks.length)early.push({tick:bundle.startTick,chunks:earlyChunks});
   if(restChunks.length)rest.push({tick:s.tick,chunks:restChunks});
  }
  this.snapshots=[...early,...rest].sort((a,b)=>a.tick-b.tick);
  this.bundle=bundle;this.blocks=new Map();this.sections=new Map();this.dirtySections=new Set();this.reset();
 }
 markSectionDirty(x,y,z){
  const cx=x>>4,cy=y>>4,cz=z>>4;
  this.dirtySections.add(`${cx}:${cz}:${cy}`);
  if((x&15)===0)this.dirtySections.add(`${cx-1}:${cz}:${cy}`);
  if((x&15)===15)this.dirtySections.add(`${cx+1}:${cz}:${cy}`);
  if((y&15)===0)this.dirtySections.add(`${cx}:${cz}:${cy-1}`);
  if((y&15)===15)this.dirtySections.add(`${cx}:${cz}:${cy+1}`);
  if((z&15)===0)this.dirtySections.add(`${cx}:${cz-1}:${cy}`);
  if((z&15)===15)this.dirtySections.add(`${cx}:${cz+1}:${cy}`);
 }
 put(k,b){
  const prev=this.blocks.get(k);
  if(prev&&prev.state===b.state)return false;
  if(!prev&&this.blocks.size>=this.maxBlocks)throw new Error(`World exceeds the browser limit of ${this.maxBlocks.toLocaleString()} occupied blocks.`);
  this.blocks.set(k,b);
  const sk=sectionKey(b.x,b.y,b.z);
  let set=this.sections.get(sk);if(!set){set=new Set();this.sections.set(sk,set);}
  set.add(k);
  this.markSectionDirty(b.x,b.y,b.z);
  return true;
 }
 remove(k,x,y,z){
  if(!this.blocks.delete(k))return false;
  const sk=sectionKey(x,y,z);
  const set=this.sections.get(sk);if(set){set.delete(k);if(!set.size)this.sections.delete(sk);}
  this.markSectionDirty(x,y,z);
  return true;
 }
 reset(){
  for(const sk of this.sections.keys())this.dirtySections.add(sk);
  this.blocks.clear();this.sections.clear();this.si=0;this.ci=0;this.tick=-Infinity;this.fullReset=true;
 }
 seek(t){if(t<this.tick)this.reset();let dirty=false;const b=this.bundle;
  while(true){const st=this.snapshots[this.si]?.tick??Infinity;const ct=b.blockChanges[this.ci]?.tick??Infinity;if(Math.min(st,ct)>t)break;
   if(st<=ct){const s=this.snapshots[this.si++];for(const c of s.chunks)for(const sec of c.sections){for(let i=0;i<4096;i++){const x=c.x*16+(i&15),y=sec.y*16+(i>>8),z=c.z*16+((i>>4)&15),k=key(x,y,z),state=sec.palette[sec.indices[i]];if(isAir(state)){if(this.remove(k,x,y,z))dirty=true;}else if(this.put(k,{x,y,z,state}))dirty=true;}}}
   else{const c=b.blockChanges[this.ci++],k=key(c.x,c.y,c.z);if(isAir(c.state)){if(this.remove(k,c.x,c.y,c.z))dirty=true;}else if(this.put(k,c))dirty=true;}
  }this.tick=t;return dirty||this.fullReset;
 }
}
export function frameAt(frames,t){let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].tick<=t)lo=mid;else hi=mid-1;}return frames[lo];}
