export const isAir=s=>/:(?:air|cave_air|void_air)(?:\[|$)/.test(s);
export const key=(x,y,z)=>`${x},${y},${z}`;
export function parseState(state){const [name,rest]=state.split('[');return{name,props:Object.fromEntries((rest?.slice(0,-1)||'').split(',').filter(Boolean).map(p=>p.split('=')))};}
// Generic visual geometry only: not Minecraft's collision or resource-pack models.
export function boxesFor(state){
 const {name,props:p}=parseState(state);
 if(isAir(state))return[];
 if(name.endsWith('_slab'))return p.type==='double'?[[0,0,0,1,1,1]]:[[0,p.type==='top'?.5:0,0,1,.5,1]];
 if(name.endsWith('_stairs')){
  const upper=p.half==='top';const boxes=[[0,upper?.5:0,0,1,.5,1]];
  const d=p.facing||'north';boxes.push(d==='east'?[.5,upper?0:.5,0,.5,.5,1]:d==='west'?[0,upper?0:.5,0,.5,.5,1]:d==='south'?[0,upper?0:.5,.5,1,.5,.5]:[0,upper?0:.5,0,1,.5,.5]);return boxes;
 }
 if(name.endsWith('_trapdoor')){if(p.open!=='true')return[[0,p.half==='top'?.8125:0,0,1,.1875,1]];return doorBox(p.facing);}
 if(name.endsWith('_door')){const dirs=['north','east','south','west'];let d=p.facing||'north';if(p.open==='true')d=dirs[(dirs.indexOf(d)+(p.hinge==='right'?3:1))%4];return doorBox(d);}
 if(name.endsWith('_carpet'))return[[0,0,0,1,.0625,1]];
 if(name==='minecraft:snow')return[[0,0,0,1,Math.min(8,Number(p.layers)||1)/8,1]];
 if(name.endsWith('_fence')||name.endsWith('_wall'))return[[.375,0,.375,.25,1.5,.25]];
 if(name.includes('torch'))return[[.4375,0,.4375,.125,.65,.125]];
 return[[0,0,0,1,1,1]];
}
function doorBox(d){return[d==='east'?[0,0,0,.1875,1,1]:d==='west'?[.8125,0,0,.1875,1,1]:d==='south'?[0,0,0,1,1,.1875]:[0,0,.8125,1,1,.1875]];}
export function colorFor(s){if(/water/.test(s))return 0x397c9f;if(/lava/.test(s))return 0xdb8245;if(/grass|leaves|moss/.test(s))return 0x648355;if(/dirt|mud/.test(s))return 0x7d6550;if(/sand|birch/.test(s))return 0xc2b585;if(/wood|log|planks|door|fence|stairs/.test(s))return 0x998063;if(/snow|quartz|white/.test(s))return 0xd7ddd5;if(/glass|ice/.test(s))return 0x95b9b9;return 0x849087;}
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
  this.bundle=bundle;this.blocks=new Map();this.reset();
 }
 put(k,b){if(!this.blocks.has(k)&&this.blocks.size>=this.maxBlocks)throw new Error(`World exceeds the browser limit of ${this.maxBlocks.toLocaleString()} occupied blocks.`);this.blocks.set(k,b);}
 reset(){this.blocks.clear();this.si=0;this.ci=0;this.tick=-Infinity;}
 seek(t){if(t<this.tick)this.reset();let dirty=false;const b=this.bundle;
  while(true){const st=this.snapshots[this.si]?.tick??Infinity;const ct=b.blockChanges[this.ci]?.tick??Infinity;if(Math.min(st,ct)>t)break;
   if(st<=ct){const s=this.snapshots[this.si++];for(const c of s.chunks)for(const sec of c.sections){for(let i=0;i<4096;i++){const x=c.x*16+(i&15),y=sec.y*16+(i>>8),z=c.z*16+((i>>4)&15),k=key(x,y,z),state=sec.palette[sec.indices[i]];if(isAir(state))this.blocks.delete(k);else this.put(k,{x,y,z,state});}}}
   else{const c=b.blockChanges[this.ci++],k=key(c.x,c.y,c.z);if(isAir(c.state))this.blocks.delete(k);else this.put(k,c);}
   dirty=true;
  }this.tick=t;return dirty;
 }
}
export function frameAt(frames,t){let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].tick<=t)lo=mid;else hi=mid-1;}return frames[lo];}
