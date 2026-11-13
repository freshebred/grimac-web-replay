import '@fontsource/chivo/latin-400.css';
import '@fontsource/chivo/latin-500.css';
import '@fontsource/chivo-mono/latin-400.css';
import './style.css';
import {MAX_COMPRESSED} from './bundle.js';
import {frameAt} from './world.js';
const app=document.querySelector('#app');
let user=null,viewer=null,activeBlob=null,activeMeta=null,worker=null,loadSerial=0,videoPollTimer=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=v=>new Date(v).toLocaleString();
const fmtBytes=v=>`${((v||0)/1024/1024).toFixed(1)} MiB`;
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options});if(!r.ok){let m;try{const b=await r.json();m=b.error||b.message;}catch{}throw new Error(m||`Request failed (${r.status})`);}return r.json();}
function shell(content){clearTimeout(videoPollTimer);videoPollTimer=null;viewer?.dispose();viewer=null;app.innerHTML=`<header class="topbar"><a class="wordmark" href="/">Grim <span>Replay</span></a><nav aria-label="Account">${user?`<button id="settings">Settings</button><span class="username">${esc(user.username)}</span><button id="logout">Sign out</button>`:''}</nav></header><main id="main">${content}</main><div id="toast" role="status" aria-live="polite"></div>`;document.querySelector('#logout')?.addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST'});location.assign('/');}catch(e){notify(e.message);}});document.querySelector('#settings')?.addEventListener('click',settings);document.documentElement.dataset.ready='1';}
function notify(message){const node=document.querySelector('#toast');node.textContent=message;node.classList.add('visible');clearTimeout(notify.timer);notify.timer=setTimeout(()=>node.classList.remove('visible'),8000);}
function bindImport(){document.querySelector('#file')?.addEventListener('change',e=>{const f=e.target.files[0];if(f)openBlob(f,null);});}
const importControl=`<label class="button primary import" for="file">Open local replay<input id="file" type="file" accept=".grimreplay,application/gzip,application/octet-stream"></label>`;
async function showList(){
 shell(`<div class="page-heading"><div><p class="eyebrow">Evidence library</p><h1>Incidents</h1></div><div class="actions">${importControl}<button id="refresh">Refresh list</button></div></div><div class="filterbar"><label>Player, code or server<input id="search" type="search" placeholder="Search incidents" autocomplete="off"></label><p id="storage" class="muted"></p></div><div id="results" aria-live="polite"><p class="empty">Loading incidents…</p></div>`);
 bindImport();let request=0;async function refresh(){const seq=++request;try{const data=await api(`/api/incidents?search=${encodeURIComponent(document.querySelector('#search').value)}`);if(seq!==request||!document.querySelector('#results'))return;document.querySelector('#storage').textContent=`${data.retentionHours}h retention · ${fmtBytes(data.storage.usedBytes)} / ${fmtBytes(data.storage.maxBytes)}`;document.querySelector('#results').innerHTML=data.incidents.length?`<div class="incident-table"><div class="table-head"><span>Player / check</span><span>Recorded</span><span>Code / server</span><span>Size</span></div>${data.incidents.map(i=>`<a class="incident-row" href="/${encodeURIComponent(i.code||i.id)}"><div><strong>${esc(i.playerName)}</strong><span>${esc(i.check||'Manual recording')}${i.videoReady?' · 5-Cam MP4 ready':''}</span></div><div>${esc(fmtDate(i.createdAt))}<small>Expires ${esc(fmtDate(i.expiresAt))}</small></div><div class="mono">${esc(i.code||i.id.slice(0,8))}<small>${esc(i.serverId)}</small></div><div>${fmtBytes(i.bytes)} <span class="row-arrow" aria-hidden="true">↗</span></div></a>`).join('')}</div>`:`<div class="empty"><h2>${document.querySelector('#search').value?'No matching incidents':'No recordings yet'}</h2><p>${document.querySelector('#search').value?'Try another player or code.':'Recordings uploaded by your server appear here.'}</p></div>`;}catch(e){document.querySelector('#results').innerHTML=`<p class="error" role="alert">${esc(e.message)}</p>`;}}
 document.querySelector('#refresh').onclick=refresh;let timer;document.querySelector('#search').oninput=()=>{clearTimeout(timer);timer=setTimeout(refresh,250);};await refresh();
}
async function settings(){try{const data=await api('/api/settings');const d=document.createElement('dialog');d.className='settings-dialog';d.innerHTML=`<form method="dialog"><div class="dialog-heading"><h2>Server settings</h2><button>Close settings</button></div><p class="muted">Effective configuration. Edit the VPS environment or use the recorder commands to change settings.</p><pre>${esc(JSON.stringify(data,null,2))}</pre></form>`;document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();}catch(e){notify(e.message);}}
async function resolveCode(code){shell(`<div class="page-heading"><h1>Open incident</h1><a class="button" href="/">Back to incidents</a></div><p class="empty">Loading recording…</p>`);try{const result=await api(`/api/resolve/${encodeURIComponent(code)}`);if(!result.incident){shell(`<div class="page-heading"><h1>No world recording available</h1><a class="button" href="/">Back to incidents</a></div><p class="muted">This code has no retained recording. Open a downloaded replay to review an expired incident.</p>${importControl}${result.log?.text?`<h2>Grim log</h2><pre class="log">${esc(result.log.text)}</pre>`:''}`);bindImport();return;}const response=await fetch(`/api/incidents/${encodeURIComponent(result.incident.id)}/bundle`);if(!response.ok)throw new Error(`Recording download failed (${response.status}).`);if(Number(response.headers.get('Content-Length'))>MAX_COMPRESSED)throw new Error('Recording exceeds the 32 MiB browser limit. Download it from the incident API for offline processing.');await openBlob(await readLimited(response),result.incident);}catch(e){shell(`<div class="page-heading"><h1>Recording unavailable</h1><a class="button" href="/">Back to incidents</a></div><p class="error" role="alert">${esc(e.message)}</p>${importControl}`);bindImport();}}
async function readLimited(response){const reader=response.body.getReader(),parts=[];let n=0;try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>MAX_COMPRESSED){await reader.cancel();throw new Error('Recording exceeds the 32 MiB browser limit.');}parts.push(value);}}finally{reader.releaseLock();}return new Blob(parts,{type:'application/octet-stream'});}
async function openBlob(blob,meta){
 const serial=++loadSerial;if(blob.size>MAX_COMPRESSED){notify('Replay exceeds the 32 MiB browser limit.');return;}worker?.terminate();
 shell(`<div class="page-heading"><div><p class="eyebrow">Processing replay</p><h1 id="load-title">Decoding replay bundle…</h1></div><a class="button" href="/">Cancel</a></div><div class="empty"><h2 id="load-step">Decompressing and validating world snapshots…</h2><p class="muted">Please wait until all snapshots from start to end are processed and the 3D scene is ready.</p></div>`);
 try{
  const buffer=await blob.arrayBuffer();
  const bundle=await new Promise((resolve,reject)=>{const current=new Worker(new URL('./decode.worker.js',import.meta.url),{type:'module'});worker=current;const cleanup=()=>{current.terminate();if(worker===current)worker=null;};const timer=setTimeout(()=>{cleanup();reject(new Error('Replay decoding timed out.'));},30000);current.onmessage=({data})=>{clearTimeout(timer);cleanup();data.error?reject(new Error(data.error)):resolve(data.bundle);};current.onerror=()=>{clearTimeout(timer);cleanup();reject(new Error('Could not decode replay.'));};current.postMessage(buffer,[buffer]);});
  if(serial!==loadSerial)return;
  const titleEl=document.querySelector('#load-title'),stepEl=document.querySelector('#load-step');
  if(titleEl)titleEl.textContent=`Building 3D world for ${bundle.player.name}…`;
  if(stepEl)stepEl.textContent=`Processing ${bundle.snapshots.length} terrain snapshots (${bundle.startTick} → ${bundle.endTick} ticks)…`;
  await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  if(serial!==loadSerial)return;
  activeBlob=blob;activeMeta=meta;
  await showReplay(bundle,meta);
 }catch(e){if(serial===loadSerial){shell(`<div class="page-heading"><h1>Replay failed to load</h1><a class="button" href="/">Back to incidents</a></div><p class="error" role="alert">${esc(e.message)}</p>${importControl}`);bindImport();}}
}
function formatEventLabel(ev){
 if(ev.type==='attack')return{title:`Hit ${ev.targetName||'entity'}`,sub:`Tick ${ev.tick}${ev.distance!=null?` · Reach ${ev.distance.toFixed(2)}m`:''}`};
 if(ev.type==='hurt')return{title:`Hurt${ev.attackerName?` by ${ev.attackerName}`:''}`,sub:`Tick ${ev.tick}`};
 if(ev.type==='place'||ev.type==='break'||ev.type==='interact'){
  const blk=(ev.state||'block').replace(/^minecraft:/,'').split('[')[0];
  return{title:`${ev.type[0].toUpperCase()+ev.type.slice(1)} ${blk}`,sub:`Tick ${ev.tick}${ev.x!=null?` · ${ev.x}, ${ev.y}, ${ev.z}`:''}`};
 }
 return{title:ev.type.replace('_',' '),sub:`Tick ${ev.tick}${ev.item?` · ${ev.item.replace(/^minecraft:/,'')}`:''}`};
}
async function showReplay(bundle,meta){
 const warnings=['Server world recording; not the player’s exact client view.','Generic block geometry. Stair corners, connected shapes, fluids and custom blocks are approximate. Player outline is not a collision verdict.',...bundle.warnings];
 const events=bundle.events||[];
 const entities=bundle.entities||[];
 const {ReplayViewer}=await import('./viewer.js');
 shell(`<div class="replay-heading"><div><a class="back-link" href="/">← Incidents</a><h1>${esc(bundle.player.name)} <span class="muted">/ ${esc(meta?.code||bundle.grimLog?.code||'Local replay')}</span></h1><p class="muted">${esc(bundle.serverId)} · ${esc(bundle.dimension)} · ${esc(fmtDate(bundle.createdAt))}</p></div><div class="actions"><button id="download" class="primary">Download replay</button>${meta?'<button id="link-log">Link Grim log</button><button id="delete" class="danger">Delete recording</button>':importControl}</div></div><div class="replay-layout"><section class="stage-shell" aria-label="Replay"><div class="stage-toolbar"><div class="camera-tools"><button id="mode-3d" aria-pressed="true" disabled>Interactive 3D</button><button id="mode-video" aria-pressed="false" disabled>5-Cam Video (3×3)</button><button id="camera" aria-pressed="false" disabled>Follow player</button><button id="reset" disabled>Reset camera</button></div><output id="position" class="mono">Processing snapshots…</output></div><div id="video-banner" class="video-banner" hidden role="status" aria-live="polite"></div><div id="stage"><p class="canvas-fallback">Rendering world through tick ${bundle.endTick}…</p></div><div class="transport"><div class="transport-buttons"><button id="play" class="primary" disabled>Play replay</button><button id="prev" aria-label="Previous tick" disabled>−1 tick</button><button id="next" aria-label="Next tick" disabled>+1 tick</button><label class="speed">Speed<select id="speed" disabled><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label><output id="tick" class="mono"></output></div><label class="timeline-label" for="timeline">Timeline <span id="duration"></span></label><input id="timeline" type="range" min="${bundle.startTick}" max="${bundle.endTick}" value="${bundle.startTick}" step="1" disabled></div></section><aside class="inspector"><h2>Flags <span class="muted">${bundle.flags.length}</span></h2><div class="flags">${bundle.flags.map((f,i)=>`<button data-flag="${i}" disabled><strong>${esc(f.check)}</strong><span>Tick ${f.tick} · VL ${esc(f.vl??'—')}</span>${f.verbose?`<small>${esc(f.verbose)}</small>`:''}</button>`).join('')||'<p class="muted">No flags recorded.</p>'}</div><details class="details" open><summary>Combat &amp; actions <span class="muted">${events.length}</span></summary><div class="flags">${events.map((ev,i)=>{const lbl=formatEventLabel(ev);return `<button data-event="${i}" disabled><strong>${esc(lbl.title)}</strong><span>${esc(lbl.sub)}</span></button>`;}).join('')||'<p class="muted">No discrete interaction events recorded.</p>'}</div></details><details class="details"${entities.length?' open':''}><summary>Nearby entities <span class="muted">${entities.length}</span></summary><div class="flags">${entities.map((e,i)=>`<button data-entity="${i}" disabled><strong>${esc(e.name||e.type)}</strong><span>${esc(e.type.replace(/^minecraft:/,''))} · ${e.frames.length} ticks</span></button>`).join('')||'<p class="muted">No other entities captured in range.</p>'}</div></details><details class="details"><summary>Recording details</summary><dl><dt>Player UUID</dt><dd class="mono">${esc(bundle.player.uuid)}</dd><dt>Incident ID</dt><dd class="mono">${esc(bundle.id)}</dd><dt>Movement frames</dt><dd>${bundle.frames.length}</dd><dt>Block changes</dt><dd>${bundle.blockChanges.length}</dd><dt>Tracked entities</dt><dd>${entities.length}</dd><dt>Action events</dt><dd>${events.length}</dd><dt>Camera</dt><dd>Drag to orbit · right-drag to pan · scroll to zoom</dd></dl></details><details class="details warnings" open><summary>Recording limits</summary><ul id="warnings">${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details><details class="details"><summary>Grim log</summary><pre class="log">${esc(bundle.grimLog?.text||'No Grim log attached.')}</pre></details></aside></div>`);
 document.querySelector('#duration').textContent=`${((bundle.endTick-bundle.startTick)/bundle.tickRate).toFixed(1)} seconds`;
 document.querySelector('#download').onclick=()=>{const url=URL.createObjectURL(activeBlob);const a=document.createElement('a');a.href=url;a.download=`${bundle.id.replace(/[^a-zA-Z0-9_-]/g,'_')}.grimreplay`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 document.querySelector('#delete')?.addEventListener('click',()=>deleteIncident(meta));document.querySelector('#link-log')?.addEventListener('click',()=>linkLog(meta));bindImport();
 try{
  const stage=document.querySelector('#stage');stage.replaceChildren();
  let videoEl=null,matrixOverlay=null,usingVideoMode=false;

  const updateHud=(tick,f)=>{
   document.querySelector('#tick').textContent=`Tick ${tick}`;
   const stateTags=[];
   if(f.hurt)stateTags.push('HURT');
   if(f.swinging)stateTags.push('SWING');
   if(f.using)stateTags.push('USING');
   const extra=stateTags.length?` · ${stateTags.join('/')}`:'';
   document.querySelector('#position').textContent=`${f.x.toFixed(2)} / ${f.y.toFixed(2)} / ${f.z.toFixed(2)}${extra}`;
   document.querySelector('#timeline').value=tick;
   document.querySelector('#play').textContent=viewer?.playing?'Pause replay':'Play replay';
   if(videoEl&&usingVideoMode&&meta?.videoReady){
    const targetTime=Math.max(0,(tick-bundle.startTick)/bundle.tickRate);
    if(Math.abs(videoEl.currentTime-targetTime)>0.15){try{videoEl.currentTime=targetTime;}catch{}}
   }
   if(matrixOverlay){
    const activeEnts=entities.filter(e=>e.frames.length&&tick>=e.frames[0].tick-5&&tick<=e.frames[e.frames.length-1].tick+20);
    const recentEv=events.filter(ev=>ev.tick<=tick).slice(-3).reverse();
    const hudTl=matrixOverlay.querySelector('[data-cell="tl"]');
    const hudTr=matrixOverlay.querySelector('[data-cell="tr"]');
    const hudBl=matrixOverlay.querySelector('[data-cell="bl"]');
    const hudBr=matrixOverlay.querySelector('[data-cell="br"]');
    if(hudTl)hudTl.innerHTML=`<strong>PLAYER TELEMETRY</strong><span>Tick ${tick} / ${bundle.endTick}</span><span>XYZ: ${f.x.toFixed(1)}, ${f.y.toFixed(1)}, ${f.z.toFixed(1)}</span><span>Yaw ${f.yaw.toFixed(0)}° · Pitch ${f.pitch.toFixed(0)}° · ${esc(f.pose||'standing')}</span>`;
    if(hudTr)hudTr.innerHTML=`<strong>ENTITIES NEARBY (${activeEnts.length})</strong>${activeEnts.slice(0,2).map(e=>{const ef=frameAt(e.frames,tick);const d=Math.hypot(ef.x-f.x,ef.y-f.y,ef.z-f.z);return `<span>${esc(e.name||e.type.replace(/^minecraft:/,''))}: ${d.toFixed(2)}m${ef.hurt?' (HURT)':''}</span>`;}).join('')||'<span>None in range</span>'}`;
    if(hudBl)hudBl.innerHTML=`<strong>RECENT ACTIONS</strong>${recentEv.map(ev=>{const l=formatEventLabel(ev);return `<span>${esc(l.title)} (${esc(l.sub)})</span>`;}).join('')||'<span>No actions at tick</span>'}`;
    if(hudBr)hudBr.innerHTML=`<strong>GRIM FLAGS (${bundle.flags.length})</strong>${bundle.flags.slice(0,2).map(fl=>`<span>T${fl.tick}: ${esc(fl.check)} (VL ${esc(fl.vl??0)})</span>`).join('')||'<span>No flags</span>'}`;
   }
  };

  viewer=new ReplayViewer(stage,bundle,updateHud,warning=>{const list=document.querySelector('#warnings');if([...list.children].some(n=>n.textContent===warning))return;const li=document.createElement('li');li.textContent=warning;list.append(li);});

  const ensureMatrixDom=()=>{
   if(matrixOverlay)return;
   matrixOverlay=document.createElement('div');
   matrixOverlay.className='matrix-overlay';
   matrixOverlay.innerHTML=`
    <div class="matrix-corner" data-cell="tl"></div>
    <div class="matrix-cam" data-cam="north"><span>N · North 3rd Person</span></div>
    <div class="matrix-corner" data-cell="tr"></div>
    <div class="matrix-cam" data-cam="west"><span>W · West 3rd Person</span></div>
    <div class="matrix-cam matrix-pov" data-cam="pov"><span>1st Person POV (2;2)</span></div>
    <div class="matrix-cam" data-cam="east"><span>E · East 3rd Person</span></div>
    <div class="matrix-corner" data-cell="bl"></div>
    <div class="matrix-cam" data-cam="south"><span>S · South 3rd Person</span></div>
    <div class="matrix-corner" data-cell="br"></div>`;
   stage.append(matrixOverlay);
  };

  const attachServerVideo=()=>{
   if(!meta?.videoReady||videoEl)return;
   const v=document.createElement('video');
   v.id='server-video';
   v.className='server-video';
   v.src=`/api/incidents/${encodeURIComponent(meta.id)}/video`;
   v.muted=true;
   v.playsInline=true;
   v.preload='auto';
   v.style.display='none';
   v.addEventListener('loadedmetadata',()=>{try{v.currentTime=Math.max(0.001,(viewer.tick-bundle.startTick)/bundle.tickRate);}catch{}});
   v.addEventListener('loadeddata',()=>{
    if(usingVideoMode&&videoEl===v){
     v.style.display='block';
     viewer.renderer.domElement.style.display='none';
    }
   });
   v.addEventListener('error',()=>{
    if(videoEl===v){
     v.remove();
     videoEl=null;
     meta.videoReady=false;
     meta.videoStatus='failed';
     viewer.renderer.domElement.style.display='block';
     syncBanner();
     viewer.draw();
    }
   });
   videoEl=v;
   stage.prepend(v);
  };

  const syncBanner=()=>{
   const banner=document.querySelector('#video-banner');
   if(!usingVideoMode){banner.hidden=true;return;}
   banner.hidden=false;
   if(!meta){
    banner.textContent='Local replay file — server MP4 is only generated for uploaded VPS incidents. Showing live 5-camera 3×3 matrix.';
   }else if(meta.videoReady){
    banner.textContent='Playing server-rendered 5-camera 3×3 MP4 footage (N, W, 1st-Person POV at 2;2, E, S).';
    attachServerVideo();
   }else if(meta.videoStatus==='failed'){
    banner.textContent='Server MP4 encoding unavailable on VPS (install ffmpeg); displaying live 5-camera 3×3 matrix.';
   }else{
    banner.textContent=`Server 5-camera MP4 footage is not ready yet (${meta.videoStatus||'rendering'} on VPS)… Showing live 5-camera 3×3 preview until ready.`;
   }
  };

  const pollVideoStatus=async()=>{
   if(!meta||meta.videoReady||meta.videoStatus==='failed')return;
   try{
    const latest=await api(`/api/incidents/${encodeURIComponent(meta.id)}`);
    meta.videoStatus=latest.videoStatus;
    meta.videoReady=latest.videoReady;
    syncBanner();
    if(meta.videoReady){notify('Server 5-camera MP4 footage is now ready.');return;}
    if(meta.videoStatus==='failed')return;
   }catch{}
   videoPollTimer=setTimeout(pollVideoStatus,1500);
  };

  const setMode=videoMode=>{
   usingVideoMode=videoMode;
   document.querySelector('#mode-3d').setAttribute('aria-pressed',String(!videoMode));
   document.querySelector('#mode-video').setAttribute('aria-pressed',String(videoMode));
   document.querySelector('#camera').disabled=videoMode;
   document.querySelector('#reset').disabled=videoMode;
   ensureMatrixDom();
   matrixOverlay.style.display=videoMode?'grid':'none';
   viewer.matrixMode=videoMode;
   if(videoMode&&meta?.videoReady){
    attachServerVideo();
    if(videoEl&&videoEl.readyState>=2){
     videoEl.style.display='block';
     viewer.renderer.domElement.style.display='none';
    }else{
     viewer.renderer.domElement.style.display='block';
    }
   }else{
    if(videoEl)videoEl.style.display='none';
    viewer.renderer.domElement.style.display='block';
   }
   syncBanner();
   if(videoMode&&meta&&!meta.videoReady&&meta.videoStatus!=='failed')pollVideoStatus();
   viewer.seek(viewer.tick);
  };

  document.querySelectorAll('.transport button,.transport input,.transport select,.camera-tools button,[data-flag],[data-event],[data-entity]').forEach(b=>b.disabled=false);
  document.querySelector('#mode-3d').onclick=()=>setMode(false);
  document.querySelector('#mode-video').onclick=()=>setMode(true);
  if(meta)setMode(true);
  document.querySelector('#play').onclick=()=>{
   if(viewer.tick===bundle.endTick)viewer.seek(bundle.startTick);
   viewer.playing=!viewer.playing;
   if(videoEl&&usingVideoMode){viewer.playing?videoEl.play().catch(()=>{}):videoEl.pause();}
   document.querySelector('#play').textContent=viewer.playing?'Pause replay':'Play replay';
  };
  document.querySelector('#prev').onclick=()=>{viewer.playing=false;videoEl?.pause();viewer.seek(viewer.tick-1);};
  document.querySelector('#next').onclick=()=>{viewer.playing=false;videoEl?.pause();viewer.seek(viewer.tick+1);};
  document.querySelector('#timeline').oninput=e=>{viewer.playing=false;videoEl?.pause();viewer.seek(Number(e.target.value));};
  document.querySelector('#speed').onchange=e=>{viewer.speed=Number(e.target.value);if(videoEl)videoEl.playbackRate=viewer.speed;};
  document.querySelector('#camera').onclick=e=>{viewer.follow=!viewer.follow;e.currentTarget.setAttribute('aria-pressed',viewer.follow);e.currentTarget.textContent=viewer.follow?'Free camera':'Follow player';};
  document.querySelector('#reset').onclick=()=>viewer.resetCamera();
  document.querySelectorAll('[data-flag]').forEach(b=>b.onclick=()=>{viewer.playing=false;videoEl?.pause();viewer.seek(bundle.flags[Number(b.dataset.flag)].tick);});
  document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{viewer.playing=false;videoEl?.pause();viewer.seek(events[Number(b.dataset.event)].tick);});
  document.querySelectorAll('[data-entity]').forEach(b=>b.onclick=()=>{viewer.playing=false;videoEl?.pause();const ent=entities[Number(b.dataset.entity)];if(ent?.frames?.length)viewer.seek(ent.frames[0].tick);});
 }catch(e){document.querySelector('#stage').innerHTML=`<div class="canvas-fallback"><h2>3D view unavailable</h2><p>${esc(e.message)}</p><p>Enable WebGL in your browser. The log and download remain available.</p></div>`;document.querySelectorAll('.transport button,.transport input,.transport select,.camera-tools button,[data-flag],[data-event],[data-entity]').forEach(b=>b.disabled=true);}
}
function deleteIncident(meta){const d=document.createElement('dialog');d.innerHTML=`<form method="dialog"><h2>Delete this recording?</h2><p>This permanently removes the stored replay for ${esc(meta.playerName)}. Download a copy first if you need to keep it.</p><div class="actions"><button value="cancel">Cancel deletion</button><button id="confirm-delete" class="danger" type="button">Delete recording</button></div><p id="delete-error" role="alert"></p></form>`;document.body.append(d);d.showModal();d.addEventListener('close',()=>d.remove());d.querySelector('#confirm-delete').onclick=async()=>{try{await api(`/api/incidents/${encodeURIComponent(meta.id)}`,{method:'DELETE'});location.assign('/');}catch(e){d.querySelector('#delete-error').textContent=e.message;}};}
function linkLog(meta){const d=document.createElement('dialog');d.innerHTML=`<form id="log-form"><h2>Link Grim log</h2><label>Paste code<input name="code" required maxlength="128" pattern="[a-zA-Z0-9_-]+" value="${esc(meta.code||'')}"></label><label>Log text<textarea name="text" rows="8" maxlength="2000000"></textarea></label><p class="muted">Paste the complete log to include it in downloaded replays. Leave empty only if the VPS has a verified Grim retrieval URL configured.</p><div class="actions"><button id="cancel-log" type="button">Cancel linking</button><button class="primary">Save Grim log</button></div><p id="log-error" role="alert"></p></form>`;document.body.append(d);d.showModal();d.addEventListener('close',()=>d.remove());d.querySelector('#cancel-log').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/incidents/${encodeURIComponent(meta.id)}/log`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:f.get('code'),...(f.get('text')?{text:f.get('text')}:{})})});d.close();await resolveCode(f.get('code'));}catch(err){d.querySelector('#log-error').textContent=err.message;}};}
async function boot(){try{const me=await fetch('/api/me',{credentials:'same-origin'});if(me.ok)user=(await me.json()).user;else if(me.status!==401)throw new Error(`Authentication service unavailable (${me.status}).`);if(!user){shell(`<section class="login"><p class="eyebrow">Admin access</p><h1>Incident replay</h1><p>Sign in with an approved Discord account.</p><a class="button primary" href="/auth/discord?returnTo=${encodeURIComponent(location.pathname)}">Sign in with Discord</a></section>`);return;}const code=decodeURIComponent(location.pathname.slice(1));if(code)await resolveCode(code);else await showList();}catch(e){shell(`<section class="login"><h1>Connection unavailable</h1><p class="error" role="alert">${esc(e.message)}</p><a class="button" href="/">Retry connection</a></section>`);}}
boot();
