import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as d from '../server/domain.js';

execFileSync(process.execPath,['scripts/build-demo.js']);
function harness(){
  let code=readFileSync('demo/pages-demo.js','utf8').replace("import * as d from './domain.js';",'');code=code.slice(0,code.indexOf('\ntry{\n  await open();'));
  const context=vm.createContext({d,console,crypto:{randomUUID},FormData,Blob,URL,structuredClone,setTimeout});
  vm.runInContext(code+"\nstate=seed();persist=async value=>{};globalThis.api=request;globalThis.getState=()=>state;",context);return context;
}
test('Pages demo uses browser storage adapter, relative assets and no secrets/backend imports',()=>{
  const html=readFileSync('dist-demo/index.html','utf8'),app=readFileSync('dist-demo/app.js','utf8'),domain=readFileSync('dist-demo/domain.js','utf8');
  assert.match(html,/type="module" src="\.\/pages-demo.js"/);assert.ok(!html.includes('href="/'));
  assert.match(app,/return window.pagesDemo.request/);assert.match(app,/function connect\(id\)\{return;/);assert.ok(!app.includes('location.assign(\'/'));
  assert.ok(!domain.includes('node:'));assert.ok(!domain.includes('store.js'));assert.ok(!readdirSync('dist-demo').some(p=>p.startsWith('.env')));
  assert.ok(!readFileSync('dist-demo/styles.css','utf8').includes('url("/themes/'));
});
test('Pages demo role switch, posts, votes, themes, ordering and reload state use domain validation',async()=>{
  const h=harness();let b=await h.api('/api/boards/welcome');assert.equal(b.posts.length,3);
  await h.api('/api/boards/welcome/theme',{method:'PATCH',body:{theme:'noir',version:b.version}});
  await h.api('/auth/demo',{method:'POST',body:{role:'student'}});
  b=await h.api('/api/boards/welcome');assert.equal(b.theme,'noir');assert.equal(b.isOwner,false);
  await assert.rejects(h.api('/api/boards/welcome/theme',{method:'PATCH',body:{theme:'rose',version:b.version}}),{status:403});
  const created=await h.api('/api/boards/welcome/posts',{method:'POST',key:'same-post',body:{body:'學生展示作品'}});
  assert.equal((await h.api('/api/boards/welcome/posts',{method:'POST',key:'same-post',body:{body:'duplicate'}})).id,created.id);
  await h.api('/api/boards/welcome/posts/'+created.id+'/vote',{method:'PUT',body:{voted:true}});
  b=await h.api('/api/boards/welcome');assert.equal(b.posts.length,4);assert.equal(b.posts[3].voteCount,1);
  await h.api('/auth/demo',{method:'POST',body:{role:'teacher'}});
  await h.api('/api/boards/welcome/reorder',{method:'POST',body:{version:b.version,postId:created.id,targetId:b.posts[0].id,position:'before'}});
  assert.equal((await h.api('/api/boards/welcome')).posts[0].id,created.id);
  assert.equal((await h.api('/api/drive/check')).code,'PAGES_DEMO');
});
test('Pages demo files are local blobs; persistence failure rolls back edits',async()=>{
  const h=harness(),p=(await h.api('/api/boards/welcome')).posts[0];const form=new FormData();form.set('file',new Blob(['sound'],{type:'audio/mpeg'}),'demo.mp3');
  const a=await h.api('/api/boards/welcome/posts/'+p.id+'/attachments',{method:'POST',body:form});assert.equal(h.getState().files[a.id].size,5);
  vm.runInContext("persist=async()=>{throw new Error('storage full');};",h);
  const before=(await h.api('/api/boards/welcome')).version;
  await assert.rejects(h.api('/api/boards/welcome/posts',{method:'POST',body:{body:'不能儲存'}}),/storage full/);
  assert.equal((await h.api('/api/boards/welcome')).version,before);
});
