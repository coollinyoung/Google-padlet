import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/store.js';
import {newBoard,addPost} from '../server/domain.js';
import {DriveService} from '../server/drive.js';
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
