import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {Store,fail} from './store.js';
import * as domain from './domain.js';
import {cookies,registerAuth} from './auth.js';
import {DriveService} from './drive.js';
const publicDir=fileURLToPath(new URL('../public',import.meta.url));

export function createApp(config,{store=new Store(config.dataDir),drive=new DriveService(store,config)}={}) {
  const app=express(),streams=new Set(),rates=new Map(),retry=new Map(); let timer,busy=false,stopping=false;
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; media-src https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    if(req.path.startsWith('/api')||req.path.startsWith('/auth'))res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin')!==config.baseUrl) return next(Object.assign(new Error('請從本站頁面操作。'),{status:403}));
    req.user=store.session(cookies(req).gp_session);
    if(req.user&&!config.demo)req.user.teacher=config.teachers.includes(req.user.email);
    next();
  });
  app.use(express.json({limit:'256kb'}));
  app.use((req,res,next)=>{
    if(req.method==='GET')return next();
    const key=req.user?.id||req.socket.remoteAddress,now=Date.now();
    let value=rates.get(key);if(!value||value.until<now)value={count:0,until:now+60000};
    value.count++;rates.set(key,value);
    if(rates.size>10000)for(const [k,v] of rates)if(v.until<now)rates.delete(k);
    if(value.count>180) return next(Object.assign(new Error('操作過於頻繁，請一分鐘後重試。'),{status:429}));
    next();
  });
  registerAuth(app,store,config);
  app.get('/api/session',(req,res)=>{
    const u=req.user;
    res.json({version:'0.4.1',demo:config.demo,user:u?{id:u.id,name:u.name,email:u.email,teacher:u.teacher,driveConnected:config.demo||!!u.credentials}:null});
  });
  app.get('/healthz',(req,res)=>res.json({ok:true,version:'0.4.1'}));
  app.use('/api',(req,res,next)=>{if(!req.user)return res.status(401).json({error:'請先登入。'});next();});
  app.post('/api/drive/check',async(req,res)=>{
    if(!req.user.teacher)fail(403,'只有教師可檢查 Drive 連線。');
    res.json(await drive.diagnose(req.user.id));
  });
  const publish=id=>{
    for(const s of streams)if(s.boardId===id){
      const u=store.session(s.sessionId);
      if(!domain.canRead(store.board(id),u)){s.res.write('event: revoked\ndata: {}\n\n');s.res.end();streams.delete(s);}else s.res.write('event: refresh\ndata: {}\n\n');
    }
  };
  function get(req){const b=store.board(req.params.id);domain.access(b,req.user);return b;}
  function mutate(req,action,fn){
    get(req);const result=store.mutate(req.params.id,req.user.id,req.get('Idempotency-Key'),action,b=>fn(b,req.user));publish(req.params.id);return result;
  }
  app.get('/api/boards',(req,res)=>res.json(store.list(req.user.id).map(row=>({row,b:JSON.parse(row.data)})).filter(({b})=>domain.canRead(b,req.user)).map(({b})=>({id:b.id,title:b.title,description:b.description,layout:b.layout,frozen:b.frozen,lifecycle:b.lifecycle||'active',isOwner:b.ownerId===req.user.id,updatedAt:b.updatedAt}))));
  app.post('/api/boards',(req,res)=>{
    if(!config.demo&&!req.user.credentials)fail(409,'請先連接 Google Drive。');
    const op=req.get('Idempotency-Key');if(!/^[\w-]{8,100}$/.test(op||''))fail(400,'缺少有效操作識別碼。');
    const id=createHash('sha256').update(req.user.id+':'+op).digest('hex');
    if(store.row(id))return res.json({id});
    const b=domain.newBoard(req.user,req.body,config.defaultDomain);b.id=id;store.create(b);res.status(201).json({id:b.id});
  });
  app.get('/api/boards/:id',(req,res)=>{
    const b=get(req);store.visit(b.id,req.user.id);res.json(domain.publicBoard(b,req.user,store.row(b.id),config.demo));
  });
  app.get('/api/boards/:id/events',(req,res)=>{
    get(req);if(streams.size>=300)fail(503,'即時連線已滿，請稍後再試。');
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});res.flushHeaders();
    const s={boardId:req.params.id,res,sessionId:cookies(req).gp_session};streams.add(s);res.write('event: ready\ndata: {}\n\n');
    const heartbeat=setInterval(()=>{
      if(!domain.canRead(store.board(s.boardId),store.session(s.sessionId))){res.write('event: revoked\ndata: {}\n\n');res.end();return;}
      res.write(': heartbeat\n\n');
    },20000);
    req.on('close',()=>{clearInterval(heartbeat);streams.delete(s);});
  });
  app.patch('/api/boards/:id',(req,res)=>res.json(mutate(req,'settings',(b,u)=>domain.settings(b,u,req.body))));
  app.post('/api/boards/:id/reorder',(req,res)=>res.json(mutate(req,'post.reorder',(b,u)=>domain.reorderPost(b,u,req.body))));
  app.patch('/api/boards/:id/lifecycle',(req,res)=>res.json(mutate(req,'board.lifecycle',(b,u)=>domain.lifecycle(b,u,req.body))));
  app.post('/api/boards/:id/template',(req,res)=>{
    const source=get(req);domain.owner(source,req.user);
    const op=req.get('Idempotency-Key');if(!/^[\w-]{8,100}$/.test(op||''))fail(400,'缺少有效操作識別碼。');
    const id=createHash('sha256').update('template:'+source.id+':'+req.user.id+':'+op).digest('hex');
    if(store.row(id))return res.json({id});
    const copy=domain.template(source,req.user,req.body);copy.id=id;store.create(copy);res.status(201).json({id});
  });
  app.get('/api/boards/:id/trash',(req,res)=>{
    const b=get(req);domain.owner(b,req.user);
    res.json(b.posts.filter(p=>p.deleted).map(p=>({id:p.id,title:p.title,authorName:p.authorName,deletedAt:p.deletedAt||null,status:p.status})));
  });
  app.post('/api/boards/:id/posts/:postId/restore',(req,res)=>res.json(mutate(req,'post.restore',(b,u)=>domain.restorePost(b,u,req.params.postId))));
  app.get('/api/boards/:id/export.csv',(req,res)=>{
    const b=get(req);res.attachment('google-padlet-'+b.id+'.csv').type('text/csv; charset=utf-8').send(domain.exportCsv(b,req.user));
  });
  app.post('/api/boards/:id/posts',(req,res)=>res.status(201).json(mutate(req,'post.create',(b,u)=>domain.addPost(b,u,req.body))));
  app.patch('/api/boards/:id/posts/:postId',(req,res)=>res.json(mutate(req,'post.edit',(b,u)=>domain.editPost(b,u,req.params.postId,req.body))));
  app.delete('/api/boards/:id/posts/:postId',(req,res)=>res.json(mutate(req,'post.delete',(b,u)=>domain.removePost(b,u,req.params.postId))));
  app.post('/api/boards/:id/posts/:postId/approve',(req,res)=>res.json(mutate(req,'post.approve',(b,u)=>domain.approvePost(b,u,req.params.postId))));
  app.post('/api/boards/:id/posts/:postId/comments',(req,res)=>res.status(201).json(mutate(req,'comment.create',(b,u)=>domain.addComment(b,u,req.params.postId,req.body))));
  app.delete('/api/boards/:id/posts/:postId/comments/:commentId',(req,res)=>res.json(mutate(req,'comment.delete',(b,u)=>domain.removeComment(b,u,req.params.postId,req.params.commentId))));
  app.put('/api/boards/:id/posts/:postId/vote',(req,res)=>res.json(mutate(req,'vote.set',(b,u)=>domain.setVote(b,u,req.params.postId,req.body))));
  app.put('/api/boards/:id/posts/:postId/like',(req,res)=>res.json(mutate(req,'reaction.set',(b,u)=>domain.setLike(b,u,req.params.postId,req.body))));
  app.get('/api/boards/:id/qr',async(req,res)=>{
    get(req);res.type('png').send(await QRCode.toBuffer(config.baseUrl+'/?board='+req.params.id,{width:320,margin:2}));
  });
  app.get('/api/boards/:id/export',(req,res)=>{
    const b=get(req);domain.owner(b,req.user);
    res.attachment('google-padlet-'+b.id+'.json').json(b);
  });
  app.post('/api/boards/:id/sync',async(req,res)=>{
    const b=get(req);domain.owner(b,req.user);if(config.demo)fail(400,'示範模式沒有連接 Drive。');
    try{await drive.sync(b.id);retry.delete(b.id);publish(b.id);res.json({ok:true});}
    catch(e){store.syncError(b.id,'Drive 同步失敗，請檢查授權、空間與資料夾是否存在。');publish(b.id);throw e;}
  });
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:0}});
  app.post('/api/boards/:id/background',(req,res,next)=>{
    const b=get(req);domain.owner(b,req.user);domain.writable(b,req.user);next();
  },upload.single('file'),async(req,res)=>{
    const b=get(req),f=req.file,version=Number(req.get('X-Board-Version'));
    const mode=req.get('X-Background-Mode');
    if(!['tile','width'].includes(mode))fail(400,'請選擇底圖鋪排方式。');
    const op=req.get('Idempotency-Key');if(!/^[\w-]{8,100}$/.test(op||''))fail(400,'缺少有效操作識別碼。');
    const replay=store.db.prepare('SELECT result FROM operations WHERE board_id=? AND user_id=? AND id=?').get(b.id,req.user.id,op);
    if(replay)return res.json(JSON.parse(replay.result));
    if(version!==b.version)fail(409,'互動牆已更新，請重新開啟底圖設定。');
    const mime=f&&detectMime(f.buffer);if(!mime?.startsWith('image/'))fail(400,'底圖支援 PNG、JPEG、WebP，最多 10 MB。');
    const id=createHash('sha256').update('background:'+b.id+':'+req.user.id+':'+op).digest('hex');
    f.mimetype=mime;f.originalname=Buffer.from(f.originalname,'latin1').toString('utf8').replace(/[\r\n/\\]/g,'_').slice(0,160)||'background';
    const background={id,name:f.originalname,mime,mode};
    if(config.demo){
      const dir=path.join(config.dataDir,'attachments');mkdirSync(dir,{recursive:true,mode:0o700});
      background.localPath=path.join(dir,id);writeFileSync(background.localPath,f.buffer,{mode:0o600});
    }else background.driveId=await drive.upload(b,f,id);
    res.json(mutate(req,'background.set',(board,u)=>{
      domain.owner(board,u);domain.writable(board,u);
      if(board.version!==version)fail(409,'互動牆已更新，請重新開啟底圖設定。');
      board.background=background;
    }));
  });
  app.patch('/api/boards/:id/background',(req,res)=>res.json(mutate(req,'background.mode',(b,u)=>{
    domain.owner(b,u);domain.writable(b,u);
    if(req.body.version!==b.version)fail(409,'互動牆已更新，請重新開啟底圖設定。');
    if(req.body.mode===null){b.background=null;return;}
    if(!['tile','width'].includes(req.body.mode)||!b.background)fail(400,'請先上傳底圖並選擇鋪排方式。');
    b.background.mode=req.body.mode;
  })));
  app.get('/api/boards/:id/background/:backgroundId',async(req,res)=>{
    const b=get(req),a=b.background;
    if(!a||a.id!==req.params.backgroundId)fail(404,'找不到底圖。');
    res.type(a.mime);
    if(config.demo){if(!existsSync(a.localPath))fail(404,'底圖檔案不存在。');return res.sendFile(a.localPath);}
    const {data}=await drive.download(b.ownerId,a.driveId);data.on('error',()=>res.destroy());data.pipe(res);
  });
  app.post('/api/boards/:id/posts/:postId/attachments',(req,res,next)=>{
    domain.editable(get(req),req.user,req.params.postId);next();
  },upload.single('file'),async(req,res)=>{
    const b=get(req),p=domain.editable(b,req.user,req.params.postId),f=req.file;
    const op=req.get('Idempotency-Key');if(!/^[\w-]{8,100}$/.test(op||''))fail(400,'缺少有效操作識別碼。');
    const attachmentId=createHash('sha256').update(b.id+':'+req.user.id+':'+op).digest('hex');
    if(p.attachments.some(a=>a.id===attachmentId))return res.json({id:attachmentId});
    if(!f)fail(400,'請選擇檔案。');if(p.attachments.length>=5)fail(400,'每篇最多 5 個附件。');
    const mime=detectMime(f.buffer);if(!mime)fail(400,'第一版支援 PNG、JPEG、WebP 與 PDF，每檔最多 10 MB。');
    f.mimetype=mime;f.originalname=Buffer.from(f.originalname,'latin1').toString('utf8').replace(/[\r\n/\\]/g,'_').slice(0,160)||'attachment';
    const attachment={id:attachmentId,name:f.originalname,mime,size:f.size};
    if(config.demo){
      const dir=path.join(config.dataDir,'attachments');mkdirSync(dir,{recursive:true,mode:0o700});
      attachment.localPath=path.join(dir,attachmentId);writeFileSync(attachment.localPath,f.buffer,{mode:0o600});
    }else attachment.driveId=await drive.upload(b,f,attachmentId);
    try{
      const result=mutate(req,'attachment.add',(board,u)=>{
        const post=domain.editable(board,u,req.params.postId);
        if(post.attachments.length>=5)fail(400,'每篇最多 5 個附件。');
        post.attachments.push(attachment);post.version++;
        post.status=board.moderation&&board.ownerId!==u.id?'pending':'published';
        return {id:attachmentId};
      });res.status(201).json(result);
    }catch(e){
      // Keep an orphan private rather than risk deleting a file referenced by an overlapping successful retry.
      // Maintenance is documented; it is never served without a committed attachment relationship.
      throw e;
    }
  });
  app.get('/api/boards/:id/posts/:postId/attachments/:attachmentId',async(req,res)=>{
    const b=get(req),p=domain.postFor(b,req.user,req.params.postId),a=p.attachments.find(a=>a.id===req.params.attachmentId);
    if(!a)fail(404,'找不到附件。');
    const inline=a.mime.startsWith('image/');
    res.set('Content-Type',a.mime);res.set('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
    if(config.demo){if(!existsSync(a.localPath))fail(404,'示範附件不存在。');return res.sendFile(a.localPath);}
    const {data}=await drive.download(b.ownerId,a.driveId);
    data.on('error',()=>res.destroy());data.pipe(res);
  });
  app.use(express.static(publicDir,{index:'index.html',maxAge:0}));
  app.use((req,res)=>res.status(404).json({error:'找不到此路徑。'}));
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    const status=err.code==='LIMIT_FILE_SIZE'?413:(err.status>=400&&err.status<500?err.status:500);
    // Never log OAuth tokens, upstream response objects, request bodies, or cookies.
    if(status===500)console.error('Request failed:',req.method,req.path,err.name||'Error');
    res.status(status).json({error:err.code==='LIMIT_FILE_SIZE'?'檔案超過 10 MB。':status===500?'服務暫時無法完成操作，請稍後重試；若為 Drive 操作，請檢查授權與空間。':err.message});
  });
  async function tick(){
    if(busy||config.demo||stopping)return;busy=true;
    try{for(const r of store.db.prepare('SELECT id FROM boards WHERE version>sync_version').all()){
      if(stopping)break;
      const previous=retry.get(r.id);if(previous?.after>Date.now())continue;
      try{await drive.sync(r.id);retry.delete(r.id);}catch{
        const attempts=(previous?.attempts||0)+1;retry.set(r.id,{attempts,after:Date.now()+Math.min(300000,15000*2**Math.min(attempts,5))});
        store.syncError(r.id,'Drive 同步失敗，請重新連接 Drive，或檢查空間及資料夾。');
      }publish(r.id);
    }}finally{busy=false;}
  }
  function stop(){stopping=true;clearInterval(timer);for(const s of streams)s.res.end();}
  return {app,store,tick,stop,drain:()=>drive.queue||Promise.resolve(),startSync(){if(!timer&&!config.demo){timer=setInterval(tick,15000);void tick();}},close(){stop();store.close();}};
}
export function detectMime(b){
  if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';
  if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return'image/jpeg';
  if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return'image/webp';
  if(b.length>=5&&b.toString('ascii',0,5)==='%PDF-')return'application/pdf';
  return null;
}
