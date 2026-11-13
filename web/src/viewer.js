import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldTimeline,boxesFor,colorFor,isFullBlock,key,frameAt} from './world.js';

const FACES=[
 {dir:[0,1,0],norm:[0,1,0],shade:1.08,corners:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]]},
 {dir:[0,-1,0],norm:[0,-1,0],shade:0.58,corners:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
 {dir:[0,0,-1],norm:[0,0,-1],shade:0.86,corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]},
 {dir:[0,0,1],norm:[0,0,1],shade:0.92,corners:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]},
 {dir:[-1,0,0],norm:[-1,0,0],shade:0.74,corners:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]},
 {dir:[1,0,0],norm:[1,0,0],shade:0.80,corners:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]}
];

export class ReplayViewer{
 constructor(host,bundle,onTick,onWarning){
  this.host=host;this.bundle=bundle;this.onTick=onTick;this.onWarning=onWarning;this.tick=bundle.startTick;this.playing=false;this.speed=1;this.follow=false;this.matrixMode=false;this.world=new WorldTimeline(bundle);this.disposed=false;
  this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  this.renderer.debug.onShaderError=()=>{throw new Error('Your graphics driver could not compile the world renderer. Try another WebGL-enabled browser.');};
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  this.renderer.setClearColor(0x142019);
  host.append(this.renderer.domElement);
  this.renderer.domElement.setAttribute('aria-label','Recorded world. Drag to orbit, right-drag to pan, scroll to zoom.');

  this.scene=new THREE.Scene();
  this.scene.add(new THREE.HemisphereLight(0xe9f4e1,0x657260,2.2));
  const light=new THREE.DirectionalLight(0xffffff,1.6);light.position.set(14,36,22);this.scene.add(light);

  this.camera=new THREE.PerspectiveCamera(60,1,.1,1500);
  this.auxCamera=new THREE.PerspectiveCamera(65,1,.1,1000);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);
  this.controls.enableDamping=false;this.controls.maxDistance=600;
  this.controls.addEventListener('change',()=>this.draw());

  this.terrainMaterial=new THREE.MeshBasicMaterial({vertexColors:true});
  this.terrainGroup=new THREE.Group();
  this.scene.add(this.terrainGroup);
  this.sectionMeshes=new Map();

  // Suspect player representation (hitbox + head + swing indicator)
  this.playerMat=new THREE.LineBasicMaterial({color:0xc6f19d,depthTest:false});
  this.player=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.6,1.8,.6)),this.playerMat);
  this.player.renderOrder=10;
  this.scene.add(this.player);

  this.headBox=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.46,.46,.46)),this.playerMat);
  this.headBox.renderOrder=10;
  this.scene.add(this.headBox);

  this.swingMat=new THREE.MeshBasicMaterial({color:0xffb74d,wireframe:true,depthTest:false});
  this.swingBox=new THREE.Mesh(new THREE.BoxGeometry(.36,.36,.36),this.swingMat);
  this.swingBox.renderOrder=12;
  this.swingBox.visible=false;
  this.scene.add(this.swingBox);

  this.look=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),1.6,0xc6f19d,.32,.16);
  this.scene.add(this.look);

  // Nearby entities & combat/block action overlays
  this.unitBoxEdges=new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1));
  this.unitBoxGeo=new THREE.BoxGeometry(1,1,1);
  this.entityGroup=new THREE.Group();
  this.scene.add(this.entityGroup);
  this.actionGroup=new THREE.Group();
  this.scene.add(this.actionGroup);

  this.ro=new ResizeObserver(()=>{
   const {width,height}=host.getBoundingClientRect();
   if(!width||!height)return;
   this.renderer.setSize(width,height,false);
   this.camera.aspect=width/height;
   this.camera.updateProjectionMatrix();
   this.draw();
  });
  this.ro.observe(host);

  try{
   this.initializing=true;
   this.world.seek(bundle.endTick);
   this.rebuildDirty();
   this.seek(this.tick);
   this.initializing=false;
  }catch(e){this.dispose();throw e;}

  this.resetCamera();
  this.lastTime=performance.now();
  this.loop=this.loop.bind(this);
  this.raf=requestAnimationFrame(this.loop);
 }

 resetCamera(){
  const f=frameAt(this.bundle.frames,this.tick);
  this.controls.target.set(f.x,f.y+.9,f.z);
  this.camera.position.set(f.x+10,f.y+8,f.z+10);
  this.controls.update();
  this.draw();
 }

 buildSectionGeometry(secKey){
  const keys=this.world.sections.get(secKey);
  if(!keys||!keys.size)return null;
  const positions=[],colors=[],indices=[];
  let vertCount=0;
  const tmpColor=new THREE.Color();

  for(const k of keys){
   const b=this.world.blocks.get(k);
   if(!b)continue;
   const boxes=boxesFor(b.state);
   if(!boxes.length)continue;
   const full=isFullBlock(b.state);
   tmpColor.setHex(colorFor(b.state));

   for(const [ox,oy,oz,w,h,d] of boxes){
    const x0=b.x+ox,y0=b.y+oy,z0=b.z+oz;
    for(const face of FACES){
     if(full){
      const nb=this.world.blocks.get(key(b.x+face.dir[0],b.y+face.dir[1],b.z+face.dir[2]));
      if(nb&&isFullBlock(nb.state))continue;
     }
     const r=Math.min(1,tmpColor.r*face.shade),g=Math.min(1,tmpColor.g*face.shade),bl=Math.min(1,tmpColor.b*face.shade);
     for(const [cx,cy,cz] of face.corners){
      positions.push(x0+cx*w,y0+cy*h,z0+cz*d);
      colors.push(r,g,bl);
     }
     indices.push(vertCount,vertCount+1,vertCount+2,vertCount,vertCount+2,vertCount+3);
     vertCount+=4;
    }
   }
  }
  if(!positions.length)return null;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
 }

 rebuildDirty(){
  if(this.world.fullReset){
   for(const m of this.sectionMeshes.values()){this.terrainGroup.remove(m);m.geometry.dispose();}
   this.sectionMeshes.clear();
   for(const sk of this.world.sections.keys())this.world.dirtySections.add(sk);
   this.world.fullReset=false;
  }
  if(this.world.blocks.size>200000)this.onWarning('Large world section count; distant blocks may be culled.');
  for(const sk of this.world.dirtySections){
   const old=this.sectionMeshes.get(sk);
   if(old){this.terrainGroup.remove(old);old.geometry.dispose();this.sectionMeshes.delete(sk);}
   const geo=this.buildSectionGeometry(sk);
   if(geo){
    const mesh=new THREE.Mesh(geo,this.terrainMaterial);
    this.terrainGroup.add(mesh);
    this.sectionMeshes.set(sk,mesh);
   }
  }
  this.world.dirtySections.clear();
 }

 clearGroup(group){
  while(group.children.length){
   const child=group.children.pop();
   if(child.geometry&&child.geometry!==this.unitBoxEdges&&child.geometry!==this.unitBoxGeo)child.geometry.dispose();
   if(child.material){
    for(const m of(Array.isArray(child.material)?child.material:[child.material]))m.dispose();
   }
  }
 }

 updateEntitiesAndActions(tick,f,h,eyeY,lookDir){
  this.clearGroup(this.entityGroup);
  this.clearGroup(this.actionGroup);

  const events=this.bundle.events||[];
  const recentEvents=events.filter(ev=>ev.tick<=tick&&ev.tick>=tick-6);
  const isHurt=Boolean(f.hurt||recentEvents.some(ev=>ev.type==='hurt'&&ev.tick>=tick-4));
  const isSwinging=Boolean(f.swinging||recentEvents.some(ev=>(ev.type==='attack'||ev.type==='swing')&&ev.tick>=tick-3));

  this.playerMat.color.setHex(isHurt?0xff5252:0xc6f19d);
  this.swingBox.visible=isSwinging;
  if(isSwinging){
   this.swingBox.position.set(f.x+lookDir.x*.75,eyeY-.22+lookDir.y*.75,f.z+lookDir.z*.75);
   this.swingBox.rotation.set(0,-f.yaw*Math.PI/180,0);
  }

  // Render nearby entities
  for(const e of this.bundle.entities||[]){
   if(!e.frames?.length)continue;
   if(tick<e.frames[0].tick-5||tick>e.frames[e.frames.length-1].tick+20)continue;
   const ef=frameAt(e.frames,tick);
   const attackedNow=recentEvents.some(ev=>ev.type==='attack'&&ev.targetId===e.id&&ev.tick>=tick-4);
   const hurt=Boolean(ef.hurt||attackedNow);
   const color=hurt?0xff3b3b:e.type==='minecraft:player'?0x5ce1e6:0xf5b942;
   const w=e.width||.6,eh=e.height||1.8;

   const wire=new THREE.LineSegments(this.unitBoxEdges,new THREE.LineBasicMaterial({color,depthTest:false}));
   wire.scale.set(w,eh,w);
   wire.position.set(ef.x,ef.y+eh/2,ef.z);
   wire.renderOrder=11;
   this.entityGroup.add(wire);

   const fill=new THREE.Mesh(this.unitBoxGeo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:hurt?.32:.14,depthWrite:false}));
   fill.scale.set(w*.96,eh*.96,w*.96);
   fill.position.set(ef.x,ef.y+eh/2,ef.z);
   this.entityGroup.add(fill);

   const eyaw=(ef.yaw||0)*Math.PI/180,epitch=(ef.pitch||0)*Math.PI/180;
   const edir=new THREE.Vector3(-Math.sin(eyaw)*Math.cos(epitch),-Math.sin(epitch),Math.cos(eyaw)*Math.cos(epitch));
   const eEye=new THREE.Vector3(ef.x,ef.y+eh*.85,ef.z);
   const lookPts=[eEye,eEye.clone().addScaledVector(edir,1.25)];
   const lookLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(lookPts),new THREE.LineBasicMaterial({color,depthTest:false}));
   lookLine.renderOrder=11;
   this.entityGroup.add(lookLine);
  }

  // Render combat hit rays & block interaction highlights
  for(const ev of recentEvents){
   if(ev.type==='attack'&&ev.x!=null){
    const start=new THREE.Vector3(f.x,eyeY,f.z);
    const hit=new THREE.Vector3(ev.x,ev.y,ev.z);
    const rayGeo=new THREE.BufferGeometry().setFromPoints([start,hit]);
    const ray=new THREE.Line(rayGeo,new THREE.LineBasicMaterial({color:0xff4d4d,depthTest:false}));
    ray.renderOrder=14;
    this.actionGroup.add(ray);

    const marker=new THREE.LineSegments(this.unitBoxEdges,new THREE.LineBasicMaterial({color:0xffeb3b,depthTest:false}));
    marker.scale.set(.32,.32,.32);
    marker.position.copy(hit);
    marker.renderOrder=15;
    this.actionGroup.add(marker);
   }else if((ev.type==='place'||ev.type==='break'||ev.type==='interact')&&ev.x!=null){
    const bColor=ev.type==='place'?0x5ce1e6:ev.type==='break'?0xff5252:0xffd166;
    const hl=new THREE.LineSegments(this.unitBoxEdges,new THREE.LineBasicMaterial({color:bColor,depthTest:false}));
    hl.scale.set(1.04,1.04,1.04);
    hl.position.set(ev.x+.5,ev.y+.5,ev.z+.5);
    hl.renderOrder=13;
    this.actionGroup.add(hl);
   }
  }

  // Also highlight recent raw blockChanges within 4 ticks
  for(const bc of this.bundle.blockChanges||[]){
   if(bc.tick<=tick&&bc.tick>=tick-4){
    const isBreak=/:(?:air|cave_air|void_air)(?:\[|$)/.test(bc.state);
    const hl=new THREE.LineSegments(this.unitBoxEdges,new THREE.LineBasicMaterial({color:isBreak?0xff5252:0x5ce1e6,depthTest:false}));
    hl.scale.set(1.03,1.03,1.03);
    hl.position.set(bc.x+.5,bc.y+.5,bc.z+.5);
    hl.renderOrder=12;
    this.actionGroup.add(hl);
   }
  }
 }

 seek(t){
  const next=Math.max(this.bundle.startTick,Math.min(this.bundle.endTick,Math.floor(t)));
  let dirty;
  try{dirty=this.world.seek(next);}catch(e){
   this.playing=false;this.world.reset();this.onWarning(e.message);
   if(this.initializing)throw e;
   return;
  }
  this.tick=next;
  if(dirty)this.rebuildDirty();
  const f=frameAt(this.bundle.frames,next);
  const h=/swimming|fall_flying|sleeping/.test(f.pose)?.6:/crouching|sneaking/.test(f.pose)?1.5:1.8;
  this.player.scale.y=h/1.8;
  this.player.position.set(f.x,f.y+h/2,f.z);
  const eyeY=f.y+h*.9;
  this.headBox.position.set(f.x,eyeY,f.z);
  this.headBox.rotation.set(f.pitch*Math.PI/180,-f.yaw*Math.PI/180,0);
  const yaw=f.yaw*Math.PI/180,pitch=f.pitch*Math.PI/180;
  const lookDir=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
  this.look.position.set(f.x,eyeY,f.z);
  this.look.setDirection(lookDir);
  this.lastFrame={f,h,eyeY,lookDir};

  this.updateEntitiesAndActions(next,f,h,eyeY,lookDir);

  if(this.follow){
   const delta=new THREE.Vector3(f.x,f.y+h/2,f.z).sub(this.controls.target);
   this.camera.position.add(delta);
   this.controls.target.add(delta);
   this.controls.update();
  }
  this.onTick(next,f);
  this.draw();
 }

 draw(){
  if(this.disposed)return;
  if(!this.matrixMode){
   this.renderer.setScissorTest(false);
   this.player.visible=true;this.headBox.visible=true;this.look.visible=true;
   this.renderer.render(this.scene,this.camera);
   return;
  }
  // 5-Camera 3x3 cross matrix mode in WebGL
  const canvas=this.renderer.domElement;
  const W=canvas.clientWidth||720,H=canvas.clientHeight||540;
  const cw=Math.floor(W/3),ch=Math.floor(H/3);
  const {f,eyeY,lookDir}=this.lastFrame||{f:frameAt(this.bundle.frames,this.tick),eyeY:66.6,lookDir:new THREE.Vector3(0,0,1)};
  const target=new THREE.Vector3(f.x,f.y+.75,f.z);

  this.renderer.setScissorTest(true);
  this.renderer.setViewport(0,0,W,H);
  this.renderer.setScissor(0,0,W,H);
  this.renderer.setClearColor(0x101f12);
  this.renderer.clear();

  const views=[
   {col:1,row:2,pos:[f.x,f.y+3.6,f.z-5.2],look:target,pov:false}, // Top-center: North (-Z)
   {col:0,row:1,pos:[f.x-5.2,f.y+3.6,f.z],look:target,pov:false}, // Middle-left: West (-X)
   {col:1,row:1,pos:[f.x,eyeY,f.z],look:new THREE.Vector3(f.x+lookDir.x,eyeY+lookDir.y,f.z+lookDir.z),pov:true}, // Center (2;2): 1st Person POV
   {col:2,row:1,pos:[f.x+5.2,f.y+3.6,f.z],look:target,pov:false}, // Middle-right: East (+X)
   {col:1,row:0,pos:[f.x,f.y+3.6,f.z+5.2],look:target,pov:false}  // Bottom-center: South (+Z)
  ];

  this.auxCamera.aspect=cw/Math.max(1,ch);
  this.auxCamera.updateProjectionMatrix();

  for(const v of views){
   const vx=v.col*cw,vy=v.row*ch;
   this.renderer.setViewport(vx,vy,cw,ch);
   this.renderer.setScissor(vx,vy,cw,ch);
   this.renderer.setClearColor(0x142019);
   this.renderer.clear();
   this.player.visible=!v.pov;
   this.headBox.visible=!v.pov;
   this.look.visible=!v.pov;
   this.auxCamera.fov=v.pov?72:62;
   this.auxCamera.updateProjectionMatrix();
   this.auxCamera.position.set(v.pos[0],v.pos[1],v.pos[2]);
   this.auxCamera.lookAt(v.look);
   this.renderer.render(this.scene,this.auxCamera);
  }
  this.player.visible=true;this.headBox.visible=true;this.look.visible=true;
  this.renderer.setScissorTest(false);
 }

 loop(now){
  if(this.disposed)return;
  if(this.playing){
   this.remainder=(this.remainder||0)+(now-this.lastTime)/1000*this.bundle.tickRate*this.speed;
   const ticks=Math.floor(this.remainder);
   if(ticks){
    this.remainder-=ticks;
    this.seek(this.tick+ticks);
    if(this.tick===this.bundle.endTick){
     this.playing=false;
     this.onTick(this.tick,frameAt(this.bundle.frames,this.tick));
    }
   }
  }
  this.lastTime=now;
  this.raf=requestAnimationFrame(this.loop);
 }

 dispose(){
  this.disposed=true;
  cancelAnimationFrame(this.raf);
  this.ro.disconnect();
  this.controls.dispose();
  this.clearGroup(this.entityGroup);
  this.clearGroup(this.actionGroup);
  for(const m of this.sectionMeshes.values())m.geometry.dispose();
  this.sectionMeshes.clear();
  this.scene.traverse(o=>{
   if(o.geometry)o.geometry.dispose();
   if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material]))m.dispose();
  });
  this.renderer.dispose();
  this.renderer.forceContextLoss();
  this.host.replaceChildren();
 }
}
