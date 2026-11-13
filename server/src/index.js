import { configFromEnv } from './config.js';
import { createApp } from './app.js';
const config=configFromEnv();
const {app,store,cleanup}=createApp(config);
await cleanup();
const timer=setInterval(()=>cleanup().catch(e=>console.error('Cleanup failed:',e.message)),60000);timer.unref();
const server=app.listen(config.port,config.host,()=>console.log(`Replay API listening on ${config.host}:${config.port}`));
server.requestTimeout=120000;server.headersTimeout=15000;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(timer);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
