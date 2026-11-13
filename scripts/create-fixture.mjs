import {gzipSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const indices = Array(4096).fill(0);
for(let z=0;z<16;z++) for(let x=0;x<16;x++) indices[z*16+x]=1;
for(let y=1;y<4;y++) indices[y*256+8*16+9]=2;
indices[256+8*16+7]=3;
const bundle={
 schemaVersion:1,
 id:randomUUID(),
 serverId:'local-test',
 createdAt:new Date().toISOString(),
 player:{uuid:'00000000-0000-4000-8000-000000000001',name:'TestPlayer'},
 dimension:'minecraft:overworld',
 startTick:0,
 endTick:100,
 tickRate:20,
 flags:[{tick:50,check:'Reach',vl:2.5,verbose:'3.48 blocks reach against TargetPlayer',logCode:null}],
 grimLog:{code:null,text:'Synthetic fixture. Not evidence of real gameplay.'},
 snapshots:[{tick:0,chunks:[{x:0,z:0,sections:[{y:4,palette:['minecraft:air','minecraft:stone','minecraft:oak_planks','minecraft:oak_stairs[facing=east,half=bottom,shape=straight]'],indices}]}]}],
 blockChanges:[
  {tick:35,x:8,y:65,z:7,state:'minecraft:oak_planks'},
  {tick:60,x:9,y:67,z:8,state:'minecraft:air'}
 ],
 frames:Array.from({length:101},(_,tick)=>({
  tick,
  x:2+tick/12,
  y:65,
  z:6,
  yaw:-90,
  pitch:0,
  pose:'standing',
  onGround:true,
  swinging:tick===35||tick===50||tick===60,
  hurt:tick>=70&&tick<=74,
  using:tick>=20&&tick<=25,
  sprinting:tick>10,
  mainHand:'minecraft:diamond_sword'
 })),
 entities:[
  {
   id:'00000000-0000-4000-8000-000000000002',
   type:'minecraft:player',
   name:'TargetPlayer',
   width:0.6,
   height:1.8,
   frames:Array.from({length:101},(_,tick)=>({
    tick,
    x:9.65,
    y:65,
    z:6.1,
    yaw:90,
    pitch:0,
    hurt:tick>=50&&tick<=55
   }))
  },
  {
   id:'00000000-0000-4000-8000-000000000003',
   type:'minecraft:zombie',
   name:'ArenaZombie',
   width:0.6,
   height:1.95,
   frames:Array.from({length:101},(_,tick)=>({
    tick,
    x:6.5,
    y:65,
    z:9.0-tick*0.02,
    yaw:180,
    pitch:0,
    hurt:false
   }))
  }
 ],
 events:[
  {tick:35,type:'place',x:8,y:65,z:7,state:'minecraft:oak_planks'},
  {tick:42,type:'interact',x:7,y:65,z:8,state:'minecraft:oak_stairs[facing=east,half=bottom,shape=straight]'},
  {tick:50,type:'attack',targetId:'00000000-0000-4000-8000-000000000002',targetName:'TargetPlayer',distance:3.48,x:9.35,y:66.1,z:6.1},
  {tick:60,type:'break',x:9,y:67,z:8,state:'minecraft:oak_planks'},
  {tick:70,type:'hurt',attackerId:'00000000-0000-4000-8000-000000000002',attackerName:'TargetPlayer',x:7.83,y:65,z:6}
 ],
 warnings:['Synthetic test fixture; generic block geometry.']
};
const destination=process.argv[2] || '/tmp/example.grimreplay';
writeFileSync(destination,gzipSync(JSON.stringify(bundle)));
console.log(`Created synthetic replay: ${destination}`);
