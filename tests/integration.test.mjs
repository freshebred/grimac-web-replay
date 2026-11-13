import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server/src/app.js';
import {hash} from '../server/src/store.js';
import {decodeBundle} from '../web/src/bundle.js';
import {WorldTimeline,key} from '../web/src/world.js';

test('synthetic bundle passes ingest, Discord session download, local decode and rewind',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'grim-e2e-'));const file=path.join(dir,'fixture.grimreplay');
 execFileSync(process.execPath,['scripts/create-fixture.mjs',file]);
 const bytes=await readFile(file),config={dataDir:path.join(dir,'data'),webDir:dir,maxBytes:10_000_000,maxUploadBytes:32*1024**2,maxExpandedBytes:128*1024**2,retentionHours:24,sessionHours:12,publicUrl:'http://localhost:3000',secure:false,ingestToken:'test-token-'.repeat(8),clientId:'test',clientSecret:'test',allowlist:['100000000000000001'],rawTemplate:''};
 const {app,store}=createApp(config);const http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 t.after(async()=>{await new Promise(r=>http.close(r));store.close();await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${http.address().port}`;
 const upload=await fetch(`${base}/api/ingest`,{method:'POST',headers:{Authorization:`Bearer ${config.ingestToken}`,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(upload.status,201);const {id}=await upload.json();
 store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('integration-session'),JSON.stringify({id:config.allowlist[0],username:'Integration'}),Date.now()+60_000);
 const headers={Cookie:'replay_session=integration-session'};
 const link=await fetch(`${base}/api/incidents/${id}/log`,{method:'PATCH',headers:{...headers,Origin:config.publicUrl,'Content-Type':'application/json'},body:JSON.stringify({code:'integrationCode',text:'Captured fixture log'})});assert.equal(link.status,200);
 const resolved=await(await fetch(`${base}/api/resolve/integrationCode`,{headers})).json();assert.equal(resolved.incident.id,id);
 const download=await fetch(`${base}/api/incidents/${id}/bundle`,{headers});assert.equal(download.status,200);
 const bundle=await decodeBundle(await download.arrayBuffer());assert.equal(bundle.grimLog.text,'Captured fixture log');
 const world=new WorldTimeline(bundle);world.seek(59);assert.equal(world.blocks.get(key(9,67,8)).state,'minecraft:oak_planks');world.seek(60);assert.equal(world.blocks.has(key(9,67,8)),false);world.seek(0);assert.equal(world.blocks.get(key(9,67,8)).state,'minecraft:oak_planks');
});
