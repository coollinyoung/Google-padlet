import {normalizeLinks} from './links.js';
import {randomUUID} from 'node:crypto';
import {fail} from './store.js';
export const layouts = ['wall','grid','columns','stream'];
export function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400,'文字內容未填寫或超過長度限制。');
  return value.trim();
}
export function canRead(b,u) { return !!u && (b.ownerId === u.id || ((b.lifecycle||'active') === 'active' && u.hd === b.domain && (!b.allowedEmails.length || b.allowedEmails.includes(u.email)))); }
export function access(b,u) { if (!canRead(b,u)) fail(403,'您沒有這面牆的存取權限。'); }
export function owner(b,u) { if (b.ownerId !== u.id) fail(403,'只有建立這面牆的教師可以管理。'); }
export function writable(b,u) {
  access(b,u);
  if ((b.lifecycle||'active') !== 'active') fail(403,'請先還原互動牆再編輯內容。');
  if (b.ownerId !== u.id) {
    if (b.frozen) fail(403,'互動牆已凍結。');
    if (b.deadlineAt && Date.now() >= Date.parse(b.deadlineAt)) fail(403,'活動已截止，目前僅供瀏覽。');
  }
}
export function postFor(b,u,id) { access(b,u); const p = b.posts.find(x=>x.id===id && !x.deleted); if (!p || (p.status!=='published' && p.authorId!==u.id && b.ownerId!==u.id)) fail(404,'找不到貼文。'); return p; }
export function editable(b,u,id) { writable(b,u); const p=postFor(b,u,id); if (p.authorId!==u.id && b.ownerId!==u.id) fail(403,'只能修改自己的貼文。'); return p; }
export function newBoard(u, body, defaultDomain) {
  if (!u.teacher) fail(403,'只有教師名單中的帳號可以建立互動牆。');
  const now = new Date().toISOString();
  const b = {schemaVersion:1,id:randomUUID(),ownerId:u.id,title:text(body.title,100,true),description:text(body.description||'',2000),
    domain:defaultDomain,allowedEmails:[],layout:'wall',moderation:false,frozen:false,sections:['分享區','觀察與發現','提問與回饋'],
    lifecycle:'active',deadlineAt:null,maxPostsPerStudent:0,posts:[],version:1,createdAt:now,updatedAt:now};
  if (layouts.includes(body.layout)) b.layout=body.layout;
  return b;
}
export function settings(b,u,body) {
  owner(b,u); if (body.version !== b.version) fail(409,'設定已被更新，請重新整理後再試。');
  b.title=text(body.title,100,true); b.description=text(body.description||'',2000);
  if (!layouts.includes(body.layout)) fail(400,'不支援的版型。'); b.layout=body.layout;
  if (typeof body.moderation!=='boolean' || typeof body.frozen!=='boolean') fail(400,'設定格式不正確。');
  b.moderation=body.moderation; b.frozen=body.frozen;
  if(body.votingEnabled!==undefined){if(typeof body.votingEnabled!=='boolean')fail(400,'投票設定格式錯誤。');b.votingEnabled=body.votingEnabled;}
  const domain=text(body.domain,253,true).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail(400,'網域格式不正確。'); b.domain=domain;
  if (!Array.isArray(body.allowedEmails) || body.allowedEmails.length>500) fail(400,'名單最多 500 人。');
  b.allowedEmails=[...new Set(body.allowedEmails.map(x=>text(x,254,true).toLowerCase()))];
  if (b.allowedEmails.some(x=>!x.endsWith('@'+domain))) fail(400,'名單中的帳號必須屬於指定網域。');
  if (!Array.isArray(body.sections) || !body.sections.length || body.sections.length>20) fail(400,'分區數必須在 1～20 之間。');
  const sections=[...new Set(body.sections.map(x=>text(x,50,true)))];
  for (const p of b.posts) if (!sections.includes(p.section)) p.section=sections[0];
  b.sections=sections;
  if (body.deadlineAt !== undefined) {
    if (body.deadlineAt !== null && (typeof body.deadlineAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.deadlineAt) || !Number.isFinite(Date.parse(body.deadlineAt)))) fail(400,'截止時間必須包含時區。');
    b.deadlineAt=body.deadlineAt===null?null:new Date(body.deadlineAt).toISOString();
  }
  if (body.maxPostsPerStudent !== undefined) {
    if (!Number.isInteger(body.maxPostsPerStudent) || body.maxPostsPerStudent<0 || body.maxPostsPerStudent>100) fail(400,'每人上限必須是 0～100 的整數，0 表示不限。');
    b.maxPostsPerStudent=body.maxPostsPerStudent;
  }
}
function content(body,b,previous) {
  const color=['cream','blue','pink','green'].includes(body.color)?body.color:'cream';
  const links=normalizeLinks(body.links===undefined?(previous?.links||[]).map(link=>link.url):body.links);
  const message=text(body.body||'',10000);
  if(!message&&!links.length&&!previous?.attachments?.length&&body.uploadPending!==true)fail(400,'請填寫內容或至少加入一個網址。');
  return {links,title:text(body.title||'',160),body:message,section:b.sections.includes(body.section)?body.section:b.sections[0],color};
}
export function addPost(b,u,body) {
  writable(b,u); if (b.ownerId!==u.id && b.maxPostsPerStudent>0 && b.posts.filter(p=>!p.deleted&&p.authorId===u.id).length>=b.maxPostsPerStudent) fail(403,'您已達每人發文上限。');
  if(b.posts.length>=1000) fail(400,'本版本每牆最多 1,000 篇貼文。');
  const p={...content(body,b),id:randomUUID(),authorId:u.id,authorName:u.name,createdAt:new Date().toISOString(),version:1,
    status:body.uploadPending?'uploading':b.moderation&&b.ownerId!==u.id?'pending':'published',comments:[],likes:[],attachments:[],deleted:false};
  b.posts.push(p); return {id:p.id};
}
export function editPost(b,u,id,body) {
  const p=editable(b,u,id); if(p.version!==body.version) fail(409,'貼文已被修改，請重新整理後再編輯。');
  Object.assign(p,content(body,b,p)); p.version++;
  p.status=body.uploadPending?'uploading':b.moderation&&b.ownerId!==u.id?'pending':'published';
  return {id:p.id};
}
export function removePost(b,u,id) { const p=editable(b,u,id); p.deleted=true; p.deletedAt=new Date().toISOString(); p.version++; }
export function approvePost(b,u,id) { owner(b,u); writable(b,u); const p=postFor(b,u,id); if(p.status==='uploading') fail(400,'附件尚未完成，請先補傳或編輯文字後發布。'); p.status='published'; p.version++; }
export function addComment(b,u,id,body) {
  writable(b,u); const p=postFor(b,u,id); if(p.status!=='published') fail(400,'尚未發布的貼文不能留言。');
  if(p.comments.length>=500) fail(400,'留言已達本版上限。');
  const c={id:randomUUID(),authorId:u.id,authorName:u.name,body:text(body.body,2000,true),createdAt:new Date().toISOString()};
  p.comments.push(c); return {id:c.id};
}
export function removeComment(b,u,id,commentId) {
  writable(b,u);const p=postFor(b,u,id),c=p.comments.find(c=>c.id===commentId);
  if(!c) fail(404,'找不到留言。'); if(c.authorId!==u.id && b.ownerId!==u.id) fail(403,'只能刪除自己的留言。');
  p.comments=p.comments.filter(c=>c.id!==commentId);
}
export function setLike(b,u,id,body) {
  writable(b,u); const p=postFor(b,u,id); if(p.status!=='published') fail(400,'尚未發布。');
  if(typeof body.liked!=='boolean') fail(400,'反應格式錯誤。');
  p.likes=p.likes.filter(x=>x!==u.id); if(body.liked)p.likes.push(u.id);
}
export function publicBoard(b,u,row,demo=false) {
  access(b,u); const own=b.ownerId===u.id;
  return {...b,votes:undefined,votingEnabled:!!b.votingEnabled,background:b.background?{id:b.background.id,name:b.background.name,mode:b.background.mode}:null,lifecycle:b.lifecycle||'active',deadlineAt:b.deadlineAt||null,maxPostsPerStudent:b.maxPostsPerStudent||0,allowedEmails:own?b.allowedEmails:[],
    posts:b.posts.filter(p=>!p.deleted&&(p.status==='published'||own||p.authorId===u.id)).map(p=>({...p,likes:undefined,likeCount:p.likes.length,liked:p.likes.includes(u.id),voteCount:Object.values(b.votes||{}).filter(id=>id===p.id).length,voted:b.votes?.[u.id]===p.id,
      attachments:p.attachments.map(({driveId,localPath,...a})=>a)})),
    isOwner:own,sync: own?{demo,version:row.sync_version,current:row.version,error:row.sync_error,folderId:JSON.parse(row.drive).folderId||null}:{demo}};
}

export function lifecycle(b,u,body) {
  owner(b,u);
  if(body.version!==b.version) fail(409,'互動牆已變更，請重新整理後再試。');
  if(!['active','archived','trashed'].includes(body.lifecycle)) fail(400,'無效的互動牆狀態。');
  b.lifecycle=body.lifecycle;
}
export function restorePost(b,u,id) {
  owner(b,u); writable(b,u);
  const p=b.posts.find(p=>p.id===id&&p.deleted);
  if(!p) fail(404,'回收站找不到這則貼文。');
  p.deleted=false; delete p.deletedAt; p.version++;
  if(p.status!=='uploading' && b.moderation && p.authorId!==b.ownerId) p.status='pending';
  return {id:p.id};
}
export function template(b,u,body) {
  owner(b,u);
  const copy=newBoard(u,{title:body.title,description:b.description,layout:b.layout},b.domain);
  copy.sections=[...b.sections];copy.moderation=b.moderation;copy.maxPostsPerStudent=b.maxPostsPerStudent||0;
  return copy;
}
// Quote all cells and neutralize spreadsheet formula prefixes, including leading whitespace.
export function csvCell(value) {
  let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/u.test(s)||/^[\t\r\n]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function exportCsv(b,u) {
  owner(b,u);
  const rows=[['作者','標題','內容','分區','發布時間（臺灣）','喜歡數','票數','留言數','附件數','網址']];
  for(const p of b.posts.filter(p=>!p.deleted&&p.status==='published'))rows.push([p.authorName,p.title,p.body,p.section,
    new Date(p.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}),p.likes.length,Object.values(b.votes||{}).filter(id=>id===p.id).length,p.comments.length,p.attachments.length,(p.links||[]).map(l=>l.url).join('\n')]);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}

export function reorderPost(b,u,body) {
  owner(b,u);writable(b,u);
  if(body.version!==b.version)fail(409,'貼文順序已更新，請重新整理後再排序。');
  const p=postFor(b,u,body.postId),target=postFor(b,u,body.targetId);
  if(p.id===target.id)fail(400,'請選擇其他貼文作為排序位置。');
  if(!['before','after'].includes(body.position))fail(400,'排序位置不正確。');
  b.posts=b.posts.filter(x=>x.id!==p.id);
  b.posts.splice(b.posts.findIndex(x=>x.id===target.id)+(body.position==='after'?1:0),0,p);
  if(body.moveSection===true){p.section=target.section;p.version++;}
}

export function setVote(b,u,id,body){
  writable(b,u);
  if(!b.votingEnabled)fail(403,'教師尚未開啟投票，或已結束投票。');
  const p=postFor(b,u,id);if(p.status!=='published')fail(400,'只能投票給已發布的貼文。');
  if(typeof body.voted!=='boolean')fail(400,'投票格式錯誤。');
  b.votes||={};
  if(body.voted)b.votes[u.id]=p.id;
  else if(b.votes[u.id]===p.id)delete b.votes[u.id];
}

export function changeAttachments(b,u,id,body,removeId){
  const p=editable(b,u,id);
  if(body.version!==p.version)fail(409,'貼文已更新，請重新開啟附件管理。');
  if(removeId){
    if(!p.attachments.some(a=>a.id===removeId))fail(404,'找不到附件。');
    if(p.attachments.length===1&&!p.body&&!p.links?.length)fail(400,'請先加入文字或網址，才能移除最後一個附件。');
    p.attachments=p.attachments.filter(a=>a.id!==removeId);
  }else{
    const ids=body.ids;
    if(!Array.isArray(ids)||ids.length!==p.attachments.length||new Set(ids).size!==ids.length||ids.some(id=>!p.attachments.some(a=>a.id===id)))fail(400,'附件排序必須包含全部附件，不能重複或遺漏。');
    p.attachments=ids.map(id=>p.attachments.find(a=>a.id===id));
  }
  p.version++;
  if(b.moderation&&b.ownerId!==u.id&&p.status!=='uploading')p.status='pending';
}
