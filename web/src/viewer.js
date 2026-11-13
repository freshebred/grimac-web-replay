import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldTimeline,boxesFor,colorFor,key,frameAt} from './world.js';
export class ReplayViewer{
 constructor(host,bundle,onTick,onWarning){
  this.host=host;this.bundle=bundle;this.onTick=onTick;this.onWarning=onWarning;this.tick=bundle.startTick;this.playing=false;this.speed=1;this.follow=false;this.world=new WorldTimeline(bundle);this.disposed=false;
  this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});this.renderer.debug.onShaderError=()=>{throw new Error('Your graphics driver could not compile the world renderer. Try another WebGL-enabled browser.');};this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setClearColor(0x142019);host.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','Recorded world. Drag to orbit, right-drag to pan, scroll to zoom.');
  this.scene=new THREE.Scene();this.scene.add(new THREE.HemisphereLight(0xe9f4e1,0x657260,2.2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(10,30,20);this.scene.add(light);
  this.camera=new THREE.PerspectiveCamera(60,1,.1,1500);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.maxDistance=600;this.controls.addEventListener('change',()=>this.draw());
  this.boxGeo=new THREE.BoxGeometry(1,1,1);this.material=new THREE.MeshLambertMaterial({vertexColors:false});
  this.player=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.6,1.8,.6)),new THREE.LineBasicMaterial({color:0xc6f19d,depthTest:false}));this.player.renderOrder=10;this.scene.add(this.player);
  this.look=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),1.5,0xc6f19d,.3,.15);this.scene.add(this.look);
  this.ro=new ResizeObserver(()=>{const {width,height}=host.getBoundingClientRect();this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.draw();});this.ro.observe(host);
  try{this.initializing=true;this.seek(this.tick);this.initializing=false;}catch(e){this.dispose();throw e;}this.resetCamera();this.lastTime=performance.now();this.loop=this.loop.bind(this);this.raf=requestAnimationFrame(this.loop);
 }
 resetCamera(){const f=frameAt(this.bundle.frames,this.tick);this.controls.target.set(f.x,f.y+.9,f.z);this.camera.position.set(f.x+12,f.y+10,f.z+12);this.controls.update();this.draw();}
 rebuild(){if(this.terrain){this.scene.remove(this.terrain);this.terrain.dispose();}const parts=[];
  for(const b of this.world.blocks.values()){
   const boxes=boxesFor(b.state);if(boxes.length===1&&boxes[0].slice(0,3).every(v=>v===0)&&boxes[0].slice(3).every(v=>v===1)&&[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].every(([x,y,z])=>{const n=this.world.blocks.get(key(b.x+x,b.y+y,b.z+z));return n&&boxesFor(n.state).some(a=>a.slice(0,3).every(v=>v===0)&&a.slice(3).every(v=>v===1));}))continue;
   for(const box of boxes){parts.push({b,box});if(parts.length>=200000)break;}if(parts.length>=200000)break;
  }
  if(parts.length>=200000)this.onWarning('Browser display capped at 200,000 block parts; some terrain is hidden.');
  this.terrain=new THREE.InstancedMesh(this.boxGeo,this.material,parts.length);const matrix=new THREE.Matrix4(),q=new THREE.Quaternion();for(let i=0;i<parts.length;i++){const {b,box:[x,y,z,w,h,d]}=parts[i];matrix.compose(new THREE.Vector3(b.x+x+w/2,b.y+y+h/2,b.z+z+d/2),q,new THREE.Vector3(w,h,d));this.terrain.setMatrixAt(i,matrix);this.terrain.setColorAt(i,new THREE.Color(colorFor(b.state)));}this.terrain.computeBoundingSphere();this.scene.add(this.terrain);
 }
 seek(t){const next=Math.max(this.bundle.startTick,Math.min(this.bundle.endTick,Math.floor(t)));let dirty;try{dirty=this.world.seek(next);}catch(e){this.playing=false;this.world.reset();this.onWarning(e.message);if(this.initializing)throw e;return;}this.tick=next;if(dirty)this.rebuild();const f=frameAt(this.bundle.frames,next);const h=/swimming|fall_flying|sleeping/.test(f.pose)?.6:/crouching|sneaking/.test(f.pose)?1.5:1.8;this.player.scale.y=h/1.8;this.player.position.set(f.x,f.y+h/2,f.z);const yaw=f.yaw*Math.PI/180,pitch=f.pitch*Math.PI/180;this.look.position.set(f.x,f.y+h*.9,f.z);this.look.setDirection(new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)));if(this.follow){const delta=new THREE.Vector3(f.x,f.y+h/2,f.z).sub(this.controls.target);this.camera.position.add(delta);this.controls.target.add(delta);this.controls.update();}this.onTick(next,f);this.draw();}
 draw(){if(!this.disposed)this.renderer.render(this.scene,this.camera);}
 loop(now){if(this.disposed)return;if(this.playing){this.remainder=(this.remainder||0)+(now-this.lastTime)/1000*this.bundle.tickRate*this.speed;const ticks=Math.floor(this.remainder);if(ticks){this.remainder-=ticks;this.seek(this.tick+ticks);if(this.tick===this.bundle.endTick){this.playing=false;this.onTick(this.tick,frameAt(this.bundle.frames,this.tick));}}}this.lastTime=now;this.raf=requestAnimationFrame(this.loop);}
 dispose(){this.disposed=true;cancelAnimationFrame(this.raf);this.ro.disconnect();this.controls.dispose();this.scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material]))m.dispose();});this.terrain?.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.host.replaceChildren();}
}
