import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { stat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Store, hash } from './store.js';
import { validateBundle, validCode } from './schema.js';
import { renderReplayVideo } from './video.js';
const unzip=promisify(gunzip), zip=promisify(gzip);
const token=()=>randomBytes(32).toString('base64url');
const error=(status,message)=>Object.assign(new Error(message),{status});
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
const equal=(a,b)=>{const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&timingSafeEqual(aa,bb);};
export function createApp(config, {now=Date.now,fetchImpl=fetch}={}) {
  const app=express(), store=new Store(config.dataDir,config.maxBytes,config.retentionHours,now);
  app.disable('x-powered-by');
  let busy=false;
  const renderJobs=new Map();
  let renderChain=Promise.resolve();
  const enqueueVideo=(id,bundle)=>{
    if(store.closed||renderJobs.has(id))return renderJobs.get(id);
    const job=renderChain.then(async()=>{
      if(store.closed)return;
      const rec=store.get(id);
      if(!rec||rec.videoStatus==='ready')return;
      store.setVideoStatus(id,'rendering');
      const vfile=`${randomUUID()}.mp4`,tmp=path.join(store.dir,`${vfile}.tmp`),dest=path.join(store.dir,vfile);
      try{
        const b=bundle||JSON.parse((await unzip(await store.read(rec),{maxOutputLength:config.maxExpandedBytes})).toString('utf8'));
        await renderReplayVideo(b,tmp,()=>store.closed);
        if(store.closed){await unlink(tmp).catch(()=>{});return;}
        await rename(tmp,dest);
        const info=await stat(dest);
        await store.attachVideo(id,vfile,info.size);
      }catch(e){
        if(!store.closed)console.warn(`Video encode unavailable for ${id} (${e.message}); client will use live 3x3 matrix.`);
        await unlink(tmp).catch(()=>{});
        await unlink(dest).catch(()=>{});
        store.setVideoStatus(id,'failed');
      }finally{
        renderJobs.delete(id);
      }
    });
    renderChain=job.catch(()=>{});
    renderJobs.set(id,job);
    return job;
  };
  const waitForVideo=async id=>{const j=renderJobs.get(id);if(j)await j;};
  for(const row of store.db.prepare("SELECT id FROM incidents WHERE videoStatus IN ('pending','rendering') AND expiresAt>?").all(now())){
    store.setVideoStatus(row.id,'pending');
    enqueueVideo(row.id,null);
  }
  const exclusive=(req,res,next)=>{if(busy){res.set('Retry-After','2');return res.status(503).json({error:'Recording storage busy; retry shortly'});}busy=true;let released=false;const release=()=>{if(!released){released=true;busy=false;}};req.releaseMutation=release;res.once('finish',()=>{if(!req.mutationStarted)release();});res.once('close',()=>{if(!req.mutationStarted)release();});next();};
  const mutation=fn=>async(req,res,next)=>{req.mutationStarted=true;try{await fn(req,res);}catch(e){next(e);}finally{req.releaseMutation();}};
  const cookieOptions={httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'};
  const bearer=req=>equal(req.get('Authorization'),`Bearer ${config.ingestToken}`);
  const origin=(req,res,next)=>req.get('Origin')===config.publicUrl?next():res.status(403).json({error:'Invalid request origin'});
  const session=(req,res,next)=>{const raw=cookies(req).replay_session;const record=raw&&store.db.prepare('SELECT user FROM sessions WHERE token=? AND expires>?').get(hash(raw),now());if(record){const user=JSON.parse(record.user);if(config.allowlist.includes(user.id))req.user=user;}next();};
  const admin=(req,res,next)=>req.user?next():res.status(401).json({error:'Discord login required'});
  const writer=(req,res,next)=>bearer(req)?next():admin(req,res,()=>origin(req,res,next));
  app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});if(config.secure)res.set('Strict-Transport-Security','max-age=31536000');next();});
  app.use(session);
  app.get('/healthz',(req,res)=>res.json({ok:true}));
  app.get('/auth/discord',(req,res)=>{
    const state=token(),verifier=token();
    store.db.prepare('DELETE FROM oauth WHERE expires<=?').run(now());
    if(store.db.prepare('SELECT COUNT(*) n FROM oauth').get().n>=1000)throw error(503,'Too many pending logins; retry later');
    const candidate=req.query.returnTo;const returnTo=typeof candidate==='string'&&/^\/[a-zA-Z0-9_-]{0,128}$/.test(candidate)?candidate:'/';
    store.db.prepare('INSERT INTO oauth VALUES(?,?,?,?)').run(hash(state),verifier,now()+600000,returnTo);
    res.cookie('replay_oauth',state,{...cookieOptions,maxAge:600000});
    const url=new URL('https://discord.com/oauth2/authorize');
    for(const [k,v] of Object.entries({client_id:config.clientId,redirect_uri:`${config.publicUrl}/auth/discord/callback`,response_type:'code',scope:'identify',state,code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
    res.redirect(url.href);
  });
  app.get('/auth/discord/callback',async(req,res)=>{
    const state=req.query.state;
    if(typeof state!=='string'||!equal(state,cookies(req).replay_oauth)||typeof req.query.code!=='string')throw error(400,'Invalid OAuth state');
    const pending=store.db.prepare('SELECT verifier,returnTo FROM oauth WHERE token=? AND expires>?').get(hash(state),now());
    store.db.prepare('DELETE FROM oauth WHERE token=?').run(hash(state));res.clearCookie('replay_oauth',cookieOptions);
    if(!pending)throw error(400,'Expired or reused OAuth state');
    const result=await fetchImpl('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:`${config.publicUrl}/auth/discord/callback`,code_verifier:pending.verifier}),signal:AbortSignal.timeout(10000)});
    if(!result.ok)throw error(502,'Discord token exchange failed');
    const access=await result.json();
    const profile=await fetchImpl('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${access.access_token}`},signal:AbortSignal.timeout(10000)});
    if(!profile.ok)throw error(502,'Discord profile lookup failed');
    const user=await profile.json();
    if(!config.allowlist.includes(user.id))throw error(403,'This Discord account is not allowed');
    const sid=token();store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(sid),JSON.stringify({id:user.id,username:user.username,avatar:user.avatar}),now()+config.sessionHours*3600000);
    res.cookie('replay_session',sid,{...cookieOptions,maxAge:config.sessionHours*3600000});res.redirect(pending.returnTo);
  });
  app.post('/auth/logout',origin,(req,res)=>{const sid=cookies(req).replay_session;if(sid)store.db.prepare('DELETE FROM sessions WHERE token=?').run(hash(sid));res.clearCookie('replay_session',cookieOptions);res.json({ok:true});});
  app.get('/api/me',admin,(req,res)=>res.json({user:req.user}));
  const raw=express.raw({type:'application/octet-stream',limit:config.maxUploadBytes,inflate:false});
  app.post('/api/ingest',(req,res,next)=>bearer(req)?next():res.status(401).json({error:'Invalid ingestion credential'}),exclusive,(req,res,next)=>{
    if(req.get('Content-Encoding'))throw error(415,'Send gzip as the file body without Content-Encoding');
    if(!req.is('application/octet-stream'))throw error(415,'Use application/octet-stream');next();
  },raw,mutation(async(req,res)=>{
    let b;try{b=JSON.parse((await unzip(req.body,{maxOutputLength:config.maxExpandedBytes})).toString('utf8'));}catch{throw error(400,'Invalid gzip JSON or expanded size exceeded');}
    validateBundle(b);await store.cleanup();const inserted=await store.insert(b,req.body);if(!inserted.duplicate)enqueueVideo(b.id,b);res.status(201).json(inserted);
  }));
  app.get('/api/incidents',admin,(req,res)=>res.json({incidents:store.list(String(req.query.search||'').slice(0,200)),storage:{usedBytes:store.used(),maxBytes:config.maxBytes},retentionHours:config.retentionHours}));
  const lookup=req=>{const r=store.get(req.params.id);if(!r)throw error(404,'Recording missing or expired');return r;};
  app.get('/api/incidents/:id',admin,(req,res)=>{const r=lookup(req);if(r.videoStatus==='pending')enqueueVideo(r.id,null);res.json(store.metadata(r));});
  app.get('/api/incidents/:id/bundle',admin,(req,res,next)=>{const r=lookup(req);res.set({'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${r.id}.grimreplay"`});res.sendFile(path.join(store.dir,r.filename),{dotfiles:'deny'},err=>{if(err)next(err);});});
  app.get('/api/incidents/:id/video',admin,(req,res,next)=>{
    const r=lookup(req);
    if(r.videoStatus!=='ready'||!r.videoFilename){
      if(r.videoStatus==='pending')enqueueVideo(r.id,null);
      return res.status(202).json({ready:false,videoStatus:r.videoStatus||'pending',error:'Server 5-camera video is not ready yet; rendering in progress.'});
    }
    res.set({'Content-Type':'video/mp4'});
    res.sendFile(path.join(store.dir,r.videoFilename),{dotfiles:'deny'},err=>{if(err)next(err);});
  });
  app.delete('/api/incidents/:id',admin,origin,exclusive,mutation(async(req,res)=>{lookup(req);await store.remove(req.params.id);res.json({ok:true});}));
  app.get('/api/resolve/:code',admin,async(req,res)=>{
    if(!validCode(req.params.code))throw error(400,'Invalid code');const r=store.resolve(req.params.code);
    if(!r)return res.json({incident:null,log:null});
    if(r.videoStatus==='pending')enqueueVideo(r.id,null);
    res.json({incident:store.metadata(r),log:null});
  });
  app.patch('/api/incidents/:id/log',writer,exclusive,express.json({limit:'2mb',inflate:false}),mutation(async(req,res)=>{
    const r=lookup(req),{code}=req.body||{};
    if(!validCode(code))throw error(400,'Invalid paste code');
    let text=req.body.text;
    if(text===undefined&&config.rawTemplate){
      const upstream=await fetchImpl(config.rawTemplate.replace('{code}',encodeURIComponent(code)),{redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!upstream.ok)throw error(502,'Configured Grim log endpoint failed');
      if(Number(upstream.headers.get('content-length'))>2000000)throw error(502,'Grim log too large');
      const reader=upstream.body.getReader(),parts=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw error(502,'Grim log too large');}parts.push(value);}}finally{reader.releaseLock();}
      text=Buffer.concat(parts).toString('utf8');
    }
    if(text!==undefined&&(typeof text!=='string'||text.length>2000000))throw error(400,'Invalid log text');
    const b=JSON.parse((await unzip(await store.read(r),{maxOutputLength:config.maxExpandedBytes})).toString());
    b.grimLog={code,text:text??(code===b.grimLog.code?b.grimLog.text:null)};
    const expanded=Buffer.from(JSON.stringify(b));
    if(expanded.length>config.maxExpandedBytes)throw error(413,'Updated bundle exceeds expanded size limit');
    const bytes=await zip(expanded,{level:3});
    if(bytes.length>config.maxUploadBytes)throw error(413,'Updated bundle exceeds upload limit');
    res.json(await store.replace(r,bytes,code));
  }));
  app.get('/api/settings',admin,(req,res)=>res.json({publicUrl:config.publicUrl,retentionHours:config.retentionHours,maxUploadBytes:config.maxUploadBytes,maxExpandedBytes:config.maxExpandedBytes,storage:{usedBytes:store.used(),maxBytes:config.maxBytes},sessionHours:config.sessionHours,maxConcurrentMutations:1,rawLogFetchConfigured:!!config.rawTemplate,uploadBusy:busy}));
  app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
  // The static shell contains no evidence or credentials; all data APIs require a session.
  app.use(express.static(config.webDir,{index:false}));
  app.get('/{*path}',(req,res,next)=>res.sendFile(path.join(config.webDir,'index.html'),err=>{if(err)next(err);}));
  app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err.status||500;if(status>=500)console.error('Request failed:',err.message);res.status(status).json({error:status===500?'Internal server error':err.message});});
  const cleanup=async()=>{if(busy)return;busy=true;try{await store.cleanup();}finally{busy=false;}};
  return {app,store,cleanup,waitForVideo};
}
