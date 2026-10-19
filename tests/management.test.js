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

test('20 media links persist and 21 are rejected without partial writes',async t=>{
  const f=await setup(t),links=Array.from({length:20},(_,i)=>`https://example.com/${i}.mp4`);
  assert.equal((await f.call('/posts','POST',{links},'student')).status,201);
  assert.equal((await f.call()).data.posts[0].links.length,20);
  assert.equal((await f.call('/posts','POST',{links:[...links,'https://example.com/21.mp4']},'student')).status,400);
  assert.equal((await f.call()).data.posts.length,1);
});

test('teacher ordering persists, supports sections and rejects stale versions and students',async t=>{
  const f=await setup(t),ids=[];
  for(const body of ['A','B','C'])ids.push((await f.call('/posts','POST',{body,section:body==='C'?'提問與回饋':'分享區'},'student')).data.id);
  let b=(await f.call()).data;
  const body={postId:ids[2],targetId:ids[0],position:'before',version:b.version,moveSection:true};
  assert.equal((await f.call('/reorder','POST',body,'student')).status,403);
  const key=randomUUID();assert.equal((await f.call('/reorder','POST',body,'teacher',key)).status,200);
  assert.equal((await f.call('/reorder','POST',body,'teacher',key)).status,200);
  b=(await f.call()).data;assert.deepEqual(b.posts.map(p=>p.id),[ids[2],ids[0],ids[1]]);assert.equal(b.posts[0].section,'分享區');
  assert.equal((await f.call('/reorder','POST',body)).status,409);
  assert.equal((await f.call('/reorder','POST',{...body,version:b.version,position:'invalid'})).status,400);
  assert.deepEqual(f.store.board(f.b.id).posts.map(p=>p.id),[ids[2],ids[0],ids[1]]);
  await f.lifecycle('archived');assert.equal((await f.call('/reorder','POST',{...body,version:(await f.call()).data.version})).status,403);
});

test('background is private, teacher-only, versioned, repeat-safe and removable',async t=>{
  const f=await setup(t),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  async function upload(role='teacher',version=1,mode='tile',data=png,key=randomUUID()){
    const form=new FormData();form.set('file',new Blob([data],{type:'image/png'}),'底圖.png');
    const r=await fetch(f.base+'/api/boards/'+f.b.id+'/background',{method:'POST',headers:{Cookie:f.sessions[role],Origin:'http://localhost:3000','Idempotency-Key':key,'X-Board-Version':String(version),'X-Background-Mode':mode},body:form});return {status:r.status,data:await r.json()};
  }
  assert.equal((await upload('student')).status,403);
  assert.equal((await upload('teacher',1,'tile',Buffer.from('<svg/>'))).status,400);
  const key=randomUUID();assert.equal((await upload('teacher',1,'tile',png,key)).status,200);
  assert.equal((await upload('teacher',1,'tile',png,key)).status,200);
  let b=(await f.call()).data;assert.equal(b.background.name,'底圖.png');assert.equal(b.background.localPath,undefined);assert.equal(b.background.driveId,undefined);
  const url='/background/'+b.background.id;
  let response=await fetch(f.base+'/api/boards/'+f.b.id+url,{headers:{Cookie:f.sessions.student}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  assert.equal((await upload('teacher',1)).status,409);
  assert.equal((await f.call('/background','PATCH',{version:b.version,mode:'width'})).status,200);
  assert.equal((await f.call()).data.background.mode,'width');
  await f.lifecycle('archived');assert.equal((await f.call(url,'GET',undefined,'student')).status,403);
  await f.lifecycle('active');b=(await f.call()).data;
  assert.equal((await f.call('/background','PATCH',{version:b.version,mode:null},'student')).status,403);
  assert.equal((await f.call('/background','PATCH',{version:b.version,mode:null})).status,200);
  assert.equal((await f.call(url)).status,404);
});

test('single-choice voting supports switch, cancel, replay, privacy and closure',async t=>{
  const f=await setup(t),a=(await f.call('/posts','POST',{body:'A'})).data.id,b=(await f.call('/posts','POST',{body:'B'})).data.id;
  const vote=(id,voted=true,key=randomUUID())=>f.call('/posts/'+id+'/vote','PUT',{voted},'student',key);
  assert.equal((await vote(a)).status,403);await f.settings({votingEnabled:true});
  const key=randomUUID();assert.equal((await vote(a,true,key)).status,200);assert.equal((await vote(a,true,key)).status,200);
  let state=(await f.call('','GET',undefined,'student')).data;
  assert.equal(state.votes,undefined);assert.equal(state.posts[0].voteCount,1);assert.equal(state.posts[0].voted,true);
  assert.equal((await vote(b)).status,200);state=(await f.call()).data;assert.deepEqual(state.posts.map(p=>p.voteCount),[0,1]);
  await vote(a,false);assert.equal((await f.call()).data.posts[1].voteCount,1);
  await vote(b,false);assert.deepEqual((await f.call()).data.posts.map(p=>p.voteCount),[0,0]);
  await Promise.all([vote(a),vote(b)]);assert.equal((await f.call()).data.posts.reduce((n,p)=>n+p.voteCount,0),1);
  await f.settings({votingEnabled:false});assert.equal((await vote(a)).status,403);
  assert.equal((await f.call()).data.posts.reduce((n,p)=>n+p.voteCount,0),1);
  assert.match((await f.call('/export.csv')).data,/票數/);
});

test('voting enforces moderation, deadline and freeze; templates start with no votes',async t=>{
  const f=await setup(t);await f.settings({votingEnabled:true,moderation:true});
  const p=(await f.call('/posts','POST',{body:'待審'},'student')).data.id;
  const vote=()=>f.call('/posts/'+p+'/vote','PUT',{voted:true},'student');
  assert.equal((await vote()).status,400);await f.call('/posts/'+p+'/approve','POST',{});
  await f.settings({frozen:true});assert.equal((await vote()).status,403);
  await f.settings({frozen:false,deadlineAt:'2000-01-01T00:00:00Z'});assert.equal((await vote()).status,403);
  await f.settings({deadlineAt:null});assert.equal((await vote()).status,200);
  const copy=await f.call('/template','POST',{title:'沒有票的模板'});assert.equal(f.store.board(copy.data.id).votes,undefined);
});

function wavFile(){
  const b=Buffer.alloc(44+1600);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(1600,40);return b;
}
async function putFile(f,p,data,name='voice.wav',role='student',key=randomUUID()){
  const form=new FormData();form.set('file',new Blob([data],{type:'application/octet-stream'}),name);
  const r=await fetch(f.base+'/api/boards/'+f.b.id+'/posts/'+p+'/attachments',{method:'POST',headers:{Cookie:f.sessions[role],Origin:'http://localhost:3000','Idempotency-Key':key},body:form});return {status:r.status,data:await r.json()};
}
test('audio-only upload supports protected byte ranges, download and idempotent retry',async t=>{
  const f=await setup(t),p=(await f.call('/posts','POST',{uploadPending:true},'student')).data.id,wav=wavFile(),key=randomUUID();
  const a=await putFile(f,p,wav,'voice.wav','student',key);assert.equal(a.status,201);assert.equal((await putFile(f,p,wav,'voice.wav','student',key)).status,200);
  const post=(await f.call()).data.posts[0];assert.equal(post.attachments.length,1);assert.equal(post.attachments[0].mime,'audio/wav');assert.equal(post.status,'published');
  const url=f.base+'/api/boards/'+f.b.id+'/posts/'+p+'/attachments/'+a.data.id;
  let r=await fetch(url,{headers:{Cookie:f.sessions.student,Range:'bytes=10-19'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes 10-19/${wav.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),wav.subarray(10,20));
  r=await fetch(url+'?download=1',{headers:{Cookie:f.sessions.student}});assert.match(r.headers.get('content-disposition'),/^attachment/);await r.arrayBuffer();
  assert.equal((await fetch(url)).status,401);
  assert.equal((await f.call('/posts/'+p+'/attachments/'+a.data.id,'DELETE',{version:post.version},'student')).status,400);
  await f.call('/posts/'+p,'PATCH',{version:post.version,body:'保留說明'},'student');
  const updated=(await f.call()).data.posts[0];assert.equal((await f.call('/posts/'+p+'/attachments/'+a.data.id,'DELETE',{version:updated.version},'student')).status,200);
  assert.equal((await fetch(url,{headers:{Cookie:f.sessions.student}})).status,404);
  assert.equal((await putFile(f,p,wav,'voice.wav','student',key)).status,200);assert.equal((await f.call()).data.posts[0].attachments.length,0);
});

test('attachment management validates full order, owner/version, moderation and freeze',async t=>{
  const f=await setup(t),p=(await f.call('/posts','POST',{body:'作品'},'student')).data.id;
  const ids=[];for(let i=0;i<3;i++)ids.push((await putFile(f,p,wavFile(),`${i}.wav`)).data.id);
  let post=(await f.call()).data.posts[0],route='/posts/'+p+'/attachments';
  assert.equal((await f.call(route,'PATCH',{version:post.version,ids:ids.slice(1)},'student')).status,400);
  assert.equal((await f.call(route,'PATCH',{version:post.version,ids:[ids[0],ids[0],ids[1]]},'student')).status,400);
  assert.equal((await f.call(route,'PATCH',{version:post.version,ids:[...ids].reverse()},'other')).status,403);
  await f.settings({moderation:true});
  const key=randomUUID();assert.equal((await f.call(route,'PATCH',{version:post.version,ids:[...ids].reverse()},'student',key)).status,200);
  assert.equal((await f.call(route,'PATCH',{version:post.version,ids:[...ids].reverse()},'student',key)).status,200);
  assert.equal((await f.call(route,'PATCH',{version:post.version,ids},'student')).status,409);
  post=(await f.call()).data.posts[0];assert.deepEqual(post.attachments.map(a=>a.id),[...ids].reverse());assert.equal(post.status,'pending');
  assert.equal((await f.call(route+'/'+ids[0],'GET',undefined,'other')).status,404);
  await f.settings({frozen:true});assert.equal((await f.call(route+'/'+ids[0],'DELETE',{version:post.version},'student')).status,403);
  assert.equal((await putFile(f,p,wavFile())).status,403);
  assert.equal((await f.call(route+'/'+ids[0],'DELETE',{version:post.version},'teacher')).status,200);
});

test('uploads reject disguised HTML and oversized images; media gets 50 MB allowance',async t=>{
  const f=await setup(t),p=(await f.call('/posts','POST',{body:'作品'},'student')).data.id;
  assert.equal((await putFile(f,p,Buffer.from('<html>bad</html>'),'video.mp4')).status,400);
  const image=Buffer.alloc(10*1024*1024+1);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
  assert.equal((await putFile(f,p,image,'big.png')).status,413);
  const media=Buffer.alloc(11*1024*1024);wavFile().copy(media);assert.equal((await putFile(f,p,media,'large.wav')).status,201);
});

test('five themes persist for students, validate ownership/version and preserve custom wallpaper',async t=>{
  const f=await setup(t);
  for(const theme of ['ivory','sage','porcelain','rose','noir']){
    const version=(await f.call()).data.version;
    assert.equal((await f.call('/theme','PATCH',{theme,version},'student')).status,403);
    const key=randomUUID();assert.equal((await f.call('/theme','PATCH',{theme,version},'teacher',key)).status,200);
    assert.equal((await f.call('/theme','PATCH',{theme,version},'teacher',key)).status,200);
    assert.equal((await f.call('','GET',undefined,'student')).data.theme,theme);
    assert.equal((await f.call('/theme','PATCH',{theme,version})).status,409);
  }
  let version=(await f.call()).data.version;
  assert.equal((await f.call('/theme','PATCH',{theme:'../../bad',version})).status,400);
  assert.equal((await f.call('/theme','PATCH',{theme:'custom',version})).status,400);
  f.store.mutate(f.b.id,f.teacher.id,randomUUID(),'fixture',b=>{b.background={id:'existing',name:'photo.png',mode:'tile',localPath:'/private'};b.theme='custom';});
  version=(await f.call()).data.version;
  await f.call('/theme','PATCH',{theme:'rose',version});
  const b=(await f.call()).data;assert.equal(b.background.id,'existing');assert.equal(b.background.localPath,undefined);
  assert.equal((await f.call('/theme','PATCH',{theme:'custom',version:b.version})).status,200);
  assert.equal((await f.call()).data.theme,'custom');
  await f.lifecycle('archived');version=(await f.call()).data.version;
  assert.equal((await f.call('/theme','PATCH',{theme:'sage',version})).status,403);
});

test('legacy backgrounds stay selected and templates inherit built-in theme',async t=>{
  const f=await setup(t);
  f.store.mutate(f.b.id,f.teacher.id,randomUUID(),'legacy',b=>{delete b.theme;b.background={id:'legacy',mode:'tile'};});
  let b=(await f.call()).data;assert.equal(b.theme,'custom');
  await f.call('/theme','PATCH',{theme:'porcelain',version:b.version});
  const copy=await f.call('/template','POST',{title:'青瓷模板'});assert.equal(f.store.board(copy.data.id).theme,'porcelain');assert.equal(f.store.board(copy.data.id).background,undefined);
});
