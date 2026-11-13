import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { open, rename, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(dir, maxBytes, retentionHours, now=Date.now) {
    this.dir=path.resolve(dir); this.maxBytes=maxBytes; this.retentionHours=retentionHours; this.now=now;
    mkdirSync(this.dir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.dir,'index.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, filename TEXT NOT NULL, digest TEXT NOT NULL, originalDigest TEXT NOT NULL, playerName TEXT, playerUuid TEXT, serverId TEXT, createdAt TEXT, expiresAt INTEGER, bytes INTEGER, code TEXT, "check" TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS incident_code ON incidents(code) WHERE code IS NOT NULL;
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth (token TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires INTEGER NOT NULL, returnTo TEXT NOT NULL DEFAULT '/');`);
    // Only files referenced by committed records survive restart. Crash remnants are safe to remove.
    const files=new Set(this.db.prepare('SELECT filename FROM incidents').all().map(r=>r.filename));
    for(const f of readdirSync(this.dir)) if((f.endsWith('.grimreplay')&&!files.has(f))||f.endsWith('.tmp')) unlinkSync(path.join(this.dir,f));
  }
  metadata(r) { if(!r) return null; const {filename,digest,originalDigest,...m}=r; return {...m,expiresAt:new Date(m.expiresAt).toISOString(),sha256:digest}; }
  get(id) { return this.db.prepare('SELECT * FROM incidents WHERE id=? AND expiresAt>?').get(id,this.now()); }
  resolve(code) { return this.db.prepare('SELECT * FROM incidents WHERE (id=? OR code=?) AND expiresAt>?').get(code,code,this.now()); }
  used() { return this.db.prepare('SELECT COALESCE(SUM(bytes),0) n FROM incidents').get().n; }
  list(search='') { return this.db.prepare('SELECT * FROM incidents WHERE expiresAt>? ORDER BY createdAt DESC').all(this.now()).filter(r=>`${r.playerName} ${r.playerUuid} ${r.code??''} ${r.id} ${r.serverId}`.toLowerCase().includes(search.toLowerCase())).map(r=>this.metadata(r)); }
  async atomicWrite(bytes) { const filename=`${randomUUID()}.grimreplay`; const temp=path.join(this.dir,filename+'.tmp'); const f=await open(temp,'wx',0o600); try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); } await rename(temp,path.join(this.dir,filename)); const d=await open(this.dir,'r'); try{await d.sync();}finally{await d.close();} return filename; }
  async insert(b,bytes) {
    const digest=hash(bytes), existing=this.db.prepare('SELECT * FROM incidents WHERE id=?').get(b.id);
    if(existing) { if(existing.originalDigest!==digest) throw Object.assign(new Error('Recording ID already contains different data'),{status:409}); return {id:b.id,duplicate:true}; }
    if(this.used()+bytes.length>this.maxBytes) throw Object.assign(new Error('Recording storage capacity reached'),{status:507});
    const filename=await this.atomicWrite(bytes);
    try { this.db.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(b.id,filename,digest,digest,b.player.name,b.player.uuid,b.serverId,b.createdAt,this.now()+this.retentionHours*3600000,bytes.length,b.grimLog.code||b.flags.find(f=>f.logCode)?.logCode||null,b.flags[0]?.check||'manual'); }
    catch(e){await unlink(path.join(this.dir,filename)); if(e.code?.includes('SQLITE')) throw Object.assign(new Error('Paste code already assigned'),{status:409});throw e;}
    return {id:b.id,duplicate:false};
  }
  async replace(r,bytes,code) {
    if(this.used()-r.bytes+bytes.length>this.maxBytes) throw Object.assign(new Error('Recording storage capacity reached'),{status:507});
    const filename=await this.atomicWrite(bytes);
    try{this.db.prepare('UPDATE incidents SET filename=?,digest=?,bytes=?,code=? WHERE id=?').run(filename,hash(bytes),bytes.length,code,r.id);}catch(e){await unlink(path.join(this.dir,filename)); throw Object.assign(new Error('Paste code already assigned'),{status:409});}
    await unlink(path.join(this.dir,r.filename)).catch(()=>{});
    return this.metadata(this.get(r.id));
  }
  async remove(id) {const r=this.db.prepare('SELECT * FROM incidents WHERE id=?').get(id); if(!r)return; this.db.prepare('DELETE FROM incidents WHERE id=?').run(id); await unlink(path.join(this.dir,r.filename)).catch(()=>{});}
  async cleanup() {for(const r of this.db.prepare('SELECT id FROM incidents WHERE expiresAt<=?').all(this.now()))await this.remove(r.id); this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now()); this.db.prepare('DELETE FROM oauth WHERE expires<=?').run(this.now());}
  read(r){return readFile(path.join(this.dir,r.filename));}
  close(){this.db.close();}
}
