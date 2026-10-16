import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {encrypt,decrypt} from '../server/auth.js';
import {readConfig} from '../server/config.js';

async function fixture(t){
  const dir=mkdtempSync(path.join(tmpdir(),'gp-test-'));
  const config={demo:true,baseUrl:'http://localhost:3000',secure:false,dataDir:dir,defaultDomain:'pcps.ntpc.edu.tw',teachers:[]};
  const built=createApp(config),server=built.app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(r=>server.close(r));built.close();rmSync(dir,{recursive:true,force:true});});
  async function request(url,{cookie,method='GET',body,key=randomUUID(),originHeader=config.baseUrl}={}){
    const headers={Origin:originHeader,'Idempotency-Key':key};if(cookie)headers.Cookie=cookie;
    if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
    const res=await fetch(origin+url,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    const data=await res.json();return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const teacher=(await request('/auth/demo',{method:'POST',body:{role:'teacher'}})).cookie;
  const student=(await request('/auth/demo',{method:'POST',body:{role:'student'}})).cookie;
  const student2=(await request('/auth/demo',{method:'POST',body:{role:'student2'}})).cookie;
  const create=await request('/api/boards',{method:'POST',cookie:teacher,body:{title:'測試互動牆',description:'測試'}});
  assert.equal(create.status,201);return {request,teacher,student,student2,id:create.data.id,...built};
}
async function setting(f,changes){const current=await f.request('/api/boards/'+f.id,{cookie:f.teacher});return f.request('/api/boards/'+f.id,{method:'PATCH',cookie:f.teacher,body:{...current.data,...changes}});}

test('role boundaries, domain restrictions, CSRF and protected reads',async t=>{
  const f=await fixture(t),base='/api/boards/'+f.id;
  assert.equal((await f.request(base)).status,401);
  assert.equal((await f.request('/api/boards',{method:'POST',cookie:f.student,body:{title:'越權'}})).status,403);
  assert.equal((await f.request(base+'/posts',{method:'POST',cookie:f.student,originHeader:'https://evil.example',body:{body:'攻擊'}})).status,403);
  const result=await f.request(base+'/posts',{method:'POST',cookie:f.student,body:{body:'我的作品'}});assert.equal(result.status,201);
  assert.equal((await f.request(base+'/posts/'+result.data.id,{method:'PATCH',cookie:f.student2,body:{body:'竄改',version:1}})).status,403);
  assert.equal((await f.request(base+'/export',{cookie:f.student})).status,403);
  await setting(f,{allowedEmails:['s01@pcps.ntpc.edu.tw']});
  assert.equal((await f.request(base,{cookie:f.student2})).status,403);
});

test('35 concurrent posts persist exactly once, with repeat-safe likes and edits',async t=>{
  const f=await fixture(t),base='/api/boards/'+f.id;
  const keys=Array.from({length:35},()=>randomUUID());
  const requests=keys.map((key,i)=>f.request(base+'/posts',{cookie:f.student,method:'POST',key,body:{body:'作品 '+i}}));
  const responses=await Promise.all(requests);assert.ok(responses.every(x=>x.status===201));
  await f.request(base+'/posts',{cookie:f.student,method:'POST',key:keys[0],body:{body:'作品 0'}});
  let current=(await f.request(base,{cookie:f.teacher})).data;assert.equal(current.posts.length,35);
  const id=responses[0].data.id;
  const updates=await Promise.all([1,2].map(i=>f.request(base+'/posts/'+id,{cookie:f.student,method:'PATCH',body:{body:'修改'+i,version:1}})));
  assert.deepEqual(updates.map(x=>x.status).sort(),[200,409]);
  for(let i=0;i<3;i++)await f.request(base+'/posts/'+id+'/like',{cookie:f.student,method:'PUT',body:{liked:true}});
  current=(await f.request(base,{cookie:f.teacher})).data;
  assert.equal(current.posts.find(p=>p.id===id).likeCount,1);
  assert.equal(current.posts.find(p=>p.id===id).version,2);
});

test('moderation hides post and attachment; freeze covers all student writes',async t=>{
  const f=await fixture(t),base='/api/boards/'+f.id;
  await setting(f,{moderation:true});
  const {data:{id}}=await f.request(base+'/posts',{cookie:f.student,method:'POST',body:{body:'待審核作品',uploadPending:true}});
  const form=new FormData();form.set('file',new Blob([Buffer.from([137,80,78,71,13,10,26,10,0,0])],{type:'image/png'}),'example.png');
  const file=await f.request(base+'/posts/'+id+'/attachments',{method:'POST',cookie:f.student,body:form});assert.equal(file.status,201);
  const other=await f.request(base,{cookie:f.student2});assert.equal(other.data.posts.length,0);
  assert.equal((await f.request(base+'/posts/'+id+'/attachments/'+file.data.id,{cookie:f.student2})).status,404);
  assert.equal((await f.request(base+'/posts/'+id+'/approve',{method:'POST',cookie:f.student})).status,403);
  assert.equal((await f.request(base+'/posts/'+id+'/approve',{method:'POST',cookie:f.teacher})).status,200);
  assert.equal((await f.request(base,{cookie:f.student2})).data.posts.length,1);
  await setting(f,{frozen:true});
  for(const [url,method,body] of [[base+'/posts','POST',{body:'新作'}],[base+'/posts/'+id,'PATCH',{body:'修改',version:3}],
    [base+'/posts/'+id,'DELETE',{}],[base+'/posts/'+id+'/comments','POST',{body:'留言'}],[base+'/posts/'+id+'/like','PUT',{liked:true}]]){
    assert.equal((await f.request(url,{cookie:f.student,method,body})).status,403);
  }
});

test('board creation retry, rename uniqueness and settings conflict',async t=>{
  const f=await fixture(t),key=randomUUID();
  const first=await f.request('/api/boards',{cookie:f.teacher,method:'POST',key,body:{title:'第二面'}});
  const again=await f.request('/api/boards',{cookie:f.teacher,method:'POST',key,body:{title:'第二面'}});
  assert.equal(first.data.id,again.data.id);
  assert.equal((await setting(f,{title:'第二面'})).status,409);
  const b=(await f.request('/api/boards/'+f.id,{cookie:f.teacher})).data;
  await setting(f,{title:'已改名'});
  assert.equal((await f.request('/api/boards/'+f.id,{cookie:f.teacher,method:'PATCH',body:b})).status,409);
});

test('credentials authenticated encryption and demo deployment guard',()=>{
  const key='a'.repeat(64),value={refresh_token:'not-a-real-secret'};
  const sealed=encrypt(value,key);assert.ok(!sealed.includes(value.refresh_token));assert.deepEqual(decrypt(sealed,key),value);
  assert.throws(()=>decrypt(sealed,'b'.repeat(64)));
  assert.throws(()=>readConfig({DEMO_MODE:'true',HOST:'0.0.0.0'}));
  assert.throws(()=>readConfig({DEMO_MODE:'true',NODE_ENV:'production'}));
  assert.throws(()=>readConfig({DEMO_MODE:'false'}));
});
