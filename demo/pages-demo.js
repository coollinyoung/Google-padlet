import * as d from './domain.js';
const profiles={teacher:{id:'demo-teacher',name:'示範教師',email:'teacher@pcps.ntpc.edu.tw',hd:'pcps.ntpc.edu.tw',teacher:true,driveConnected:true},student:{id:'demo-student',name:'01 林小晴',email:'s01@pcps.ntpc.edu.tw',hd:'pcps.ntpc.edu.tw',teacher:false},student2:{id:'demo-student2',name:'02 陳小宇',email:'s02@pcps.ntpc.edu.tw',hd:'pcps.ntpc.edu.tw',teacher:false}};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
let state,db;const urls=new Map();let queue=Promise.resolve();
function seed(){
  const b=d.newBoard(profiles.teacher,{title:'歡迎來到 Google Padlet',description:'試試五套佈景、拖曳排序、影音連結與投票。切換上方教師／學生按鈕，體驗不同操作。'},'pcps.ntpc.edu.tw');b.id='welcome';b.votingEnabled=true;
  d.addPost(b,profiles.teacher,{title:'先挑一套喜歡的佈景',body:'教師可以點選貼文區上方五套主題。背景會隨貼文向下延伸。',color:'cream'});
  d.addPost(b,profiles.student,{title:'我的觀察與發現',body:'走進林家花園，觀察窗花與建築線條。你發現了哪些圖案？',color:'blue',section:'觀察與發現'});
  d.addPost(b,profiles.student2,{title:'一起投票與留言',body:'每人每牆一票，可以改投或取消。此展示只模擬同一瀏覽器裡的角色。',color:'pink',section:'提問與回饋'});
  return {boards:[b],files:{},role:'teacher',operations:{}};
}
async function open(){
  db=await new Promise((resolve,reject)=>{const r=indexedDB.open('google-padlet-pages-demo-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  state=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('demo');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  if(!state){state=seed();await persist(state);}
}
function persist(value){return new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(value,'demo');t.oncomplete=resolve;t.onerror=()=>reject(new Error('瀏覽器儲存空間不足或被停用，請移除部分資料後重試。'));t.onabort=()=>reject(new Error('未能儲存展示資料。'));});}
function asset(id){if(!urls.has(id)){const file=state.files[id];if(!file)return '';urls.set(id,URL.createObjectURL(file));}return urls.get(id);}
function serialize(fn){
  const run=async()=>{if(db){const latest=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('demo');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(latest)state=latest;}return fn();};
  const task=queue.then(()=>typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request('google-padlet-pages-demo-v1',run):run());queue=task.catch(()=>{});return task;
}
async function request(path,{method='GET',body={},key=crypto.randomUUID(),headers={}}={}){return serialize(async()=>{
  const u=profiles[state.role];
  if(path==='/api/session')return {version:'0.7.0-demo',demo:true,user:u||null};
  if(path==='/auth/demo'){if(!profiles[body.role])fail(400,'未知角色');const next={...state,role:body.role};await persist(next);state=next;return {};}
  if(path==='/auth/logout'){const next={...state,role:null};await persist(next);state=next;return {};}
  if(!u)fail(401,'請先選擇體驗角色。');
  if(path==='/api/drive/check')return {ok:false,code:'PAGES_DEMO',message:'GitHub Pages 展示版沒有 Google 登入或 Drive 連線，資料只儲存在此瀏覽器。'};
  if(path==='/api/boards'&&method==='GET')return state.boards.filter(b=>d.canRead(b,u)).map(b=>({...b,isOwner:b.ownerId===u.id}));
  const next=structuredClone(state),op=u.id+':'+key;
  if(method!=='GET'&&Object.hasOwn(next.operations,op))return next.operations[op];
  let result={};
  if(path==='/api/boards'&&method==='POST'){
    const b=d.newBoard(u,body,'pcps.ntpc.edu.tw');if(next.boards.some(x=>x.ownerId===u.id&&x.title===b.title))fail(409,'已有同名互動牆。');next.boards.push(b);result={id:b.id};
  }else{
    const parts=path.split('/').filter(Boolean),b=next.boards.find(b=>b.id===parts[2]);if(!b)fail(404,'找不到展示牆。請返回首頁。');d.access(b,u);
    const action=parts[3],postId=parts[4],sub=parts[5],childId=parts[6];
    if(method==='GET'){
      if(!action)return d.publicBoard(b,u,{sync_version:0,version:b.version,drive:'{}'},true);
      if(action==='trash'){d.owner(b,u);return b.posts.filter(p=>p.deleted);}
      fail(404,'展示版不支援此讀取操作。');
    }
    if(!action&&method==='PATCH'){d.settings(b,u,body);if(next.boards.some(x=>x.id!==b.id&&x.ownerId===u.id&&x.title===b.title))fail(409,'已有同名互動牆。');}
    else if(action==='theme')d.changeTheme(b,u,body);
    else if(action==='reorder')d.reorderPost(b,u,body);
    else if(action==='lifecycle')d.lifecycle(b,u,body);
    else if(action==='template'){const copy=d.template(b,u,body);if(next.boards.some(x=>x.ownerId===u.id&&x.title===copy.title))fail(409,'已有同名互動牆。');next.boards.push(copy);result={id:copy.id};}
    else if(action==='background'){
      d.owner(b,u);d.writable(b,u);const version=body instanceof FormData?Number(headers['X-Board-Version']):body.version;
      if(version!==b.version)fail(409,'互動牆已更新，請重新開啟底圖設定。');
      if(body instanceof FormData){const file=body.get('file');checkFile(file,true);const mode=headers['X-Background-Mode'];if(!['tile','width'].includes(mode))fail(400,'底圖模式錯誤。');const id=crypto.randomUUID();next.files[id]=file;b.background={id,name:file.name,mode};b.theme='custom';}
      else if(body.mode===null){b.background=null;b.theme='ivory';}
      else {if(!b.background||!['tile','width'].includes(body.mode))fail(400,'請先上傳底圖。');b.background.mode=body.mode;b.theme='custom';}
    }else if(action==='posts'){
      if(!postId&&method==='POST')result=d.addPost(b,u,body);
      else if(!sub&&method==='PATCH')result=d.editPost(b,u,postId,body);
      else if(!sub&&method==='DELETE')d.removePost(b,u,postId);
      else if(sub==='approve')d.approvePost(b,u,postId);
      else if(sub==='restore')result=d.restorePost(b,u,postId);
      else if(sub==='like')d.setLike(b,u,postId,body);
      else if(sub==='vote')d.setVote(b,u,postId,body);
      else if(sub==='comments'){if(method==='DELETE')d.removeComment(b,u,postId,childId);else result=d.addComment(b,u,postId,body);}
      else if(sub==='attachments'){
        if(method==='POST'){
          const p=d.editable(b,u,postId),file=body.get('file');checkFile(file);if(p.attachments.length>=5)fail(400,'每篇最多五個附件。');
          const id=crypto.randomUUID();next.files[id]=file;p.attachments.push({id,name:file.name,mime:file.type,size:file.size});p.version++;p.status=b.moderation&&b.ownerId!==u.id?'pending':'published';result={id};
        }else d.changeAttachments(b,u,postId,body,method==='DELETE'?childId:undefined);
      }else fail(400,'展示版不支援此操作。');
    }else fail(400,'此功能需要正式伺服器版。');
    b.version++;b.updatedAt=new Date().toISOString();
  }
  next.operations[op]=result;const keys=Object.keys(next.operations);if(keys.length>500)delete next.operations[keys[0]];
  // Remove unreferenced files to avoid accumulating large local blobs.
  const used=new Set(next.boards.flatMap(b=>[b.background?.id,...b.posts.flatMap(p=>p.attachments.map(a=>a.id))]).filter(Boolean));
  for(const id of Object.keys(next.files))if(!used.has(id))delete next.files[id];
  await persist(next);state=next;return result;
});}
function checkFile(file,imageOnly=false){
  const types=imageOnly?['image/png','image/jpeg','image/webp']:['image/png','image/jpeg','image/webp','application/pdf','video/mp4','video/webm','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg'];
  if(!file?.size||file.size>5*1024*1024)fail(400,'展示版每檔最多 5 MB。正式版影音上限為 50 MB。');
  if(!types.includes(file.type))fail(400,'展示版無法辨識此檔案類型。');
}
function download(id,csv){const u=profiles[state.role],b=state.boards.find(b=>b.id===id);if(!b)fail(404,'找不到互動牆。');d.owner(b,u);const data=csv?d.exportCsv(b,u):JSON.stringify(b,null,2),url=URL.createObjectURL(new Blob([data],{type:csv?'text/csv;charset=utf-8':'application/json'}));const a=document.createElement('a');a.href=url;a.download='google-padlet-demo.'+(csv?'csv':'json');a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
try{
  await open();window.pagesDemo={request,asset,download};
  document.addEventListener('click',async event=>{
    const role=event.target.closest('[data-demo-role]')?.dataset.demoRole;
    try{
      if(role){await request('/auth/demo',{method:'POST',body:{role}});location.reload();}
      if(event.target.closest('#demo-reset')&&confirm('重設此瀏覽器的全部展示貼文與附件？'))await serialize(async()=>{const next=seed();await persist(next);state=next;location.assign('./');});
    }catch(e){alert(e.message);}
  });
  await import('./app.js');
}catch(e){document.querySelector('#app').textContent='展示版無法啟動：'+e.message+'。請允許網站儲存資料，並使用一般瀏覽模式重試。';}
