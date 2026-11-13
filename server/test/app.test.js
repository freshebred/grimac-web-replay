import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync,gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { hash } from '../src/store.js';
import { configFromEnv } from '../src/config.js';
const bundle=()=>({schemaVersion:1,id:randomUUID(),serverId:'test',createdAt:new Date().toISOString(),player:{uuid:randomUUID(),name:'Player'},dimension:'minecraft:overworld',startTick:0,endTick:10,tickRate:20,flags:[{tick:5,check:'manual',vl:0,verbose:'',logCode:null}],grimLog:{code:null,text:null},snapshots:[{tick:0,chunks:[{x:0,z:0,sections:[{y:4,palette:['minecraft:air','minecraft:stone'],indices:Array(4096).fill(1)}]}]}],blockChanges:[],frames:[{tick:0,x:0,y:64,z:0,yaw:0,pitch:0,pose:'standing',onGround:true}],entities:[],warnings:[]});
async function fixture(t,extra={}) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'replay-test-'));let time=Date.now();
 const config={dataDir:dir,webDir:dir,maxBytes:10000000,maxUploadBytes:1000000,maxExpandedBytes:2000000,retentionHours:24,sessionHours:12,publicUrl:'http://localhost:3000',secure:false,ingestToken:'a'.repeat(64),clientId:'client',clientSecret:'secret',allowlist:['100000000000000001'],rawTemplate:'',...extra.config};
 const instance=createApp(config,{now:()=>time,...extra.options});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));instance.store.close();await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}`;
 instance.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('session'),JSON.stringify({id:config.allowlist[0],username:'Admin'}),time+864000000);
 const admin={Cookie:'replay_session=session'}, auth={Authorization:`Bearer ${config.ingestToken}`,'Content-Type':'application/octet-stream'};
 return {...instance,config,url,admin,auth,advance:ms=>time+=ms,upload:(b,headers={})=>fetch(`${url}/api/ingest`,{method:'POST',headers:{...auth,...headers},body:gzipSync(JSON.stringify(b))})};
}
test('ingestion requires bearer, validates encoding/schema, stores idempotently',async t=>{
 const f=await fixture(t),b=bundle();
 assert.equal((await f.upload(b,{Authorization:'Bearer wrong'})).status,401);
 assert.equal((await f.upload(b,{'Content-Encoding':'gzip'})).status,415);
 const bad=bundle();bad.snapshots[0].chunks[0].sections[0].indices=[0];assert.equal((await f.upload(bad)).status,400);
 const badEntity=bundle();badEntity.entities=[{}];assert.equal((await f.upload(badEntity)).status,400);
 const badFrame=bundle();badFrame.frames.push({...badFrame.frames[0]});assert.equal((await f.upload(badFrame)).status,400);
 assert.equal((await f.upload(b)).status,201);assert.equal((await (await f.upload(b)).json()).duplicate,true);
 b.player.name='different';assert.equal((await f.upload(b)).status,409);
 const r=await fetch(`${f.url}/api/incidents`,{headers:f.admin});const data=await r.json();assert.equal(data.incidents.length,1);assert.equal(data.incidents[0].playerName,'Player');
 assert.equal((await fetch(`${f.url}/api/incidents/${b.id}/bundle`)).status,401);
});
test('log attachment is self-contained, origin checked, original retry safe',async t=>{
 const f=await fixture(t),b=bundle();await f.upload(b);
 const route=`${f.url}/api/incidents/${b.id}/log`;
 assert.equal((await fetch(route,{method:'PATCH',headers:{...f.admin,'Content-Type':'application/json'},body:JSON.stringify({code:'paste1',text:'log'})})).status,403);
 const updated=await fetch(route,{method:'PATCH',headers:{...f.admin,Origin:f.config.publicUrl,'Content-Type':'application/json'},body:JSON.stringify({code:'paste1',text:'Prediction data'})});assert.equal(updated.status,200);
 const replay=await fetch(`${f.url}/api/incidents/${b.id}/bundle`,{headers:f.admin});const parsed=JSON.parse(gunzipSync(Buffer.from(await replay.arrayBuffer())));assert.deepEqual(parsed.grimLog,{code:'paste1',text:'Prediction data'});
 assert.equal((await (await f.upload(b)).json()).duplicate,true);
 const resolved=await (await fetch(`${f.url}/api/resolve/paste1`,{headers:f.admin})).json();assert.equal(resolved.incident.id,b.id);assert.equal(resolved.log,null);
 assert.deepEqual(await (await fetch(`${f.url}/api/resolve/unknown`,{headers:f.admin})).json(),{incident:null,log:null});
});
test('expiry blocks read immediately before cleanup; cleanup frees disk; capacity enforced',async t=>{
 const f=await fixture(t),b=bundle();await f.upload(b);f.advance(86400001);
 assert.equal((await fetch(`${f.url}/api/incidents/${b.id}/bundle`,{headers:f.admin})).status,404);
 assert.equal((await (await fetch(`${f.url}/api/incidents`,{headers:f.admin})).json()).incidents.length,0);
 await f.cleanup();assert.equal(f.store.used(),0);
 f.store.maxBytes=10;assert.equal((await f.upload(bundle())).status,507);
});
test('compressed expansion bounded and browser mutations protected',async t=>{
 const f=await fixture(t,{config:{maxExpandedBytes:1000}});
 assert.equal((await f.upload(bundle())).status,400);
 assert.equal((await fetch(`${f.url}/auth/logout`,{method:'POST',headers:f.admin})).status,403);
 assert.equal((await fetch(`${f.url}/auth/logout`,{method:'POST',headers:{...f.admin,Origin:f.config.publicUrl}})).status,200);
 assert.equal((await fetch(`${f.url}/api/me`,{headers:f.admin})).status,401);
});
test('OAuth state and PKCE, single-use callback, allowlist and session cookies',async t=>{
 let calls=0;
 const f=await fixture(t,{options:{fetchImpl:async(url,options)=>{calls++;if(url.endsWith('/token')){assert.ok(options.body.get('code_verifier'));return Response.json({access_token:'mock'});}return Response.json({id:'100000000000000001',username:'Admin',avatar:null});}}});
 const start=await fetch(`${f.url}/auth/discord?returnTo=%2Fpaste1`,{redirect:'manual'});const target=new URL(start.headers.get('location'));assert.equal(target.searchParams.get('code_challenge_method'),'S256');
 const state=target.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(`${f.url}/auth/discord/callback?state=${state}&code=hello`,{redirect:'manual'})).status,400);
 const login=await fetch(`${f.url}/auth/discord/callback?state=${state}&code=hello`,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(login.status,302);assert.equal(login.headers.get('location'),'/paste1');assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);assert.equal(calls,2);
 assert.equal((await fetch(`${f.url}/auth/discord/callback?state=${state}&code=hello`,{headers:{Cookie:cookie},redirect:'manual'})).status,400);
});
test('OAuth rejects users outside allowlist',async t=>{
 const f=await fixture(t,{options:{fetchImpl:async url=>Response.json(url.endsWith('/token')?{access_token:'mock'}:{id:'100000000000000002',username:'Other'})}});
 const start=await fetch(`${f.url}/auth/discord`,{redirect:'manual'});const state=new URL(start.headers.get('location')).searchParams.get('state');
 assert.equal((await fetch(`${f.url}/auth/discord/callback?state=${state}&code=hello`,{headers:{Cookie:start.headers.get('set-cookie').split(';')[0]},redirect:'manual'})).status,403);
});
test('startup rejects unsafe defaults',()=>{
 assert.throws(()=>configFromEnv({}),/INGEST_TOKEN/);
 assert.throws(()=>configFromEnv({INGEST_TOKEN:'replace-with-your-random-token-at-least-32-characters'}),/INGEST_TOKEN/);
 assert.throws(()=>configFromEnv({PUBLIC_URL:'http://public.example'}),/HTTPS/);
});
test('changing a paste code never attributes old text to the new paste',async t=>{
 const f=await fixture(t),b=bundle();b.grimLog={code:'oldPaste',text:'Old evidence text'};await f.upload(b);
 const update=await fetch(`${f.url}/api/incidents/${b.id}/log`,{method:'PATCH',headers:{...f.admin,Origin:f.config.publicUrl,'Content-Type':'application/json'},body:JSON.stringify({code:'newPaste'})});assert.equal(update.status,200);
 const replay=await fetch(`${f.url}/api/incidents/${b.id}/bundle`,{headers:f.admin});const parsed=JSON.parse(gunzipSync(Buffer.from(await replay.arrayBuffer())));assert.deepEqual(parsed.grimLog,{code:'newPaste',text:null});
});
test('entities, action events and server 5-camera MP4 rendering lifecycle',async t=>{
 const f=await fixture(t),b=bundle();
 b.entities=[{id:'00000000-0000-4000-8000-000000000099',type:'minecraft:player',name:'Target',width:0.6,height:1.8,frames:[{tick:0,x:3,y:64,z:0,yaw:90,pitch:0,hurt:true}]}];
 b.events=[{tick:5,type:'attack',targetId:'00000000-0000-4000-8000-000000000099',targetName:'Target',distance:3.1,x:2.7,y:65,z:0}];
 assert.equal((await f.upload(b)).status,201);
 await f.waitForVideo(b.id);
 const meta=await (await fetch(`${f.url}/api/incidents/${b.id}`,{headers:f.admin})).json();
 assert.equal(meta.videoStatus,'ready');
 assert.equal(meta.videoReady,true);
 const vid=await fetch(`${f.url}/api/incidents/${b.id}/video`,{headers:f.admin});
 assert.equal(vid.status,200);
 assert.match(vid.headers.get('content-type')||'',/video\/mp4/);
 const mp4Bytes=Buffer.from(await vid.arrayBuffer());
 assert.ok(mp4Bytes.length>64);
 assert.equal(mp4Bytes.subarray(4,8).toString('ascii'),'ftyp');
});
