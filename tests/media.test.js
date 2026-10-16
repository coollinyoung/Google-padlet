import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaMime,byteRange} from '../server/media.js';
import {DriveService} from '../server/drive.js';

test('media detects supported containers without trusting extension or HTML',()=>{
  const mp4=Buffer.alloc(24);mp4.writeUInt32BE(24);mp4.write('ftyp',4);mp4.write('isom',8);assert.equal(mediaMime(mp4),'video/mp4');
  mp4.write('M4A ',8);assert.equal(mediaMime(mp4),'audio/mp4');mp4.write('avif',8);assert.equal(mediaMime(mp4),null);
  assert.equal(mediaMime(Buffer.from('ID3\x04\0\0\0\0\0\0','binary')),'audio/mpeg');
  const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('header-webm-content')]);assert.equal(mediaMime(webm),'video/webm');
  assert.equal(mediaMime(Buffer.from('<script>alert(1)</script>')),null);
});

test('range supports bounded, open and suffix requests and rejects malformed/outside ranges',()=>{
  assert.deepEqual(byteRange('bytes=10-19',100),{start:10,end:19});assert.deepEqual(byteRange('bytes=90-',100),{start:90,end:99});assert.deepEqual(byteRange('bytes=-5',100),{start:95,end:99});assert.deepEqual(byteRange('bytes=90-200',100),{start:90,end:99});
  for(const v of ['bytes=-0','bytes=100-','bytes=9-2','bytes=','bytes=0-1,4-5','items=0-1'])assert.throws(()=>byteRange(v,100),{status:416});
});

test('Drive download forwards bounded range header and keeps stream private',async()=>{
  const drive=new DriveService({},{});let called;
  drive.client=id=>({files:{async get(...args){called={id,args};return {status:206,data:{}};}}});
  await drive.download('teacher','private-file','bytes=10-19');assert.equal(called.id,'teacher');assert.equal(called.args[0].fileId,'private-file');assert.equal(called.args[1].headers.Range,'bytes=10-19');assert.equal(called.args[1].responseType,'stream');
});

test('HTTP Drive range proxy returns correct partial content and authorizes before downloading',async t=>{
  const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),path=await import('node:path');
  const {Readable}=await import('node:stream'),{createApp}=await import('../server/app.js'),{newBoard,addPost}=await import('../server/domain.js');
  const dir=mkdtempSync(path.join(tmpdir(),'gp-range-')),bytes=Buffer.from('0123456789');let calls=0;
  const drive={async download(owner,id,range){calls++;assert.equal(owner,'t');assert.equal(id,'private');assert.equal(range,'bytes=2-5');return {status:206,data:Readable.from([bytes.subarray(2,6)])};}};
  const system=createApp({demo:false,dataDir:dir,baseUrl:'http://localhost:3000',teachers:['t@school.edu.tw']},{drive});
  const u={id:'t',email:'t@school.edu.tw',teacher:true};system.store.putUser(u);
  const b=newBoard(u,{title:'分段測試'},'school.edu.tw');addPost(b,u,{body:'聲音'});b.posts[0].attachments=[{id:'a',driveId:'private',name:'test.mp3',mime:'audio/mpeg',size:10}];system.store.create(b);
  const cookie='gp_session='+system.store.newSession(u.id),server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{system.stop();await new Promise(r=>server.close(r));system.close();rmSync(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}/api/boards/${b.id}/posts/${b.posts[0].id}/attachments/a`;
  assert.equal((await fetch(url,{headers:{Range:'bytes=2-5'}})).status,401);assert.equal(calls,0);
  let r=await fetch(url,{headers:{Cookie:cookie,Range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 2-5/10');assert.equal(r.headers.get('content-length'),'4');assert.equal(await r.text(),'2345');
  r=await fetch(url,{headers:{Cookie:cookie,Range:'bytes=50-'}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */10');assert.equal(calls,1);
});
