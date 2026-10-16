import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {newBoard,csvCell} from '../server/domain.js';

async function setup(t){
  const dir=mkdtempSync(path.join(tmpdir(),'gp-manage-'));
  const system=createApp({demo:true,baseUrl:'http://localhost:3000',dataDir:dir,defaultDomain:'school.edu.tw'});
  const teacher={id:'teacher',name:'老師',email:'t@school.edu.tw',hd:'school.edu.tw',teacher:true};
  const student={id:'student',name:'學生',email:'s@school.edu.tw',hd:'school.edu.tw',teacher:false};
  const other={id:'other',name:'另一位教師',email:'o@school.edu.tw',hd:'school.edu.tw',teacher:true};
  const users={teacher,student,other},sessions={};
  for(const [key,u] of Object.entries(users)){system.store.putUser(u);sessions[key]='gp_session='+system.store.newSession(u.id);}
  const b=newBoard(teacher,{title:'管理測試'},'school.edu.tw');system.store.create(b);
  const server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{system.stop();await new Promise(r=>server.close(r));system.close();rmSync(dir,{recursive:true,force:true});});
  async function call(route='',method='GET',body,role='teacher',key=randomUUID()){
    const r=await fetch(base+'/api/boards/'+b.id+route,{method,headers:{Cookie:sessions[role],Origin:'http://localhost:3000','Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text()};
  }
  async function settings(changes){const current=await call();return call('','PATCH',{...current.data,...changes});}
  async function lifecycle(value){const current=await call();return call('/lifecycle','PATCH',{lifecycle:value,version:current.data.version});}
  return {...system,call,settings,lifecycle,b,teacher,student,base,sessions};
}

test('archive and trash deny students, preserve IDs, block content changes, restore access',async t=>{
  const f=await setup(t),p=await f.call('/posts','POST',{body:'作品'},'student');
  for(const state of ['archived','trashed']){
    assert.equal((await f.lifecycle(state)).status,200);
    assert.equal((await f.call('','GET',undefined,'student')).status,403);
    assert.equal((await f.call('/posts','POST',{body:'老師也不能誤改'})).status,403);
    assert.equal((await f.call('/posts/'+p.data.id+'/approve','POST',{})).status,403);
    const teacher=await f.call();assert.equal(teacher.data.posts[0].id,p.data.id);
    assert.equal((await f.lifecycle('active')).status,200);
    assert.equal((await f.call('','GET',undefined,'student')).status,200);
  }
});

test('lifecycle changes require owner, valid state and current version',async t=>{
  const f=await setup(t),b=(await f.call()).data;
  assert.equal((await f.call('/lifecycle','PATCH',{version:b.version,lifecycle:'trashed'},'other')).status,403);
  assert.equal((await f.call('/lifecycle','PATCH',{version:b.version,lifecycle:'invalid'})).status,400);
  await f.lifecycle('archived');
  assert.equal((await f.call('/lifecycle','PATCH',{version:b.version,lifecycle:'active'})).status,409);
});

test('post recycle bin is owner-only; restoration preserves content and requires review again',async t=>{
  const f=await setup(t),p=await f.call('/posts','POST',{body:'保留內容'},'student'),url='/posts/'+p.data.id;
  await f.call(url+'/comments','POST',{body:'原留言'},'student');
  await f.call(url,'DELETE',{},'student');
  assert.equal((await f.call('/trash','GET',undefined,'student')).status,403);
  assert.equal((await f.call('/trash')).data.length,1);
  assert.equal((await f.call(url+'/restore','POST',{},'student')).status,403);
  await f.settings({moderation:true});
  const key=randomUUID();await f.call(url+'/restore','POST',{},'teacher',key);
  assert.equal((await f.call(url+'/restore','POST',{},'teacher',key)).status,200);
  const restored=(await f.call()).data.posts[0];assert.equal(restored.body,'保留內容');assert.equal(restored.comments.length,1);assert.equal(restored.status,'pending');
  assert.equal((await f.call('/trash')).data.length,0);
});

test('deadline rejects every student write but allows teacher management; timezone validated',async t=>{
  const f=await setup(t),p=await f.call('/posts','POST',{body:'準時作品'},'student');
  assert.equal((await f.settings({deadlineAt:'not-a-date'})).status,400);
  assert.equal((await f.settings({deadlineAt:'2030-01-01T12:00'})).status,400);
  await f.settings({deadlineAt:'2000-01-01T12:00:00+08:00'});
  for(const [url,method,body] of [['/posts','POST',{body:'逾時'}],['/posts/'+p.data.id,'PATCH',{body:'修改',version:1}],['/posts/'+p.data.id,'DELETE',{}],['/posts/'+p.data.id+'/comments','POST',{body:'留言'}],['/posts/'+p.data.id+'/like','PUT',{liked:true}]]){
    assert.equal((await f.call(url,method,body,'student')).status,403);
  }
  assert.equal((await f.call('/posts','POST',{body:'教師補充'})).status,201);
  await f.settings({deadlineAt:null});assert.equal((await f.call('/posts','POST',{body:'重新開放'},'student')).status,201);
});

test('per-student cap is atomic, counts pending drafts, excludes deleted posts and exempts teacher',async t=>{
  const f=await setup(t);assert.equal((await f.settings({maxPostsPerStudent:1.5})).status,400);
  await f.settings({maxPostsPerStudent:1,moderation:true});
  const results=await Promise.all([1,2].map(i=>f.call('/posts','POST',{body:'作品'+i,uploadPending:true},'student')));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,403]);
  const p=results.find(r=>r.status===201).data;
  await f.call('/posts/'+p.id,'DELETE',{},'student');
  assert.equal((await f.call('/posts','POST',{body:'重新提交'},'student')).status,201);
  assert.equal((await f.call('/posts','POST',{body:'教師1'})).status,201);
  assert.equal((await f.call('/posts','POST',{body:'教師2'})).status,201);
});

test('template copy is isolated, retry-safe and clears students/deadline/frozen state',async t=>{
  const f=await setup(t);await f.call('/posts','POST',{body:'不可帶入學生資料'},'student');
  await f.settings({allowedEmails:['s@school.edu.tw'],deadlineAt:'2100-01-01T00:00:00Z',frozen:true,maxPostsPerStudent:3,moderation:true,sections:['新分區']});
  const key=randomUUID(),copy=await f.call('/template','POST',{title:'第二班'},'teacher',key);
  assert.equal(copy.status,201);assert.equal((await f.call('/template','POST',{title:'第二班'},'teacher',key)).data.id,copy.data.id);
  const b=f.store.board(copy.data.id);assert.equal(b.posts.length,0);assert.deepEqual(b.allowedEmails,[]);assert.equal(b.deadlineAt,null);assert.equal(b.frozen,false);assert.equal(b.maxPostsPerStudent,3);assert.deepEqual(b.sections,['新分區']);
  assert.deepEqual(JSON.parse(f.store.row(b.id).drive),{});
  assert.equal((await f.call('/template','POST',{title:'不准複製'},'student')).status,403);
});

test('CSV contains only published live posts, escapes formulas/quotes, excludes private IDs',async t=>{
  const f=await setup(t);
  await f.call('/posts','POST',{title:'=1+1',body:'文字,"引號"\n下一行'},'student');
  await f.settings({moderation:true});await f.call('/posts','POST',{body:'未審核秘密'},'student');
  const deleted=await f.call('/posts','POST',{body:'已刪除秘密'});await f.call('/posts/'+deleted.data.id,'DELETE',{});
  const r=await f.call('/export.csv');assert.equal(r.status,200);assert.match(r.data,/'=1\+1/);assert.match(r.data,/""引號""/);assert.ok(!r.data.includes('秘密'));assert.ok(!r.data.includes('school.edu.tw'));assert.ok(!r.data.includes(f.b.id));
  assert.equal((await f.call('/export.csv','GET',undefined,'student')).status,403);
  for(const value of ['=1',' +SUM(A1)','\t@x','\n-1'])assert.ok(csvCell(value).startsWith('"\''));
});

test('legacy v0.1 board defaults remain readable and writable without resetting data',async t=>{
  const f=await setup(t),legacy=f.store.board(f.b.id);delete legacy.lifecycle;delete legacy.deadlineAt;delete legacy.maxPostsPerStudent;
  f.store.db.prepare('UPDATE boards SET data=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
  const r=await f.call();assert.equal(r.data.lifecycle,'active');assert.equal(r.data.maxPostsPerStudent,0);assert.equal(r.data.deadlineAt,null);
  assert.equal((await f.call('/posts','POST',{body:'舊牆仍可使用'},'student')).status,201);
});
