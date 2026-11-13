import path from 'node:path';
export function configFromEnv(e=process.env) {
  const integer=(name,fallback,min=1,max=Number.MAX_SAFE_INTEGER)=>{const n=Number(e[name]??fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`Invalid ${name}`);return n;};
  const origin=new URL(e.PUBLIC_URL||'http://localhost:3000');
  if(!['http:','https:'].includes(origin.protocol)||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw Error('PUBLIC_URL must be a root HTTP(S) URL');
  if(origin.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw Error('PUBLIC_URL requires HTTPS except localhost');
  if(!e.INGEST_TOKEN||e.INGEST_TOKEN.length<32||/replace|change.?me|example|placeholder/i.test(e.INGEST_TOKEN))throw Error('INGEST_TOKEN must contain at least 32 characters');
  const allowlist=(e.DISCORD_ALLOWED_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!allowlist.length||allowlist.some(x=>!/^\d{17,20}$/.test(x)))throw Error('DISCORD_ALLOWED_IDS requires comma-separated Discord IDs');
  if(!e.DISCORD_CLIENT_ID||!e.DISCORD_CLIENT_SECRET)throw Error('Discord OAuth credentials required');
  const rawTemplate=e.GRIM_RAW_URL_TEMPLATE||'';
  if(rawTemplate) { const parsed=new URL(rawTemplate.replace('{code}','example')); if(rawTemplate.split('{code}').length!==2 || parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.hash) throw Error('GRIM_RAW_URL_TEMPLATE must be HTTPS with exactly one {code}, without credentials or fragment'); }
  return {port:integer('PORT',3000,1,65535),host:e.HOST||'127.0.0.1',publicUrl:origin.origin,secure:origin.protocol==='https:',ingestToken:e.INGEST_TOKEN,clientId:e.DISCORD_CLIENT_ID,clientSecret:e.DISCORD_CLIENT_SECRET,allowlist,rawTemplate,dataDir:path.resolve(e.DATA_DIR||'./data'),webDir:path.resolve(e.WEB_DIR||'../web/dist'),maxBytes:integer('MAX_STORAGE_BYTES',20*1024**3),maxUploadBytes:integer('MAX_UPLOAD_BYTES',32*1024**2,1024,128*1024**2),maxExpandedBytes:integer('MAX_EXPANDED_BYTES',128*1024**2,1024,512*1024**2),retentionHours:integer('RETENTION_HOURS',24,1,8760),sessionHours:integer('SESSION_HOURS',12,1,168)};
}
