import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {normalizeLinks} from '../server/links.js';
import {newBoard,addPost,editPost,exportCsv} from '../server/domain.js';
import {createApp} from '../server/app.js';
const vid='M7lc1UVf-VE';
const owner={id:'owner',teacher:true,name:'老師',hd:'school.edu.tw',email:'t@school.edu.tw'};

test('YouTube watch, short, Shorts, live and embed URLs normalize to a single safe video',()=>{
  for(const url of [`https://www.youtube.com/watch?v=${vid}`,`https://youtu.be/${vid}`,`https://m.youtube.com/shorts/${vid}`,`https://www.youtube.com/live/${vid}`,`https://www.youtube-nocookie.com/embed/${vid}`]){
    const [link]=normalizeLinks([url]);assert.equal(link.kind,'youtube');assert.equal(link.videoId,vid);assert.equal(link.url,`https://www.youtube.com/watch?v=${vid}`);
  }
  assert.equal(normalizeLinks([`https://youtu.be/${vid}?t=1h2m3s`])[0].startSeconds,3723);
  assert.equal(normalizeLinks([`https://youtube.com/watch?v=${vid}&start=90&autoplay=1`])[0].startSeconds,90);
  assert.equal(normalizeLinks([`https://youtu.be/${vid}`,`https://youtube.com/watch?v=${vid}`]).length,1);
});

test('link validation blocks scripts, HTML, credentials and spoofed embed providers',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','//youtube.com','<iframe src="https://youtube.com"></iframe>','https://u:p@example.com','https://example.com/\nscript'])assert.throws(()=>normalizeLinks([url]));
  assert.throws(()=>normalizeLinks(Array(21).fill('https://example.com')));
  assert.throws(()=>normalizeLinks([{url:'https://example.com',kind:'youtube'}]));
  for(const url of [`https://youtube.com.evil.example/watch?v=${vid}`,`https://youtube.com:444/watch?v=${vid}`,`https://youtu.be/invalid`])assert.equal(normalizeLinks([url])[0].kind,'link');
});

test('direct HTTPS media recognized without treating arbitrary sites as frames',()=>{
  for(const [url,kind] of [['https://example.com/movie.MP4?token=abc','video'],['https://example.com/a.webm','video'],['https://example.com/a.mp3','audio'],['https://example.com/a.m4a','audio'],['http://example.com/a.mp4','link'],['https://example.com/page','link']])assert.equal(normalizeLinks([url])[0].kind,kind);
});

test('link-only posts work; editing preserves omitted links and explicit deletion requires content',()=>{
  const b=newBoard(owner,{title:'網址課程'},owner.hd);
  const p=addPost(b,owner,{links:[`https://youtu.be/${vid}`]});assert.equal(b.posts[0].body,'');
  editPost(b,owner,p.id,{body:'新的描述',version:1});assert.equal(b.posts[0].links.length,1);
  editPost(b,owner,p.id,{body:'留下文字',links:[],version:2});assert.equal(b.posts[0].links.length,0);
  assert.throws(()=>addPost(b,owner,{body:' ',links:[]}));
  assert.throws(()=>editPost(b,owner,p.id,{body:'',links:[],version:3}));
  addPost(b,owner,{links:['https://example.com/教學']});assert.match(exportCsv(b,owner),/https:\/\/example.com/);
});

test('HTTP stores normalized links, enforces review/freeze and serves limited iframe CSP',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'gp-links-')),system=createApp({demo:true,baseUrl:'http://localhost:3000',dataDir:dir});
  const student={id:'student',hd:owner.hd,name:'學生',email:'s@school.edu.tw'},other={...student,id:'other'};
  const cookies={};for(const u of [owner,student,other]){system.store.putUser(u);cookies[u.id]='gp_session='+system.store.newSession(u.id);}
  const b=newBoard(owner,{title:'測試'},owner.hd);b.moderation=true;system.store.create(b);
  const server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{system.stop();await new Promise(r=>server.close(r));system.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function call(route,method='GET',body,user='student'){
    const r=await fetch(base+'/api/boards/'+b.id+route,{method,headers:{Cookie:cookies[user],Origin:'http://localhost:3000','Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};
  }
  const post=await call('/posts','POST',{links:[`https://youtu.be/${vid}`]});assert.equal(post.status,201);
  const hidden=await call('','GET',null,'other');assert.equal(hidden.data.posts.length,0);
  assert.match(hidden.headers.get('content-security-policy'),/frame-src https:\/\/www.youtube-nocookie.com;/);
  assert.match(hidden.headers.get('content-security-policy'),/media-src https:;/);
  assert.equal(system.store.board(b.id).posts[0].links[0].videoId,vid);
  await call('/posts/'+post.data.id+'/approve','POST',{},'owner');assert.equal((await call('','GET',null,'other')).data.posts[0].links.length,1);
  const before=system.store.row(b.id).version;
  assert.equal((await call('/posts/'+post.data.id,'PATCH',{version:2,links:['javascript:alert(1)']})).status,400);assert.equal(system.store.row(b.id).version,before);
  const settings=(await call('','GET',null,'owner')).data;
  await call('','PATCH',{...settings,frozen:true},'owner');assert.equal((await call('/posts','POST',{links:['https://example.com']})).status,403);
});

test('client builds click-to-load players with safe source, explicit referrer and escaped links',async()=>{
  function element(){return {innerHTML:'',children:[],addEventListener(){},replaceChildren(...children){this.children=children;},append(x){this.children.push(x);}};}
  const elements=new Map();const doc={querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},addEventListener(){},createElement(tag){return {...element(),tag};}};
  const context=vm.createContext({document:doc,location:{search:'',pathname:'/'},URLSearchParams,URL,FormData,console,crypto:{randomUUID},fetch:async()=>({ok:true,json:async()=>({user:null,demo:true})}),setTimeout,clearTimeout});
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8')+'\nglobalThis.helpers={linkCards,playMedia,loadBoard};',context);
  const p={id:'post-1',title:'標題',links:normalizeLinks([`https://youtu.be/${vid}?t=90`,'https://example.com/?x=%22'])};
  const html=context.helpers.linkCards(p);assert.ok(!html.includes('<iframe'));assert.match(html,/data-action="play-media"/);assert.match(html,/noopener noreferrer/);
  context.helpers.playMedia(p,0);const frame=elements.get('#media-post-1-0').children[0];assert.equal(frame.tag,'iframe');assert.equal(frame.referrerPolicy,'strict-origin-when-cross-origin');assert.equal(frame.src,`https://www.youtube-nocookie.com/embed/${vid}?playsinline=1&autoplay=0&start=90`);
  await new Promise(setImmediate);
  const initial={id:'b',version:1,domain:owner.hd,title:'牆',description:'',lifecycle:'active',isOwner:true,layout:'wall',sections:['分享'],posts:[p],sync:{demo:true}};
  context.initial=initial;vm.runInContext('board=initial;',context);
  context.fetch=async()=>({ok:true,json:async()=>({...initial,version:2})});
  await context.helpers.loadBoard('b',true);
  assert.equal(elements.get('#media-post-1-0').children[0],frame);
  assert.equal(elements.get('#media-update').hidden,false);
  context.fetch=async()=>({ok:true,json:async()=>({...initial,version:3,posts:[]})});
  await context.helpers.loadBoard('b',true);
  assert.equal(vm.runInContext('activeEmbeds.size',context),0);
  const malicious={id:'bad',title:'',links:[{kind:'youtube',videoId:'bad" onload="x',url:'https://example.com'}]};context.helpers.playMedia(malicious,0);assert.equal(elements.get('#media-bad-0').children.length,0);
});
