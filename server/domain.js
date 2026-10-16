import {randomUUID} from 'node:crypto';
import {fail} from './store.js';
export const layouts = ['wall','grid','columns','stream'];
export function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400,'文字內容未填寫或超過長度限制。');
  return value.trim();
}
export function canRead(b,u) { return !!u && (b.ownerId === u.id || (u.hd === b.domain && (!b.allowedEmails.length || b.allowedEmails.includes(u.email)))); }
export function access(b,u) { if (!canRead(b,u)) fail(403,'您沒有這面牆的存取權限。'); }
export function owner(b,u) { if (b.ownerId !== u.id) fail(403,'只有建立這面牆的教師可以管理。'); }
export function writable(b,u) { access(b,u); if (b.frozen && b.ownerId !== u.id) fail(403,'互動牆已凍結。'); }
export function postFor(b,u,id) { access(b,u); const p = b.posts.find(x=>x.id===id && !x.deleted); if (!p || (p.status!=='published' && p.authorId!==u.id && b.ownerId!==u.id)) fail(404,'找不到貼文。'); return p; }
export function editable(b,u,id) { writable(b,u); const p=postFor(b,u,id); if (p.authorId!==u.id && b.ownerId!==u.id) fail(403,'只能修改自己的貼文。'); return p; }
export function newBoard(u, body, defaultDomain) {
  if (!u.teacher) fail(403,'只有教師名單中的帳號可以建立互動牆。');
  const now = new Date().toISOString();
  const b = {schemaVersion:1,id:randomUUID(),ownerId:u.id,title:text(body.title,100,true),description:text(body.description||'',2000),
    domain:defaultDomain,allowedEmails:[],layout:'wall',moderation:false,frozen:false,sections:['分享區','觀察與發現','提問與回饋'],
    posts:[],version:1,createdAt:now,updatedAt:now};
  if (layouts.includes(body.layout)) b.layout=body.layout;
  return b;
}
export function settings(b,u,body) {
  owner(b,u); if (body.version !== b.version) fail(409,'設定已被更新，請重新整理後再試。');
  b.title=text(body.title,100,true); b.description=text(body.description||'',2000);
  if (!layouts.includes(body.layout)) fail(400,'不支援的版型。'); b.layout=body.layout;
  if (typeof body.moderation!=='boolean' || typeof body.frozen!=='boolean') fail(400,'設定格式不正確。');
  b.moderation=body.moderation; b.frozen=body.frozen;
  const domain=text(body.domain,253,true).toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail(400,'網域格式不正確。'); b.domain=domain;
  if (!Array.isArray(body.allowedEmails) || body.allowedEmails.length>500) fail(400,'名單最多 500 人。');
  b.allowedEmails=[...new Set(body.allowedEmails.map(x=>text(x,254,true).toLowerCase()))];
  if (b.allowedEmails.some(x=>!x.endsWith('@'+domain))) fail(400,'名單中的帳號必須屬於指定網域。');
  if (!Array.isArray(body.sections) || !body.sections.length || body.sections.length>20) fail(400,'分區數必須在 1～20 之間。');
  const sections=[...new Set(body.sections.map(x=>text(x,50,true)))];
  for (const p of b.posts) if (!sections.includes(p.section)) p.section=sections[0];
  b.sections=sections;
}
function content(body,b) {
  const color=['cream','blue','pink','green'].includes(body.color)?body.color:'cream';
  return {title:text(body.title||'',160),body:text(body.body||'',10000,true),section:b.sections.includes(body.section)?body.section:b.sections[0],color};
}
export function addPost(b,u,body) {
  writable(b,u); if(b.posts.length>=1000) fail(400,'本版本每牆最多 1,000 篇貼文。');
  const p={...content(body,b),id:randomUUID(),authorId:u.id,authorName:u.name,createdAt:new Date().toISOString(),version:1,
    status:body.uploadPending?'uploading':b.moderation&&b.ownerId!==u.id?'pending':'published',comments:[],likes:[],attachments:[],deleted:false};
  b.posts.push(p); return {id:p.id};
}
export function editPost(b,u,id,body) {
  const p=editable(b,u,id); if(p.version!==body.version) fail(409,'貼文已被修改，請重新整理後再編輯。');
  Object.assign(p,content(body,b)); p.version++;
  p.status=body.uploadPending?'uploading':b.moderation&&b.ownerId!==u.id?'pending':'published';
  return {id:p.id};
}
export function removePost(b,u,id) { const p=editable(b,u,id); p.deleted=true; p.version++; }
export function approvePost(b,u,id) { owner(b,u); const p=postFor(b,u,id); if(p.status==='uploading') fail(400,'附件尚未完成，請先補傳或編輯文字後發布。'); p.status='published'; p.version++; }
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
  return {...b,allowedEmails:own?b.allowedEmails:[],
    posts:b.posts.filter(p=>!p.deleted&&(p.status==='published'||own||p.authorId===u.id)).map(p=>({...p,likes:undefined,likeCount:p.likes.length,liked:p.likes.includes(u.id),
      attachments:p.attachments.map(({driveId,localPath,...a})=>a)})),
    isOwner:own,sync: own?{demo,version:row.sync_version,current:row.version,error:row.sync_error,folderId:JSON.parse(row.drive).folderId||null}:{demo}};
}
