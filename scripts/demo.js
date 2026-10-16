import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['server/index.js'],{stdio:'inherit',env:{...process.env,DEMO_MODE:'true',NODE_ENV:'development',HOST:'127.0.0.1',BASE_URL:'http://localhost:3000',PORT:'3000',DATA_DIR:'./demo-data'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));
