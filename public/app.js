const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#dialog');
const labels={wall:'牆面',grid:'網格',columns:'分欄',stream:'串流'};
let boardFilter='active',accessEpoch=0;
const lifecycleLabels={active:'使用中',archived:'已封存',trashed:'回收站'};
function canWrite(){return board?.lifecycle==='active'&&(board.isOwner||(!board.frozen&&(!board.deadlineAt||Date.now()<Date.parse(board.deadlineAt))));}
function taipeiInput(value){return value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';}
let session,board,boards=[],events,search='',view='',timer,loading=false,pendingRefresh=false;
const expanded=new Set();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=x=>new Date(x).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Taipei'});
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',4500);}
async function api(url,{method='GET',body,key=crypto.randomUUID()}={}){
  const options={method,headers:{}};
  if(method!=='GET')options.headers['Idempotency-Key']=key;
  if(body instanceof FormData)options.body=body;
  else if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(url,options),data=await response.json();
  if(!response.ok){const error=new Error(data.error||'操作失敗。');error.status=response.status;throw error;}return data;
}
function header(){
  const u=session.user;
  $('#header').innerHTML=`<a class="brand" href="/"><span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Google Padlet</a><div class="account">${session.demo?'<span class="badge amber">本機示範</span>':''}${u?`<span class="avatar">${esc(u.name.slice(0,1))}</span><span class="name">${esc(u.name)}</span><button class="quiet small" data-action="logout">登出</button>`:'<span class="muted">每個想法，都值得被看見</span>'}</div>`;
}
function login(){
  const returnTo=location.pathname+location.search;
  app.innerHTML=`<section class="login"><div><div class="eyebrow">A SPACE FOR EVERY IDEA</div><h1>讓想法，<br>在這裡相遇。</h1><p>一面牆，收藏全班的觀察與靈感。<br>分享作品、一起討論，將學習的軌跡留在老師的 Google Drive。</p><div class="login-art" aria-hidden="true"><div>✦<br>我觀察到…</div><div>↗<br>我的新發現</div><div>♡<br>給同學的回饋</div></div></div><div class="login-panel"><span class="badge green">課堂互動 · 作品分享</span><h2>歡迎來到互動牆</h2><p>使用學校帳號登入。學生只需要登入，不必授權存取自己的雲端硬碟。</p>${session.demo?`<div class="notice">示範資料僅存於這台伺服器，沒有連接 Google Drive。可用不同瀏覽器測試師生互動。</div><button class="primary" data-action="demo" data-role="teacher">以示範教師登入</button><button data-action="demo" data-role="student">以學生 01 登入</button><button data-action="demo" data-role="student2">以學生 02 登入</button>`:`<a class="primary login-link" href="/auth/login?returnTo=${encodeURIComponent(returnTo)}">使用 Google 帳號登入 →</a>`}${new URLSearchParams(location.search).has('authError')?'<p class="form-error">您已取消授權，可再次登入。</p>':''}</div></section>`;
}
async function init(){
  try{session=await api('/api/session');header();if(!session.user)return login();const id=new URLSearchParams(location.search).get('board');
    if(id){await loadBoard(id);connect(id);}else await home();
  }catch(e){app.innerHTML=`<div class="shell"><div class="empty"><h2>目前無法開啟</h2><p>${esc(e.message)}</p><a href="/">返回首頁</a></div></div>`;}
}
async function home(){
  events?.close();board=null;boards=await api('/api/boards');
  app.innerHTML=`<div class="shell"><div class="eyebrow">YOUR TEACHING SPACE</div><div class="hero"><div><h1>${session.user.teacher?'我的互動牆':'我的學習空間'}</h1><p class="muted">${session.user.teacher?'從一個提問開始，讓每個孩子的想法都有位置。':'開啟老師分享的連結，或掃描 QR Code 加入活動。'}</p></div>${session.user.teacher?'<button class="primary" data-action="create">＋ 建立互動牆</button>':''}</div>${!session.user.driveConnected&&session.user.teacher?'<div class="notice">先連接 Google Drive，讓互動牆保存到您自己的資料夾。 <a href="/auth/drive">連接 Google Drive →</a></div>':''}<div class="toolbar"><div class="toolbar-group"><span>${boards.length} 面互動牆</span>${session.user.teacher?`<select id="board-filter" aria-label="互動牆狀態">${Object.entries(lifecycleLabels).map(([k,v])=>`<option value="${k}" ${k===boardFilter?'selected':''}>${v}</option>`).join('')}</select>`:''}</div><input id="board-search" type="search" placeholder="搜尋互動牆…" aria-label="搜尋互動牆"></div><div id="board-list" class="boards"></div></div>`;renderBoards('');
}
function renderBoards(query){$('#board-list').innerHTML=boards.filter(b=>(b.lifecycle||'active')===boardFilter&&(b.title+b.description).includes(query)).map(b=>`<a class="board-card" href="/?board=${encodeURIComponent(b.id)}"><div class="board-cover" aria-hidden="true"><span></span><span></span><span></span></div><div class="board-info"><h3>${esc(b.title)}</h3><p>${esc(b.description.slice(0,90)||'一起留下今天的新發現。')}</p><div class="board-meta"><span>${b.isOwner?'我的牆':'已加入'} · ${lifecycleLabels[b.lifecycle||'active']} · ${labels[b.layout]}${b.frozen?' · 已凍結':''}</span><span>${date(b.updatedAt)}</span></div></div></a>`).join('')||'<div class="empty"><span class="symbol">✦</span><h3>這裡準備好收藏新想法了</h3><p class="muted">教師可以建立第一面牆；學生請使用老師提供的活動連結。</p></div>';}
async function loadBoard(id){
  if(loading){pendingRefresh=true;return;}loading=true;const epoch=accessEpoch;
  try{const data=await api('/api/boards/'+encodeURIComponent(id));if(epoch!==accessEpoch)return;board=data;if(!view)view=board.layout;renderBoard();}
  catch(e){if(e.status===403||e.status===401){events?.close();dialog.close();board=null;app.innerHTML='<div class="shell"><div class="empty"><h2>此互動牆目前無法存取</h2><p>老師可能已封存、回收或調整權限，或您的登入已到期。</p><a href="/">返回首頁</a></div></div>';}throw e;}
  finally{loading=false;if(pendingRefresh){pendingRefresh=false;void loadBoard(id).catch(e=>toast(e.message));}}
}
function connect(id){events?.close();events=new EventSource(`/api/boards/${encodeURIComponent(id)}/events`);events.addEventListener('refresh',()=>{
  // Do not replace an active comment input; refresh after it loses focus.
  if(document.activeElement?.closest('.comment-form')){pendingRefresh=true;return;}
  loadBoard(id).catch(e=>{events.close();toast(e.message);});
});events.addEventListener('revoked',()=>{accessEpoch++;pendingRefresh=false;events.close();dialog.close();board=null;app.innerHTML='<div class="shell"><div class="empty"><h2>此互動牆已停止分享</h2><a href="/">返回首頁</a></div></div>';});events.addEventListener('ready',()=>loadBoard(id).catch(e=>toast(e.message)));}
function syncText(){const s=board.sync;if(s.demo)return '本機示範：資料已存於本機，未連接 Drive';if(!board.isOwner)return '貼文已送出後，將由教師的 Drive 保存';if(s.error)return s.error;if(s.version>=s.current)return '✓ 已保存至教師 Google Drive';return '已保存至伺服器 · Drive 同步中…';}
function renderBoard(){
  const q=search,focused=document.activeElement?.id==='post-search',selection=focused?document.activeElement.selectionStart:0;
  app.innerHTML=`<div class="shell"><a class="eyebrow" href="/">← 返回我的互動牆</a><div class="hero"><div><div class="toolbar-group"><span class="badge green">${esc(board.domain)}</span><span class="badge">${lifecycleLabels[board.lifecycle]}</span>${board.frozen?'<span class="badge amber">已凍結</span>':''}${board.deadlineAt?`<span class="badge amber">臺灣時間 ${esc(taipeiInput(board.deadlineAt).replace('T',' '))} 截止</span>`:''}${board.maxPostsPerStudent?`<span class="badge">每人 ${board.maxPostsPerStudent} 篇</span>`:''}${board.moderation?'<span class="badge">教師審核</span>':''}</div><h1>${esc(board.title)}</h1><p class="muted">${esc(board.description)}</p><div class="sync">${esc(syncText())}${board.isOwner&&!session.demo?'<button class="quiet small" data-action="sync">重新同步</button>':''}</div></div><div class="toolbar-group"><button data-action="share">分享 / QR Code</button>${board.isOwner?'<button data-action="settings">設定</button><button data-action="manage">管理</button>':''}</div></div><div class="toolbar"><div class="toolbar-group"><input id="post-search" class="search" type="search" value="${esc(q)}" placeholder="搜尋貼文、作者…" aria-label="搜尋貼文"><select id="layout" aria-label="顯示版型">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${view===k?'selected':''}>${v}</option>`).join('')}</select><span class="muted small">${board.posts.length} 則分享</span></div><div class="toolbar-group">${board.isOwner?'<button class="quiet" data-action="export">JSON 備份</button><button class="quiet" data-action="csv">CSV 成果</button>':''}${canWrite()?'<button class="primary" data-action="post">＋ 新增貼文</button>':'<span class="badge">目前僅供瀏覽</span>'}</div></div><div id="posts"></div></div>`;
  renderPosts();if(focused){$('#post-search').focus();$('#post-search').setSelectionRange(selection,selection);}
}
function renderPosts(){const target=$('#posts');if(!target)return;const posts=board.posts.filter(p=>(p.title+p.body+p.authorName).toLowerCase().includes(search.toLowerCase()));
  target.className=view;
  if(!posts.length){target.innerHTML='<div class="empty"><span class="symbol">＋</span><h3>留下一個想法，開啟一段對話</h3><p class="muted">點選「新增貼文」，分享文字、圖片或 PDF。</p></div>';return;}
  target.innerHTML=view==='columns'?board.sections.map(s=>`<section class="column"><div class="column-heading"><strong>${esc(s)}</strong><span>${posts.filter(p=>p.section===s).length}</span></div>${posts.filter(p=>p.section===s).map(card).join('')}</section>`).join(''):posts.map(card).join('');
}
function card(p){const mine=p.authorId===session.user.id,edit=(mine||board.isOwner)&&canWrite(),write=canWrite();
  return `<article class="post ${p.color}" data-post="${p.id}"><div class="post-head"><span>${esc(p.authorName)}</span><span class="muted">${date(p.createdAt)}</span></div><div class="post-content">${p.status!=='published'?`<p><span class="badge amber">${p.status==='uploading'?'附件待完成 · 僅本人與教師可見':'待教師審核'}</span></p>`:''}<h3>${esc(p.title)}</h3><p>${esc(p.body)}</p>${p.attachments.map(a=>{const url=`/api/boards/${board.id}/posts/${p.id}/attachments/${a.id}`;return a.mime.startsWith('image/')?`<a class="attachment" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a.name)}" loading="lazy"></a>`:`<a class="attachment file" href="${url}">↧ ${esc(a.name)} · ${Math.ceil(a.size/1024)} KB</a>`;}).join('')}</div><div class="post-foot"><span class="section-tag">${esc(p.section)}</span><div class="post-actions">${p.status==='published'?`<button class="quiet small" data-action="like" data-id="${p.id}" aria-label="喜歡" aria-pressed="${p.liked}" ${write?'':'disabled'}>${p.liked?'♥':'♡'} ${p.likeCount}</button><button class="quiet small" data-action="comments" data-id="${p.id}" aria-expanded="${expanded.has(p.id)}">留言 ${p.comments.length}</button>`:''}${board.isOwner&&canWrite()&&p.status==='pending'?`<button class="accent small" data-action="approve" data-id="${p.id}">核准</button>`:''}${edit?`<button class="quiet small" data-action="edit" data-id="${p.id}">編輯</button><button class="quiet small danger" data-action="delete" data-id="${p.id}" aria-label="刪除貼文">×</button>`:''}</div></div>${expanded.has(p.id)?`<div class="comments">${p.comments.map(c=>`<div class="comment"><div class="comment-top"><strong>${esc(c.authorName)}</strong>${write&&(c.authorId===session.user.id||board.isOwner)?`<button class="quiet small danger" data-action="delete-comment" data-id="${p.id}" data-comment="${c.id}">刪除</button>`:''}</div><p>${esc(c.body)}</p></div>`).join('')}${write?`<form class="comment-form" data-form="comment" data-id="${p.id}"><input name="body" required maxlength="2000" placeholder="給同學一點回饋…" aria-label="留言內容"><button type="submit" class="small">送出</button></form>`:''}</div>`:''}</article>`;
}
function modal(title,html){dialog.innerHTML=`<div class="dialog-top"><h2>${esc(title)}</h2><button class="quiet" data-action="close" aria-label="關閉">✕</button></div>${html}`;if(!dialog.open)dialog.showModal();}
const actions=label=>`<div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" data-action="close">取消</button><button type="submit" class="primary">${label}</button></div>`;
function createDialog(){if(!session.user.driveConnected)return toast('請先在首頁連接 Google Drive。');modal('建立新的互動牆',`<form data-form="create"><label>互動牆名稱<input name="title" required maxlength="100" placeholder="例如：林家花園建築觀察"></label><label>活動說明<textarea name="description" maxlength="2000" placeholder="給孩子一個觀察方向或討論問題…"></textarea></label><label>版型<select name="layout">${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><p class="muted">正式模式會在您的 Google Drive / Google Padlet 下建立同名資料夾。</p>${actions('建立互動牆')}</form>`);}
function postDialog(p){const key=`draft:${session.user.id}:${board.id}:${p?.id||'new'}`;let saved;try{saved=JSON.parse(sessionStorage.getItem(key));}catch{}const value=saved||p||{};
  modal(p?'編輯貼文':'分享你的想法',`<form data-form="post" data-id="${p?.id||''}" data-version="${p?.version||''}" data-draft="${key}"><label>標題<input name="title" value="${esc(value.title||'')}" maxlength="160" placeholder="為你的發現取個名字"></label><label>內容<textarea name="body" required maxlength="10000" rows="5" placeholder="我觀察到…">${esc(value.body||'')}</textarea></label><div class="form-grid"><label>分區<select name="section">${board.sections.map(s=>`<option ${value.section===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>卡片色彩<select name="color">${[['cream','暖黃'],['blue','天空藍'],['pink','柔粉'],['green','草綠']].map(([k,v])=>`<option value="${k}" ${value.color===k?'selected':''}>${v}</option>`).join('')}</select></label></div><label>加入附件<input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf"><small>PNG、JPEG、WebP 或 PDF，單檔 10 MB；每篇最多 5 個。可再次編輯補傳。附件失敗會保留草稿。</small></label>${saved?'<p class="muted">已恢復此瀏覽器的文字草稿。</p>':''}${actions(p?'儲存變更':'發布貼文')}</form>`);
}
function settingsDialog(){modal('互動牆設定',`<form data-form="settings" data-version="${board.version}"><label>名稱<input name="title" value="${esc(board.title)}" required maxlength="100"></label><label>活動說明<textarea name="description" maxlength="2000">${esc(board.description)}</textarea></label><label>預設版型<select name="layout">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${board.layout===k?'selected':''}>${v}</option>`).join('')}</select></label><label>允許的學校網域<input name="domain" value="${esc(board.domain)}" required></label><label>限定學生名單（選填，每行一個電子郵件）<textarea name="allowedEmails" placeholder="空白表示該網域持有連結者皆可進入">${esc(board.allowedEmails.join('\n'))}</textarea></label><label>分區（每行一個）<textarea name="sections" required>${esc(board.sections.join('\n'))}</textarea><small>移除分區時，原有貼文會移到第一個分區。</small></label><label>截止時間（臺灣時間，可留白）<input type="datetime-local" name="deadlineAt" value="${taipeiInput(board.deadlineAt)}"><small>截止後學生只能瀏覽；教師可繼續管理。即使電腦在其他時區，這裡仍採臺灣時間。</small></label><label>每名學生發文上限<input type="number" name="maxPostsPerStudent" min="0" max="100" step="1" required value="${board.maxPostsPerStudent}"><small>0 表示不限。待審與待上傳也計入；回收站貼文不計入。</small></label><label class="check"><input type="checkbox" name="moderation" ${board.moderation?'checked':''}>學生新貼文與修改須經審核</label><label class="check"><input type="checkbox" name="frozen" ${board.frozen?'checked':''}>凍結：學生只能瀏覽</label>${!session.demo?'<p><a href="/auth/drive">重新連接 Google Drive →</a></p>':''}${actions('儲存設定')}</form>`);}
function manageDialog(){
  modal('互動牆管理',`<p>目前狀態：<strong>${lifecycleLabels[board.lifecycle]}</strong></p><div class="toolbar-group">
    <button data-action="template">複製教學模板</button><button data-action="trash-posts">貼文回收站</button>
    ${board.lifecycle!=='active'?`<button class="primary" data-action="lifecycle" data-state="active" data-version="${board.version}">還原互動牆</button>`:''}
    ${board.lifecycle==='active'?`<button data-action="lifecycle" data-state="archived" data-version="${board.version}">封存互動牆</button>`:''}
    ${board.lifecycle!=='trashed'?`<button class="danger" data-action="lifecycle" data-state="trashed" data-version="${board.version}">移至回收站</button>`:''}
    </div><p class="muted">封存與回收都會停止學生存取，保留原網址、資料和附件。這些是應用程式狀態，不會把 Drive 資料夾移到垃圾桶。尚未提供永久刪除。</p>`);
}
async function trashDialog(){
  const items=await api(`/api/boards/${board.id}/trash`);
  modal('貼文回收站',`<p class="muted">僅教師可還原。審核模式下還原的學生作品會重新等待審核。</p>${board.lifecycle!=='active'?'<div class="notice">請先還原互動牆，才能還原貼文。</div>':''}${items.map(p=>`<div class="comment"><h3>${esc(p.title||'無標題')}</h3><p>${esc(p.authorName)} · ${p.deletedAt?date(p.deletedAt):'較早版本刪除'}</p><button data-action="restore-post" data-id="${p.id}" ${board.lifecycle!=='active'?'disabled':''}>還原貼文</button></div>`).join('')||'<p>回收站目前沒有貼文。</p>'}`);
}
async function dispatch(button){const action=button.dataset.action,id=button.dataset.id,p=board?.posts.find(p=>p.id===id),base=board?`/api/boards/${board.id}`:'';
  if(action==='manage')return manageDialog();
  if(action==='trash-posts')return trashDialog();
  if(action==='template')return modal('複製教學模板',`<form data-form="template"><label>新互動牆名稱<input name="title" required maxlength="100" value="${esc(board.title.slice(0,90)+'（副本）')}"></label><p class="muted">複製說明、版型、分區、審核及每人上限。學生作品、名單、截止時間不會複製，新牆會開放投稿。</p>${actions('建立模板副本')}</form>`);
  if(action==='lifecycle'){
    const next=button.dataset.state;
    if(!confirm(next==='active'?'還原後會按原設定重新開放，確定繼續？':'學生將無法存取這面牆；資料與附件會保留，可隨時還原。確定繼續？'))return;
    await api(base+'/lifecycle',{method:'PATCH',body:{lifecycle:next,version:Number(button.dataset.version)}});dialog.close();await loadBoard(board.id);return;
  }
  if(action==='restore-post'){await api(base+'/posts/'+id+'/restore',{method:'POST',body:{}});await loadBoard(board.id);return trashDialog();}
  if(action==='csv'){location.assign(base+'/export.csv');return;}
  if(action==='close'){dialog.close();return;}
  if(action==='demo'){await api('/auth/demo',{method:'POST',body:{role:button.dataset.role}});return init();}
  if(action==='logout'){await api('/auth/logout',{method:'POST'});sessionStorage.clear();events?.close();location.assign('/');return;}
  if(action==='create')return createDialog();if(action==='post')return postDialog();if(action==='edit')return postDialog(p);if(action==='settings')return settingsDialog();
  if(action==='share'){modal('邀請全班一起參與',`<div class="qr"><img src="${base}/qr" alt="互動牆 QR Code"><p class="muted">學生掃描後，使用 ${esc(board.domain)} 帳號登入。</p><input id="share-url" readonly aria-label="分享網址" value="${esc(location.origin+'/?board='+board.id)}"><div class="dialog-actions"><button class="primary" data-action="copy">複製連結</button></div></div>`);return;}
  if(action==='copy'){await navigator.clipboard.writeText($('#share-url').value);toast('已複製連結');return;}
  if(action==='comments'){expanded.has(id)?expanded.delete(id):expanded.add(id);renderPosts();return;}
  if(action==='export'){location.assign(base+'/export');return;}
  if(action==='delete'){if(!confirm('確定將這則貼文移至回收站？教師可從「管理 → 貼文回收站」還原。'))return;await api(base+'/posts/'+id,{method:'DELETE'});}
  if(action==='delete-comment'){if(!confirm('確定刪除留言？'))return;await api(base+'/posts/'+id+'/comments/'+button.dataset.comment,{method:'DELETE'});}
  if(action==='approve')await api(base+'/posts/'+id+'/approve',{method:'POST',body:{}});
  if(action==='like')await api(base+'/posts/'+id+'/like',{method:'PUT',body:{liked:!p.liked}});
  if(action==='sync'){toast('正在同步至 Google Drive…');await api(base+'/sync',{method:'POST',body:{}});}
  await loadBoard(board.id);
}
document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;try{button.disabled=true;await dispatch(button);}catch(e){toast(e.message);}finally{button.disabled=false;}});
document.addEventListener('input',event=>{
  if(event.target.id==='board-search')renderBoards(event.target.value);
  if(event.target.id==='post-search'){search=event.target.value;renderPosts();}
  const form=event.target.closest('[data-draft]');if(form){const f=new FormData(form);try{sessionStorage.setItem(form.dataset.draft,JSON.stringify({title:f.get('title'),body:f.get('body'),section:f.get('section'),color:f.get('color')}));}catch{}}
});
document.addEventListener('change',event=>{if(event.target.id==='board-filter'){boardFilter=event.target.value;renderBoards($('#board-search').value);}
if(event.target.id==='layout'){view=event.target.value;renderPosts();}});
document.addEventListener('focusout',event=>{if(event.target.closest('.comment-form')&&pendingRefresh)setTimeout(()=>{if(board&&!document.activeElement?.closest('.comment-form')){pendingRefresh=false;loadBoard(board.id).catch(e=>toast(e.message));}},100);});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  const error=form.querySelector('.form-error');if(error)error.textContent='';const f=new FormData(form),base=board?`/api/boards/${board.id}`:'';
  // Keep the same key after a lost response; a user edit intentionally starts a new operation.
  if(!form.dataset.operation)form.dataset.operation=crypto.randomUUID();
  try{
    if(form.dataset.form==='template'){const result=await api(base+'/template',{method:'POST',key:form.dataset.operation,body:{title:f.get('title')}});location.assign('/?board='+result.id);return;}
    if(form.dataset.form==='create'){const result=await api('/api/boards',{method:'POST',key:form.dataset.operation,body:Object.fromEntries(f)});location.assign('/?board='+result.id);return;}
    if(form.dataset.form==='settings'){
      await api(base,{method:'PATCH',key:form.dataset.operation,body:{title:f.get('title'),description:f.get('description'),layout:f.get('layout'),domain:f.get('domain'),version:Number(form.dataset.version),
        allowedEmails:f.get('allowedEmails').split(/\s+/).filter(Boolean),sections:f.get('sections').split('\n').map(x=>x.trim()).filter(Boolean),moderation:f.has('moderation'),frozen:f.has('frozen'),deadlineAt:f.get('deadlineAt')?new Date(f.get('deadlineAt')+':00+08:00').toISOString():null,maxPostsPerStudent:Number(f.get('maxPostsPerStudent'))}});view=f.get('layout');
    }
    if(form.dataset.form==='post'){
      const file=f.get('file');if(file.size>10*1024*1024)throw new Error('附件超過 10 MB。');
      const body={title:f.get('title'),body:f.get('body'),section:f.get('section'),color:f.get('color'),version:Number(form.dataset.version),uploadPending:!!file.size};
      let postId=form.dataset.savedId;
      if(!postId){const result=await api(base+'/posts'+(form.dataset.id?'/'+form.dataset.id:''),{method:form.dataset.id?'PATCH':'POST',key:form.dataset.operation,body});postId=result.id;form.dataset.savedId=postId;}
      if(file.size){const data=new FormData();data.set('file',file);submit.textContent='正在上傳附件…';await api(base+'/posts/'+postId+'/attachments',{method:'POST',body:data,key:form.dataset.operation+'-file'});}
      sessionStorage.removeItem(form.dataset.draft);
    }
    if(form.dataset.form==='comment'){await api(base+'/posts/'+form.dataset.id+'/comments',{method:'POST',body:{body:f.get('body')},key:form.dataset.operation});form.reset();delete form.dataset.operation;}
    else dialog.close();
    await loadBoard(board.id);toast('已儲存'+(session.demo?'（本機示範）':''));
  }catch(e){
    if(form.dataset.form==='post'&&form.dataset.savedId){
      try{const current=await api(base),p=current.posts.find(p=>p.id===form.dataset.savedId);if(p){form.dataset.id=p.id;form.dataset.version=p.version;delete form.dataset.savedId;delete form.dataset.operation;}}catch{}
    }
    if(error)error.textContent=e.message;else toast(e.message);
  }finally{submit.disabled=false;if(form.dataset.form==='post')submit.textContent='儲存貼文 / 重試附件';}
});
// If a failed request is edited, do not replay the stale operation payload.
document.addEventListener('input',event=>{const form=event.target.closest('[data-form]');if(form&&!form.dataset.savedId)delete form.dataset.operation;});
init();
