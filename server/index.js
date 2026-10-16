import {readConfig} from './config.js';
import {createApp} from './app.js';
const config=readConfig();
const {app,startSync,stop,drain,close}=createApp(config);
const server=app.listen(config.port,config.host,()=>{console.log(`Google Padlet v0.3.0 — ${config.baseUrl}${config.demo?'（本機示範，未連接 Drive）':''}`);startSync();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop();server.close(async()=>{await drain();close();process.exit(0);});});
server.requestTimeout=120000;
