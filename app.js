const $=s=>document.querySelector(s),app=$('#app'),dialog=$('#dialog');
const themes=[['ivory','香檳金紋','象牙白・細金四葉紋'],['sage','鼠尾草葉','霧綠・疏葉枝紋'],['porcelain','青瓷雅弧','青瓷藍・流線拱紋'],['rose','玫瑰織錦','灰玫瑰・菱格花紋'],['noir','墨金扇影','深墨綠・香檳扇紋']];
const labels={wall:'牆面',grid:'網格',columns:'分欄',stream:'串流'};
let boardFilter='active',accessEpoch=0,dragState=null;
const lifecycleLabels={active:'使用中',archived:'已封存',trashed:'回收站'};
function canWrite(){return board?.lifecycle==='active'&&(board.isOwner||(!board.frozen&&(!board.deadlineAt||Date.now()<Date.parse(board.deadlineAt))));}
function taipeiInput(value){return value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';}
let session,board,boards=[],events,search='',view='',timer,loading=false,pendingRefresh=false;
const expanded=new Set(),activeEmbeds=new Map();
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=x=>new Date(x).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Taipei'});
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',4500);}
async function api(url,{method='GET',body,key=crypto.randomUUID(),headers={}}={}){
  return window.pagesDemo.request(url,{method,body,key,headers});
  const options={method,headers:{...headers}};
  if(method!=='GET')options.headers['Idempotency-Key']=key;
  if(body instanceof FormData)options.body=body;
  else if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(url,options),data=await response.json();
  if(!response.ok){const error=new Error(data.error||'操作失敗。');error.status=response.status;throw error;}return data;
}
function header(){
  const u=session.user;
  $('#header').innerHTML=`<a class="brand" href="./"><span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Google Padlet</a><div class="account">${session.demo?'<span class="badge amber">瀏覽器展示</span>':''}${u?`${u.teacher?'<button class="small" data-action="drive-check">Drive 連線檢查</button>':''}<span class="avatar">${esc(u.name.slice(0,1))}</span><span class="name">${esc(u.name)}</span><button class="quiet small" data-action="logout">登出</button>`:'<span class="muted">每個想法，都值得被看見</span>'}</div>`;
}
function login(){
  const returnTo=location.pathname+location.search;
  app.innerHTML=`<section class="login"><div><div class="eyebrow">A SPACE FOR EVERY IDEA</div><h1>讓想法，<br>在這裡相遇。</h1><p>一面牆，收藏全班的觀察與靈感。<br>分享作品、一起討論，將學習的軌跡留在老師的 Google Drive。</p><div class="login-art" aria-hidden="true"><div>✦<br>我觀察到…</div><div>↗<br>我的新發現</div><div>♡<br>給同學的回饋</div></div></div><div class="login-panel"><span class="badge green">課堂互動 · 作品分享</span><h2>歡迎來到互動牆</h2><p>使用學校帳號登入。學生只需要登入，不必授權存取自己的雲端硬碟。</p>${session.demo?`<div class="notice">展示資料只保存在目前瀏覽器，未連接 Google Drive，也不會與其他訪客同步。角色為模擬身分，不需帳號。</div><button class="primary" data-action="demo" data-role="teacher">以示範教師登入</button><button data-action="demo" data-role="student">以學生 01 登入</button><button data-action="demo" data-role="student2">以學生 02 登入</button>`:`<a class="primary login-link" href="/auth/login?returnTo=${encodeURIComponent(returnTo)}">使用 Google 帳號登入 →</a>`}${new URLSearchParams(location.search).has('authError')?'<p class="form-error">您已取消授權，可再次登入。</p>':''}</div></section>`;
}
async function init(){
  try{session=await api('/api/session');header();if(!session.user)return login();const id=new URLSearchParams(location.search).get('board');
    if(id){await loadBoard(id);connect(id);}else await home();
  }catch(e){app.innerHTML=`<div class="shell"><div class="empty"><h2>目前無法開啟</h2><p>${esc(e.message)}</p><a href="./">返回首頁</a></div></div>`;}
}
async function home(){
  events?.close();board=null;boards=await api('/api/boards');
  app.innerHTML=`<div class="shell"><div class="eyebrow">YOUR TEACHING SPACE</div><div class="hero"><div><h1>${session.user.teacher?'我的互動牆':'我的學習空間'}</h1><p class="muted">${session.user.teacher?'從一個提問開始，讓每個孩子的想法都有位置。':'開啟老師分享的連結，或掃描 QR Code 加入活動。'}</p></div>${session.user.teacher?'<button class="primary" data-action="create">＋ 建立互動牆</button>':''}</div>${!session.user.driveConnected&&session.user.teacher?'<div class="notice">先連接 Google Drive，讓互動牆保存到您自己的資料夾。 <a href="/auth/drive">連接 Google Drive →</a></div>':''}<div class="toolbar"><div class="toolbar-group"><span>${boards.length} 面互動牆</span>${session.user.teacher?`<select id="board-filter" aria-label="互動牆狀態">${Object.entries(lifecycleLabels).map(([k,v])=>`<option value="${k}" ${k===boardFilter?'selected':''}>${v}</option>`).join('')}</select>`:''}</div><input id="board-search" type="search" placeholder="搜尋互動牆…" aria-label="搜尋互動牆"></div><div id="board-list" class="boards"></div></div>`;renderBoards('');
}
function renderBoards(query){$('#board-list').innerHTML=boards.filter(b=>(b.lifecycle||'active')===boardFilter&&(b.title+b.description).includes(query)).map(b=>`<a class="board-card" href="./?board=${encodeURIComponent(b.id)}"><div class="board-cover" aria-hidden="true"><span></span><span></span><span></span></div><div class="board-info"><h3>${esc(b.title)}</h3><p>${esc(b.description.slice(0,90)||'一起留下今天的新發現。')}</p><div class="board-meta"><span>${b.isOwner?'我的牆':'已加入'} · ${lifecycleLabels[b.lifecycle||'active']} · ${labels[b.layout]}${b.frozen?' · 已凍結':''}</span><span>${date(b.updatedAt)}</span></div></div></a>`).join('')||'<div class="empty"><span class="symbol">✦</span><h3>這裡準備好收藏新想法了</h3><p class="muted">教師可以建立第一面牆；學生請使用老師提供的活動連結。</p></div>';}
async function loadBoard(id,preservePlayers=false){
  if(dragState&&preservePlayers){pendingRefresh=true;return;}
  if(loading){pendingRefresh=true;return;}loading=true;const epoch=accessEpoch;
  try{const data=await api('/api/boards/'+encodeURIComponent(id));if(epoch!==accessEpoch)return;if(dragState&&preservePlayers){pendingRefresh=true;return;}
    if(preservePlayers&&activeEmbeds.size&&board.posts.every(old=>data.posts.some(p=>p.id===old.id))&&[...activeEmbeds].every(([key,url])=>{const [postId,index]=key.split(':');const p=data.posts.find(p=>p.id===postId);return index.startsWith('file-')?p?.attachments.some(a=>a.id===index.slice(5)):p?.links?.[Number(index)]?.url===url;})){
      if(data.version!==board.version){const notice=$('#media-update');if(notice)notice.hidden=false;}return;
    }
    board=data;if(!view)view=board.layout;renderBoard();}
  catch(e){if(e.status===403||e.status===401){events?.close();dialog.close();board=null;app.innerHTML='<div class="shell"><div class="empty"><h2>此互動牆目前無法存取</h2><p>老師可能已封存、回收或調整權限，或您的登入已到期。</p><a href="./">返回首頁</a></div></div>';}throw e;}
  finally{loading=false;if(pendingRefresh){pendingRefresh=false;void loadBoard(id,true).catch(e=>toast(e.message));}}
}
function connect(id){return;events?.close();events=new EventSource(`/api/boards/${encodeURIComponent(id)}/events`);events.addEventListener('refresh',()=>{
  // Do not replace an active comment input; refresh after it loses focus.
  if(dragState||document.activeElement?.closest('.comment-form')){pendingRefresh=true;return;}
  loadBoard(id,true).catch(e=>{events.close();toast(e.message);});
});events.addEventListener('revoked',()=>{accessEpoch++;pendingRefresh=false;clearDrag();activeEmbeds.clear();events.close();dialog.close();board=null;app.innerHTML='<div class="shell"><div class="empty"><h2>此互動牆已停止分享</h2><a href="./">返回首頁</a></div></div>';});events.addEventListener('ready',()=>loadBoard(id,true).catch(e=>toast(e.message)));}
function syncText(){const s=board.sync;if(s.demo)return '瀏覽器展示：資料僅存在目前瀏覽器，未連接 Drive';if(!board.isOwner)return '貼文已送出後，將由教師的 Drive 保存';if(s.error)return s.error;if(s.version>=s.current)return '✓ 已保存至教師 Google Drive';return '已保存至伺服器 · Drive 同步中…';}
function currentTheme(){return themes.some(([id])=>id===board.theme)?board.theme:board.background?'custom':'ivory';}
function themeButtons(){
  const current=currentTheme();
  if(!board.isOwner)return '';
  return `<section class="theme-picker" aria-label="切換互動牆佈景"><div class="theme-title"><strong>佈景主題</strong><span>點選切換，全班同步顯示</span></div><div class="theme-options">${themes.map(([id,name,description])=>`<button type="button" class="theme-choice" data-action="theme" data-theme="${id}" aria-pressed="${current===id}" ${canWrite()?'':'disabled'}><span class="theme-swatch theme-${id}" aria-hidden="true"></span><strong>${name}</strong><small>${description}</small><span class="theme-selected">${current===id?'✓ 使用中':'套用主題'}</span></button>`).join('')}${board.background?`<button type="button" class="theme-choice custom-choice" data-action="theme" data-theme="custom" aria-pressed="${current==='custom'}" ${canWrite()?'':'disabled'}><strong>自訂底圖</strong><small>${esc(board.background.name)}</small><span class="theme-selected">${current==='custom'?'✓ 使用中':'切回自訂底圖'}</span></button>`:''}</div></section>`;
}
function renderBoard(){
  const q=search,focused=document.activeElement?.id==='post-search',selection=focused?document.activeElement.selectionStart:0;
  app.innerHTML=`<div class="shell"><a class="eyebrow" href="./">← 返回我的互動牆</a><div class="hero"><div><div class="toolbar-group"><span class="badge green">${esc(board.domain)}</span><span class="badge">${lifecycleLabels[board.lifecycle]}</span>${board.frozen?'<span class="badge amber">已凍結</span>':''}${board.deadlineAt?`<span class="badge amber">臺灣時間 ${esc(taipeiInput(board.deadlineAt).replace('T',' '))} 截止</span>`:''}${board.maxPostsPerStudent?`<span class="badge">每人 ${board.maxPostsPerStudent} 篇</span>`:''}${board.votingEnabled?'<span class="badge green">投票中 · 每人一票</span>':''}${board.moderation?'<span class="badge">教師審核</span>':''}</div><h1>${esc(board.title)}</h1><p class="muted">${esc(board.description)}</p><div class="sync">${esc(syncText())}${board.isOwner&&!session.demo?'<button class="quiet small" data-action="sync">重新同步</button>':''}</div></div><div class="toolbar-group"><button data-action="share">分享 / QR Code</button>${board.isOwner?'<button data-action="settings">設定</button><button data-action="background">底圖</button><button data-action="manage">管理</button>':''}</div></div><div class="toolbar"><div class="toolbar-group"><input id="post-search" class="search" type="search" value="${esc(q)}" placeholder="搜尋貼文、作者…" aria-label="搜尋貼文"><select id="layout" aria-label="顯示版型">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${view===k?'selected':''}>${v}</option>`).join('')}</select><span class="muted small">${board.posts.length} 則分享</span></div><div class="toolbar-group">${board.isOwner?'<button class="quiet" data-action="export">JSON 備份</button><button class="quiet" data-action="csv">CSV 成果</button>':''}${canWrite()?'<button class="primary" data-action="post">＋ 新增貼文</button>':'<span class="badge">目前僅供瀏覽</span>'}</div></div><div id="media-update" class="notice" hidden>牆上有新內容。<button class="small" data-action="media-refresh">停止影音並更新</button></div>${themeButtons()}<div id="wall-surface" class="wall-surface"><div id="posts"></div></div></div>`;
  const surface=$('#wall-surface'),theme=currentTheme();surface.classList.add('theme-'+theme);if(theme==='custom'&&board.background){surface.classList.add('has-background');surface.style.backgroundImage=`url("${window.pagesDemo.asset(board.background.id)}")`;surface.style.backgroundSize=board.background.mode==='width'?'100% auto':'auto';surface.style.backgroundRepeat=board.background.mode==='width'?'repeat-y':'repeat';}
  renderPosts();if(focused){$('#post-search').focus();$('#post-search').setSelectionRange(selection,selection);}
}
function renderPosts(){activeEmbeds.clear();const notice=$('#media-update');if(notice)notice.hidden=true;const target=$('#posts');if(!target)return;const posts=board.posts.filter(p=>(p.title+p.body+p.authorName+(p.links||[]).map(l=>l.url).join(' ')).toLowerCase().includes(search.toLowerCase()));
  target.className=view;
  if(!posts.length){target.innerHTML='<div class="empty"><span class="symbol">＋</span><h3>留下一個想法，開啟一段對話</h3><p class="muted">點選「新增貼文」，分享文字、圖片或 PDF。</p></div>';return;}
  target.innerHTML=view==='columns'?board.sections.map(s=>`<section class="column"><div class="column-heading"><strong>${esc(s)}</strong><span>${posts.filter(p=>p.section===s).length}</span></div>${posts.filter(p=>p.section===s).map(card).join('')}</section>`).join(''):posts.map(card).join('');
}
function linkCards(p){
  return (p.links||[]).map((link,index)=>{
    const playable=['youtube','video','audio'].includes(link.kind),label={youtube:'YouTube 影片',video:'影片直連',audio:'音訊直連',link:'網頁連結'}[link.kind]||'網頁連結';
    return `<section class="link-card"><div class="link-heading"><strong>${label}</strong><span>${esc(link.host)}</span></div><a class="external-url" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.url)}</a>${playable?`<div class="media-slot" id="media-${p.id}-${index}"><button type="button" data-action="play-media" data-id="${p.id}" data-index="${index}">▶ 載入${link.kind==='audio'?'音訊':'影片'}</button><small>點選後連線至外部影音服務，不會自動播放。</small></div><p class="media-fallback">無法播放？<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">開啟原始網址 ↗</a></p>`:''}</section>`;
  }).join('');
}
function playMedia(post,index){
  const link=post?.links?.[index],slot=$(`#media-${post?.id}-${index}`);if(!link||!slot)return;
  const key=post.id+':'+index;let player;
  if(link.kind==='youtube'&&/^[\w-]{11}$/.test(link.videoId)){
    player=document.createElement('iframe');
    player.src=`https://www.youtube-nocookie.com/embed/${link.videoId}?playsinline=1&autoplay=0&start=${Number(link.startSeconds)||0}`;
    player.title=post.title||'YouTube 影片播放器';player.allow='encrypted-media; picture-in-picture; fullscreen';player.allowFullscreen=true;
    // YouTube requires a referrer identifying the embedding origin; override the site's same-origin policy.
    player.referrerPolicy='strict-origin-when-cross-origin';
  }else if(['audio','video'].includes(link.kind)&&link.url.startsWith('https://')){
    player=document.createElement(link.kind);player.src=link.url;player.controls=true;player.preload='metadata';player.playsInline=true;
    player.addEventListener('error',()=>toast('此影音無法載入，請嘗試原始網址。'));
  }else return;
  const stop=document.createElement('button');stop.type='button';stop.textContent='關閉播放器';stop.className='small';
  stop.addEventListener('click',()=>{player.remove();activeEmbeds.delete(key);if(!activeEmbeds.size)loadBoard(board.id).catch(e=>toast(e.message));else{slot.replaceChildren();const again=document.createElement('button');again.textContent='重新載入';again.addEventListener('click',()=>playMedia(post,index));slot.append(again);}});
  slot.replaceChildren(player,stop);activeEmbeds.set(key,link.url);
}
function attachmentUrl(p,a){return window.pagesDemo.asset(a.id);}
function attachmentCards(p){return p.attachments.map(a=>{
  const url=attachmentUrl(p,a),media=/^(audio|video)\//.test(a.mime);
  if(a.mime.startsWith('image/'))return `<a class="attachment" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a.name)}" loading="lazy"></a>`;
  return `<section class="attachment file"><strong>${esc(a.name)}</strong><p>${(a.size/1024/1024).toFixed(1)} MB</p>${media?`<div class="media-slot" id="file-${p.id}-${a.id}"><button data-action="play-file" data-id="${p.id}" data-attachment="${a.id}">▶ 載入${a.mime.startsWith('audio/')?'音訊':'影片'}</button></div><p class="muted">播放相容性取決於瀏覽器與編碼，可下載原檔。</p>`:''}<a class="external-url" href="${url}" download>↧ 下載原檔</a></section>`;
}).join('');}
function playFile(p,id){
  const a=p?.attachments.find(a=>a.id===id),slot=$(`#file-${p?.id}-${id}`);if(!a||!slot||!/^(audio|video)\//.test(a.mime))return;
  const player=document.createElement(a.mime.startsWith('audio/')?'audio':'video');player.controls=true;player.preload='metadata';player.playsInline=true;player.src=attachmentUrl(p,a);
  player.addEventListener('error',()=>toast('無法播放此編碼或檔案已不可存取，請嘗試下載原檔。'));
  const stop=document.createElement('button');stop.textContent='關閉播放器';stop.className='small';
  stop.addEventListener('click',()=>{player.pause();player.removeAttribute('src');player.load();activeEmbeds.delete(p.id+':file-'+id);loadBoard(board.id).catch(e=>toast(e.message));});
  slot.replaceChildren(player,stop);activeEmbeds.set(p.id+':file-'+id,player.src);
}
function attachmentsDialog(p){
  if(!p){dialog.close();return;}
  modal('附件管理',`<p class="muted">依此順序顯示。每次調整會立即儲存；學生修改後依教師設定重新審核。刪除只解除貼文關聯，原檔私有保留。</p>${p.attachments.map((a,i)=>`<div class="attachment-row"><span>${i+1}. ${esc(a.name)}</span><div class="toolbar-group"><button data-action="attachment-up" data-id="${p.id}" data-attachment="${a.id}" data-version="${p.version}" ${i===0?'disabled':''} aria-label="附件上移">↑</button><button data-action="attachment-down" data-id="${p.id}" data-attachment="${a.id}" data-version="${p.version}" ${i===p.attachments.length-1?'disabled':''} aria-label="附件下移">↓</button><button class="danger" data-action="attachment-delete" data-id="${p.id}" data-attachment="${a.id}" data-version="${p.version}">刪除</button></div></div>`).join('')||'<p>目前沒有附件。</p>'}<div class="dialog-actions"><button data-action="edit" data-id="${p.id}">編輯貼文／加入附件</button><button data-action="close">完成</button></div>`);
}
function card(p){const mine=p.authorId===session.user.id,edit=(mine||board.isOwner)&&canWrite(),write=canWrite();
  return `<article class="post ${p.color}" data-post="${p.id}">${board.isOwner&&write?`<div class="reorder-tools"><button type="button" class="drag-handle small" data-drag="${p.id}" aria-label="拖曳排序貼文">⠿ 拖曳排序</button><button class="small" data-action="move-up" data-id="${p.id}" aria-label="貼文上移">↑</button><button class="small" data-action="move-down" data-id="${p.id}" aria-label="貼文下移">↓</button></div>`:''}<div class="post-head"><span>${esc(p.authorName)}</span><span class="muted">${date(p.createdAt)}</span></div><div class="post-content">${p.status!=='published'?`<p><span class="badge amber">${p.status==='uploading'?'附件待完成 · 僅本人與教師可見':'待教師審核'}</span></p>`:''}<h3>${esc(p.title)}</h3><p>${esc(p.body)}</p>${linkCards(p)}${attachmentCards(p)}</div><div class="post-foot"><span class="section-tag">${esc(p.section)}</span><div class="post-actions">${p.status==='published'?`<button class="quiet small" data-action="like" data-id="${p.id}" aria-label="喜歡" aria-pressed="${p.liked}" ${write?'':'disabled'}>${p.liked?'♥':'♡'} ${p.likeCount}</button><button class="quiet small" data-action="vote" data-id="${p.id}" aria-pressed="${!!p.voted}" ${write&&board.votingEnabled?'':'disabled'}>${p.voted?'✓ 已投票':'投票'} ${p.voteCount||0}</button><button class="quiet small" data-action="comments" data-id="${p.id}" aria-expanded="${expanded.has(p.id)}">留言 ${p.comments.length}</button>`:''}${board.isOwner&&canWrite()&&p.status==='pending'?`<button class="accent small" data-action="approve" data-id="${p.id}">核准</button>`:''}${edit?`<button class="quiet small" data-action="attachments" data-id="${p.id}">附件 ${p.attachments.length}</button><button class="quiet small" data-action="edit" data-id="${p.id}">編輯</button><button class="quiet small danger" data-action="delete" data-id="${p.id}" aria-label="刪除貼文">×</button>`:''}</div></div>${expanded.has(p.id)?`<div class="comments">${p.comments.map(c=>`<div class="comment"><div class="comment-top"><strong>${esc(c.authorName)}</strong>${write&&(c.authorId===session.user.id||board.isOwner)?`<button class="quiet small danger" data-action="delete-comment" data-id="${p.id}" data-comment="${c.id}">刪除</button>`:''}</div><p>${esc(c.body)}</p></div>`).join('')}${write?`<form class="comment-form" data-form="comment" data-id="${p.id}"><input name="body" required maxlength="2000" placeholder="給同學一點回饋…" aria-label="留言內容"><button type="submit" class="small">送出</button></form>`:''}</div>`:''}</article>`;
}
function modal(title,html){dialog.innerHTML=`<div class="dialog-top"><h2>${esc(title)}</h2><button class="quiet" data-action="close" aria-label="關閉">✕</button></div>${html}`;if(!dialog.open)dialog.showModal();}
const actions=label=>`<div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" data-action="close">取消</button><button type="submit" class="primary">${label}</button></div>`;
function createDialog(){if(!session.user.driveConnected)return toast('請先在首頁連接 Google Drive。');modal('建立新的互動牆',`<form data-form="create"><label>互動牆名稱<input name="title" required maxlength="100" placeholder="例如：林家花園建築觀察"></label><label>活動說明<textarea name="description" maxlength="2000" placeholder="給孩子一個觀察方向或討論問題…"></textarea></label><label>版型<select name="layout">${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><p class="muted">正式模式會在您的 Google Drive / Google Padlet 下建立同名資料夾。</p>${actions('建立互動牆')}</form>`);}
function postDialog(p){const key=`draft:${session.user.id}:${board.id}:${p?.id||'new'}`;let saved;try{saved=JSON.parse(sessionStorage.getItem(key));}catch{}const value=saved||p||{};
  modal(p?'編輯貼文':'分享你的想法',`<form data-form="post" data-id="${p?.id||''}" data-version="${p?.version||''}" data-draft="${key}"><label>標題<input name="title" value="${esc(value.title||'')}" maxlength="160" placeholder="為你的發現取個名字"></label><label>內容<textarea name="body" maxlength="10000" rows="5" placeholder="我觀察到…">${esc(value.body||'')}</textarea></label><label>網址與影音連結（每行一個，最多 20 個）<textarea name="links" rows="3" maxlength="40979" placeholder="https://www.youtube.com/watch?v=…&#10;https://…">${esc(typeof value.links==='string'?value.links:(value.links||[]).map(l=>l.url).join('\n'))}</textarea><small>支援一般網址、YouTube、HTTPS MP4／WebM 與 MP3／M4A／OGG／WAV 直連。只分享網址時可不填內文；不需要貼 iframe 程式碼。</small></label><div class="form-grid"><label>分區<select name="section">${board.sections.map(s=>`<option ${value.section===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>卡片色彩<select name="color">${[['cream','暖黃'],['blue','天空藍'],['pink','柔粉'],['green','草綠']].map(([k,v])=>`<option value="${k}" ${value.color===k?'selected':''}>${v}</option>`).join('')}</select></label></div><label>加入附件<input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg,.m4a,.mp3,.wav,.ogg"><small>圖片／PDF 單檔 10 MB；MP4、WebM、MP3、M4A、WAV、OGG 音訊單檔 50 MB。展示版每檔最多 5 MB，每篇合計最多 5 個檔案；可再次編輯補傳，或從卡片「附件」管理順序與刪除。只上傳檔案可不填文字；失敗後請重新選檔重試。</small></label>${saved?'<p class="muted">已恢復此瀏覽器的文字草稿。</p>':''}${actions(p?'儲存變更':'發布貼文')}</form>`);
}
function settingsDialog(){modal('互動牆設定',`<form data-form="settings" data-version="${board.version}"><label>名稱<input name="title" value="${esc(board.title)}" required maxlength="100"></label><label>活動說明<textarea name="description" maxlength="2000">${esc(board.description)}</textarea></label><label>預設版型<select name="layout">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${board.layout===k?'selected':''}>${v}</option>`).join('')}</select></label><label>允許的學校網域<input name="domain" value="${esc(board.domain)}" required></label><label>限定學生名單（選填，每行一個電子郵件）<textarea name="allowedEmails" placeholder="空白表示該網域持有連結者皆可進入">${esc(board.allowedEmails.join('\n'))}</textarea></label><label>分區（每行一個）<textarea name="sections" required>${esc(board.sections.join('\n'))}</textarea><small>移除分區時，原有貼文會移到第一個分區。</small></label><label>截止時間（臺灣時間，可留白）<input type="datetime-local" name="deadlineAt" value="${taipeiInput(board.deadlineAt)}"><small>截止後學生只能瀏覽；教師可繼續管理。即使電腦在其他時區，這裡仍採臺灣時間。</small></label><label>每名學生發文上限<input type="number" name="maxPostsPerStudent" min="0" max="100" step="1" required value="${board.maxPostsPerStudent}"><small>0 表示不限。待審與待上傳也計入；回收站貼文不計入。</small></label><label class="check"><input type="checkbox" name="moderation" ${board.moderation?'checked':''}>學生新貼文與修改須經審核</label><label class="check"><input type="checkbox" name="votingEnabled" ${board.votingEnabled?'checked':''}>開啟貼文投票（每人一票，可改投或取消）</label><label class="check"><input type="checkbox" name="frozen" ${board.frozen?'checked':''}>凍結：學生只能瀏覽</label>${!session.demo?'<p><a href="/auth/drive">重新連接 Google Drive →</a></p>':''}${actions('儲存設定')}</form>`);}
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
  if(action==='drive-check'){
    const result=await api('/api/drive/check',{method:'POST',body:{}});
    modal('Google Drive 連線檢查',`<div class="notice" role="status">${esc(result.message)}</div><p>檢查代碼：${esc(result.code)}</p>${!session.demo?'<p><a class="primary login-link" href="/auth/drive">連接／重新連接 Google Drive</a></p>':''}<p class="muted">此檢查不會建立或刪除檔案。連線成功後，請建立測試牆並確認「已保存至教師 Google Drive」。</p>`);return;
  }
  if(action==='theme'){if(currentTheme()===button.dataset.theme)return;await api(base+'/theme',{method:'PATCH',body:{theme:button.dataset.theme,version:board.version}});await loadBoard(board.id);toast('已套用佈景主題');return;}
  if(action==='attachments')return attachmentsDialog(p);
  if(action==='play-file')return playFile(p,button.dataset.attachment);
  if(action==='attachment-delete'||action==='attachment-up'||action==='attachment-down'){
    const attachmentId=button.dataset.attachment,version=Number(button.dataset.version);
    if(action==='attachment-delete'){
      if(!confirm('從貼文移除此附件？原連結將失效，Drive 原檔仍私有保留。'))return;
      await api(base+'/posts/'+id+'/attachments/'+attachmentId,{method:'DELETE',body:{version}});
    }else{
      const ids=p.attachments.map(a=>a.id),index=ids.indexOf(attachmentId),next=index+(action==='attachment-up'?-1:1);
      if(index<0||next<0||next>=ids.length)return;
      [ids[index],ids[next]]=[ids[next],ids[index]];
      await api(base+'/posts/'+id+'/attachments',{method:'PATCH',body:{version,ids}});
    }
    await loadBoard(board.id);attachmentsDialog(board.posts.find(x=>x.id===id));return;
  }
  if(action==='background')return backgroundDialog();
  if(action==='move-up'||action==='move-down'){const posts=visiblePosts(),index=posts.findIndex(x=>x.id===id),target=posts[index+(action==='move-up'?-1:1)];if(target)await movePost(id,target.id,action==='move-up'?'before':'after');return;}
  if(action==='play-media')return playMedia(p,Number(button.dataset.index));
  if(action==='media-refresh'){await loadBoard(board.id);return;}
  if(action==='manage')return manageDialog();
  if(action==='trash-posts')return trashDialog();
  if(action==='template')return modal('複製教學模板',`<form data-form="template"><label>新互動牆名稱<input name="title" required maxlength="100" value="${esc(board.title.slice(0,90)+'（副本）')}"></label><p class="muted">複製說明、版型、分區、審核及每人上限。學生作品、名單、截止時間不會複製，新牆會開放投稿。</p>${actions('建立模板副本')}</form>`);
  if(action==='lifecycle'){
    const next=button.dataset.state;
    if(!confirm(next==='active'?'還原後會按原設定重新開放，確定繼續？':'學生將無法存取這面牆；資料與附件會保留，可隨時還原。確定繼續？'))return;
    await api(base+'/lifecycle',{method:'PATCH',body:{lifecycle:next,version:Number(button.dataset.version)}});dialog.close();await loadBoard(board.id);return;
  }
  if(action==='restore-post'){await api(base+'/posts/'+id+'/restore',{method:'POST',body:{}});await loadBoard(board.id);return trashDialog();}
  if(action==='csv'){window.pagesDemo.download(board.id,true);return;}
  if(action==='close'){dialog.close();return;}
  if(action==='demo'){await api('/auth/demo',{method:'POST',body:{role:button.dataset.role}});return init();}
  if(action==='logout'){await api('/auth/logout',{method:'POST'});sessionStorage.clear();events?.close();location.assign('./');return;}
  if(action==='create')return createDialog();if(action==='post')return postDialog();if(action==='edit')return postDialog(p);if(action==='settings')return settingsDialog();
  if(action==='share'){modal('展示版分享',`<p>此連結只開啟展示網站，不會分享您瀏覽器裡的貼文。其他訪客擁有各自的示範資料。</p><input id="share-url" readonly value="${esc(new URL('./',location.href).href)}"><button data-action="copy">複製展示網址</button>`);return;}
  if(action==='copy'){await navigator.clipboard.writeText($('#share-url').value);toast('已複製連結');return;}
  if(action==='comments'){expanded.has(id)?expanded.delete(id):expanded.add(id);renderPosts();return;}
  if(action==='export'){window.pagesDemo.download(board.id,false);return;}
  if(action==='delete'){if(!confirm('確定將這則貼文移至回收站？教師可從「管理 → 貼文回收站」還原。'))return;await api(base+'/posts/'+id,{method:'DELETE'});}
  if(action==='delete-comment'){if(!confirm('確定刪除留言？'))return;await api(base+'/posts/'+id+'/comments/'+button.dataset.comment,{method:'DELETE'});}
  if(action==='approve')await api(base+'/posts/'+id+'/approve',{method:'POST',body:{}});
  if(action==='vote')await api(base+'/posts/'+id+'/vote',{method:'PUT',body:{voted:!p.voted}});
  if(action==='like')await api(base+'/posts/'+id+'/like',{method:'PUT',body:{liked:!p.liked}});
  if(action==='sync'){toast('正在同步至 Google Drive…');await api(base+'/sync',{method:'POST',body:{}});}
  await loadBoard(board.id);
}
document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;try{button.disabled=true;await dispatch(button);}catch(e){toast(e.message);}finally{button.disabled=false;}});
document.addEventListener('input',event=>{
  if(event.target.id==='board-search')renderBoards(event.target.value);
  if(event.target.id==='post-search'){search=event.target.value;renderPosts();}
  const form=event.target.closest('[data-draft]');if(form){const f=new FormData(form);try{sessionStorage.setItem(form.dataset.draft,JSON.stringify({title:f.get('title'),body:f.get('body'),section:f.get('section'),color:f.get('color'),links:f.get('links')}));}catch{}}
});
document.addEventListener('change',event=>{if(event.target.id==='board-filter'){boardFilter=event.target.value;renderBoards($('#board-search').value);}
if(event.target.id==='layout'){view=event.target.value;renderPosts();}});
document.addEventListener('focusout',event=>{if(event.target.closest('.comment-form')&&pendingRefresh)setTimeout(()=>{if(board&&!document.activeElement?.closest('.comment-form')){pendingRefresh=false;loadBoard(board.id,true).catch(e=>toast(e.message));}},100);});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  const error=form.querySelector('.form-error');if(error)error.textContent='';const f=new FormData(form),base=board?`/api/boards/${board.id}`:'';
  // Keep the same key after a lost response; a user edit intentionally starts a new operation.
  if(!form.dataset.operation)form.dataset.operation=crypto.randomUUID();
  try{
    if(form.dataset.form==='template'){const result=await api(base+'/template',{method:'POST',key:form.dataset.operation,body:{title:f.get('title')}});location.assign('./?board='+result.id);return;}
    if(form.dataset.form==='create'){const result=await api('/api/boards',{method:'POST',key:form.dataset.operation,body:Object.fromEntries(f)});location.assign('./?board='+result.id);return;}
    if(form.dataset.form==='background'){
      const file=f.get('file'),mode=f.get('mode'),version=Number(form.dataset.version);
      if(f.has('remove'))await api(base+'/background',{method:'PATCH',key:form.dataset.operation,body:{version,mode:null}});
      else if(file.size){
        if(file.size>10*1024*1024)throw new Error('底圖超過 10 MB。');
        const data=new FormData();data.set('file',file);submit.textContent='正在上傳底圖…';
        await api(base+'/background',{method:'POST',key:form.dataset.operation,body:data,headers:{'X-Board-Version':String(version),'X-Background-Mode':mode}});
      }else await api(base+'/background',{method:'PATCH',key:form.dataset.operation,body:{version,mode}});
    }
    if(form.dataset.form==='settings'){
      await api(base,{method:'PATCH',key:form.dataset.operation,body:{title:f.get('title'),description:f.get('description'),layout:f.get('layout'),domain:f.get('domain'),version:Number(form.dataset.version),
        allowedEmails:f.get('allowedEmails').split(/\s+/).filter(Boolean),sections:f.get('sections').split('\n').map(x=>x.trim()).filter(Boolean),moderation:f.has('moderation'),votingEnabled:f.has('votingEnabled'),frozen:f.has('frozen'),deadlineAt:f.get('deadlineAt')?new Date(f.get('deadlineAt')+':00+08:00').toISOString():null,maxPostsPerStudent:Number(f.get('maxPostsPerStudent'))}});view=f.get('layout');
    }
    if(form.dataset.form==='post'){
      const file=form.pendingFile||f.get('file');if(file.size>50*1024*1024)throw new Error('影音附件超過 50 MB。');
      const body={title:f.get('title'),body:f.get('body'),section:f.get('section'),color:f.get('color'),version:Number(form.dataset.version),uploadPending:!!file.size,links:String(f.get('links')||'').split('\n').map(x=>x.trim()).filter(Boolean)};
      let postId=form.dataset.savedId;
      if(!postId){const result=await api(base+'/posts'+(form.dataset.id?'/'+form.dataset.id:''),{method:form.dataset.id?'PATCH':'POST',key:form.dataset.operation,body});postId=result.id;form.dataset.savedId=postId;form.pendingFile=file;}
      if(file.size){const data=new FormData();data.set('file',file);submit.textContent='正在上傳附件…';await api(base+'/posts/'+postId+'/attachments',{method:'POST',body:data,key:form.dataset.operation+'-file'});}
      sessionStorage.removeItem(form.dataset.draft);
    }
    if(form.dataset.form==='comment'){await api(base+'/posts/'+form.dataset.id+'/comments',{method:'POST',body:{body:f.get('body')},key:form.dataset.operation});form.reset();delete form.dataset.operation;}
    else dialog.close();
    await loadBoard(board.id);toast('已儲存'+(session.demo?'（瀏覽器展示）':''));
  }catch(e){
    if(form.dataset.form==='post'&&form.dataset.savedId){
      form.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);
      e.message='貼文已儲存，附件未確認完成。可按重試，或關閉後重新編輯。'+e.message;
    }
    if(error)error.textContent=e.message;else toast(e.message);
  }finally{submit.disabled=false;if(form.dataset.form==='post')submit.textContent='儲存貼文 / 重試附件';if(form.dataset.form==='background')submit.textContent='儲存底圖';}
});
// If a failed request is edited, do not replay the stale operation payload.
document.addEventListener('input',event=>{const form=event.target.closest('[data-form]');if(form&&!form.dataset.savedId)delete form.dataset.operation;});

function backgroundDialog(){
  modal('更換互動牆底圖',`<form data-form="background" data-version="${board.version}"><label>上傳底圖<input name="file" type="file" accept="image/png,image/jpeg,image/webp"><small>PNG、JPEG、WebP，最多 10 MB。${board.background?'目前：'+esc(board.background.name):'尚未設定底圖。'}</small></label><label>延伸方式<select name="mode"><option value="tile" ${board.background?.mode==='tile'?'selected':''}>重複鋪排（適合紋理）</option><option value="width" ${board.background?.mode==='width'?'selected':''}>符合牆寬，向下重複延伸</option></select></label><p class="muted">底圖跟隨貼文區高度延伸，不會把整張圖拉長變形。可不選新圖片，直接變更鋪排方式。</p>${board.background?'<label class="check"><input type="checkbox" name="remove">移除目前底圖</label>':''}${actions('儲存底圖')}</form>`);
}
function visiblePosts(){
  const posts=board.posts.filter(p=>(p.title+p.body+p.authorName+(p.links||[]).map(l=>l.url).join(' ')).toLowerCase().includes(search.toLowerCase()));
  return view==='columns'?board.sections.flatMap(s=>posts.filter(p=>p.section===s)):posts;
}
async function movePost(postId,targetId,position){
  try{await api(`/api/boards/${board.id}/reorder`,{method:'POST',body:{postId,targetId,position,version:board.version,moveSection:view==='columns'}});await loadBoard(board.id);toast('已儲存貼文順序');}
  catch(e){toast(e.message);await loadBoard(board.id);}
}
function updateDropTarget(){
  if(!dragState)return;
  document.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
  const target=document.elementFromPoint(dragState.x,dragState.y)?.closest('[data-post]');
  dragState.targetId=null;
  if(target&&target.dataset.post!==dragState.postId){
    const rect=target.getBoundingClientRect();dragState.targetId=target.dataset.post;dragState.position=dragState.y<rect.top+rect.height/2?'before':'after';target.classList.add('drop-'+dragState.position);
  }
}
function dragScroll(){
  if(!dragState)return;
  const {x,y}=dragState;
  const dy=y<90?-10:y>window.innerHeight-90?10:0;
  if(dy)window.scrollBy(0,dy);
  const columns=$('#posts');
  if(view==='columns'&&columns){const rect=columns.getBoundingClientRect();const dx=x<rect.left+55?-10:x>rect.right-55?10:0;if(dx)columns.scrollBy(dx,0);}
  updateDropTarget();dragState.frame=requestAnimationFrame(dragScroll);
}
function clearDrag(){
  const previous=dragState;dragState=null;
  if(previous?.frame)cancelAnimationFrame(previous.frame);
  if(previous?.handle?.hasPointerCapture?.(previous.pointerId))previous.handle.releasePointerCapture(previous.pointerId);
  document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));
}
function cancelDrag(){
  if(!dragState)return;clearDrag();
  if(board&&pendingRefresh){pendingRefresh=false;loadBoard(board.id,true).catch(e=>toast(e.message));}
}
document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('[data-drag]');if(!handle||dragState||event.isPrimary===false||!board?.isOwner||!canWrite()||event.button!==0)return;
  event.preventDefault();handle.setPointerCapture(event.pointerId);
  dragState={postId:handle.dataset.drag,pointerId:event.pointerId,handle,x:event.clientX,y:event.clientY};handle.closest('[data-post]').classList.add('dragging');
  dragState.frame=requestAnimationFrame(dragScroll);
});
document.addEventListener('pointermove',event=>{
  if(!dragState||event.pointerId!==dragState.pointerId)return;
  event.preventDefault();dragState.x=event.clientX;dragState.y=event.clientY;updateDropTarget();
},{passive:false});
document.addEventListener('pointerup',async event=>{
  if(!dragState||event.pointerId!==dragState.pointerId)return;
  if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){dragState.x=event.clientX;dragState.y=event.clientY;updateDropTarget();}
  const move={...dragState};clearDrag();
  if(move.targetId)await movePost(move.postId,move.targetId,move.position);
  else if(pendingRefresh){pendingRefresh=false;loadBoard(board.id,true).catch(e=>toast(e.message));}
});
document.addEventListener('pointercancel',event=>{if(dragState?.pointerId===event.pointerId)cancelDrag();});
document.addEventListener('lostpointercapture',event=>{if(dragState?.pointerId===event.pointerId)cancelDrag();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')cancelDrag();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelDrag();});
init();
