import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/store.js';
import {newBoard,addPost} from '../server/domain.js';
import {DriveService,driveDiagnosticError} from '../server/drive.js';
import {createApp} from '../server/app.js';
import {randomUUID} from 'node:crypto';

function setup(t){
  const dir=mkdtempSync(path.join(tmpdir(),'gp-drive-')),store=new Store(dir),user={id:'teacher',teacher:true,email:'teacher@example.edu.tw',name:'老師'};
  store.putUser(user);const b=newBoard(user,{title:'自然觀察'},'example.edu.tw');store.create(b);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {store,user,b,dir};
}
function fakeDrive(){
  const items=new Map();let beforeMedia,failMedia=false;
  return {items,setBeforeMedia(fn){beforeMedia=fn;},failMedia(){failMedia=true;},files:{
    async list({q}){const key=q.match(/value='([^']+)'/)[1],parent=q.match(/and '([^']+)' in parents/)?.[1];
      return {data:{files:[...items.values()].filter(x=>x.appProperties?.gpKey===key&&!x.trashed&&(!parent||x.parents?.includes(parent))).map(x=>({id:x.id}))}};},
    async create({requestBody,media}){const id=randomUUID(),item={...requestBody,id};if(media){if(failMedia)throw new Error('offline');let content='';for await(const part of media.body)content+=part;item.content=content;if(beforeMedia){const fn=beforeMedia;beforeMedia=null;fn();}}
      items.set(id,item);return {data:{id}};},
    async get({fileId}){const data=items.get(fileId);if(!data)throw new Error('not found');return {data};},
    async update({fileId,requestBody,media}){const item=items.get(fileId);if(!item)throw new Error('not found');Object.assign(item,requestBody);if(media){if(failMedia)throw new Error('offline');let content='';for await(const part of media.body)content+=part;item.content=content;}return {data:item};}
  }};
}

test('Drive creates exactly one matching folder; retry reuses IDs; rename preserves identity',async t=>{
  const {store,user,b}=setup(t),fake=fakeDrive(),drive=new DriveService(store,{});drive.client=()=>fake;
  await Promise.all([drive.sync(b.id),drive.sync(b.id)]);
  assert.equal([...fake.items.values()].filter(x=>x.name==='Google Padlet').length,1);
  assert.equal([...fake.items.values()].filter(x=>x.name==='自然觀察').length,1);
  assert.equal([...fake.items.values()].filter(x=>x.name==='data.json').length,1);
  const info=JSON.parse(store.row(b.id).drive);
  store.mutate(b.id,user.id,randomUUID(),'rename',board=>{board.title='新的名稱';});
  await drive.sync(b.id);
  assert.equal(fake.items.get(info.folderId).name,'新的名稱');
  assert.equal(store.row(b.id).sync_version,2);
  const file={originalname:'照片.png',mimetype:'image/png',buffer:Buffer.from('image')};
  const a=await drive.upload(b,file,'file-operation'),again=await drive.upload(b,file,'file-operation');assert.equal(a,again);
  assert.deepEqual(fake.items.get(a).parents,[info.attachments]);
  assert.ok(!('permissions' in fake.items.get(a)));
});

test('Drive snapshot version cannot falsely acknowledge a concurrent new post',async t=>{
  const {store,user,b}=setup(t),fake=fakeDrive(),drive=new DriveService(store,{});drive.client=()=>fake;
  fake.setBeforeMedia(()=>store.mutate(b.id,user.id,randomUUID(),'post.create',board=>addPost(board,user,{body:'同步途中新增'})));
  await drive.sync(b.id);
  assert.equal(store.row(b.id).version,2);assert.equal(store.row(b.id).sync_version,1);
  await drive.sync(b.id);assert.equal(store.row(b.id).sync_version,2);
  const snapshot=JSON.parse([...fake.items.values()].find(x=>x.name==='data.json').content);assert.equal(snapshot.posts.length,1);
});

test('Drive failure leaves unsynced version pending; deleted folder is not silently replaced',async t=>{
  const {store,user,b}=setup(t),fake=fakeDrive(),drive=new DriveService(store,{});drive.client=()=>fake;
  await drive.sync(b.id);const folder=JSON.parse(store.row(b.id).drive).folderId;
  store.mutate(b.id,user.id,randomUUID(),'post.create',board=>addPost(board,user,{body:'未同步'}));
  fake.failMedia();await assert.rejects(drive.sync(b.id));assert.equal(store.row(b.id).sync_version,1);
  fake.items.get(folder).trashed=true;await assert.rejects(drive.sync(b.id),/資料夾/);
  assert.equal([...fake.items.values()].filter(x=>x.name===b.title).length,1);
});

test('background worker records failures and applies retry backoff',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'gp-worker-')),store=new Store(dir);let calls=0;
  const user={id:'owner',teacher:true};store.putUser(user);const b=newBoard(user,{title:'測試'},'example.edu.tw');store.create(b);
  const built=createApp({demo:false,dataDir:dir,baseUrl:'http://localhost:3000'},{store,drive:{async sync(){calls++;throw new Error('quota');}}});
  t.after(()=>{built.close();rmSync(dir,{recursive:true,force:true});});
  await built.tick();await built.tick();assert.equal(calls,1);assert.equal(store.row(b.id).sync_version,0);assert.match(store.row(b.id).sync_error,/同步失敗/);
});

test('Drive diagnostics checks authenticated account without creating files, detects quota and missing root',async t=>{
  const {store,user}=setup(t),drive=new DriveService(store,{});
  assert.equal((await drive.diagnose(user.id)).code,'NOT_CONNECTED');store.credentials(user.id,'placeholder');
  let account=user.email,quota={usage:'1',limit:'100'},checks=0;
  drive.client=()=>({about:{async get({fields}){assert.equal(fields,'user(emailAddress),storageQuota(limit,usage)');return {data:{user:{emailAddress:account},storageQuota:quota}};}},files:{async get(){checks++;throw Object.assign(new Error('private secret'),{code:404});}}});
  assert.equal((await drive.diagnose(user.id)).code,'CONNECTED');assert.equal(checks,0);
  account='another@example.edu.tw';assert.equal((await drive.diagnose(user.id)).code,'ACCOUNT_MISMATCH');account=user.email;
  quota={usage:'100',limit:'100'};assert.equal((await drive.diagnose(user.id)).code,'STORAGE_FULL');quota={usage:'100'};
  assert.equal((await drive.diagnose(user.id)).ok,true);
  store.root(user.id,'missing-root');const result=await drive.diagnose(user.id);assert.equal(result.code,'FOLDER_UNAVAILABLE');assert.ok(!JSON.stringify(result).includes('secret'));
});

test('Drive diagnostics requires teacher session and reports demo honestly',async t=>{
  const {store,user,dir}=setup(t),system=createApp({demo:true,baseUrl:'http://localhost:3000',dataDir:dir},{store});
  const student={id:'student',teacher:false};store.putUser(student);
  const server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{system.stop();await new Promise(r=>server.close(r));});
  const url='http://127.0.0.1:'+server.address().port+'/api/drive/check';
  async function check(u){const r=await fetch(url,{method:'POST',headers:{Origin:'http://localhost:3000',...(u?{Cookie:'gp_session='+store.newSession(u.id)}:{})}});return {status:r.status,data:await r.json()};}
  assert.equal((await check()).status,401);assert.equal((await check(student)).status,403);assert.equal((await check(user)).data.code,'DEMO');
});

test('Drive diagnosis sanitizes authorization, policy and rate errors',()=>{
  for(const [error,code] of [
    [{response:{status:400,data:{error:'invalid_grant',error_description:'private'}}},'REAUTHORIZE'],
    [{response:{status:403,data:{error:{errors:[{reason:'storageQuotaExceeded'}]}}}},'STORAGE_FULL'],
    [{response:{status:403,data:{error:'private'}}},'ACCESS_DENIED'],
    [{response:{status:429,data:{error:'private'}}},'RATE_LIMIT'],
    [new Error('private'),'CONNECTION_FAILED']
  ]){const result=driveDiagnosticError(error);assert.equal(result.code,code);assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('private'));}
});
