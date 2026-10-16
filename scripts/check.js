import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const dir of ['server','public','scripts','tests'])for(const file of readdirSync(dir).filter(x=>x.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});if(result.status)process.exit(result.status);
}
console.log('JavaScript syntax checks passed.');
