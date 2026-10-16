import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {google} from 'googleapis';
import {fail} from './store.js';
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
export function encrypt(value,key) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),bytes].map(x=>x.toString('base64')).join('.');
}
export function decrypt(value,key) {
  const [iv,tag,bytes]=value.split('.').map(x=>Buffer.from(x,'base64'));
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(bytes),cipher.final()]).toString('utf8'));
}
export function oauth(config) { return new google.auth.OAuth2(config.clientId,config.clientSecret,config.baseUrl+'/auth/callback'); }
export function cookies(req) { return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2)); }
export function registerAuth(app,store,config) {
  const cookieOptions={httpOnly:true,sameSite:'lax',secure:config.secure,path:'/'};
  app.get('/auth/login',(req,res)=>begin(req,res,false));
  app.get('/auth/drive',(req,res)=>begin(req,res,true));
  function begin(req,res,drive) {
    if(config.demo) return res.redirect('/');
    if(drive && !req.user?.teacher) fail(403,'只有教師可連接 Drive。');
    const state=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex');
    const returnTo=typeof req.query.returnTo==='string' && /^\/(?:\?board=[\w-]+)?$/.test(req.query.returnTo)?req.query.returnTo:'/';
    store.setState(state,{nonce,drive,userId:drive?req.user.id:null,returnTo});
    res.cookie('gp_oauth',state,{...cookieOptions,maxAge:600000});
    const client=oauth(config);
    res.redirect(client.generateAuthUrl({access_type:drive?'offline':'online',scope:['openid','email','profile',...(drive?[DRIVE_SCOPE]:[])],
      state,nonce,include_granted_scopes:true,prompt:drive?'consent':'select_account'}));
  }
  app.get('/auth/callback',async(req,res)=>{
    if(config.demo) fail(404,'示範模式沒有 OAuth 回呼。');
    const state=req.query.state;
    if(typeof state!=='string' || state!==cookies(req).gp_oauth) fail(400,'登入狀態失效，請重新登入。');
    res.clearCookie('gp_oauth',cookieOptions);
    const data=store.takeState(state); if(!data)fail(400,'登入已逾時，請重試。');
    if(req.query.error) return res.redirect('/?authError=cancelled');
    if(typeof req.query.code!=='string') fail(400,'缺少授權碼。');
    const client=oauth(config);const {tokens}=await client.getToken(req.query.code);
    const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:config.clientId});
    const payload=ticket.getPayload();
    if(!payload?.email_verified || payload.nonce!==data.nonce)fail(403,'無法驗證登入身分。');
    const email=payload.email.toLowerCase(),teacher=config.teachers.includes(email);
    if(data.drive && (!teacher || payload.sub!==data.userId || req.user?.id!==data.userId))fail(403,'請使用原本的教師帳號授權。');
    const user=store.putUser({id:payload.sub,email,name:payload.name||email,hd:payload.hd||'',teacher});
    if(data.drive) {
      if(!tokens.scope?.split(' ').includes(DRIVE_SCOPE)) fail(403,'請授予程式檔案的 Drive 存取權。');
      const old=user.credentials?decrypt(user.credentials,config.key):{};
      const merged={...old,...tokens,refresh_token:tokens.refresh_token||old.refresh_token};
      if(!merged.refresh_token)fail(400,'未取得持續存取權，請重新連接 Drive。');
      store.credentials(user.id,encrypt(merged,config.key));
    }
    store.logout(cookies(req).gp_session);
    res.cookie('gp_session',store.newSession(user.id),{...cookieOptions,maxAge:8*3600000});
    res.redirect(data.returnTo);
  });
  app.post('/auth/logout',(req,res)=>{store.logout(cookies(req).gp_session);res.clearCookie('gp_session',cookieOptions);res.json({ok:true});});
  if(config.demo) app.post('/auth/demo',(req,res)=>{
    const profiles={teacher:{id:'demo-teacher',name:'示範教師',email:'teacher@pcps.ntpc.edu.tw',hd:'pcps.ntpc.edu.tw',teacher:true},
      student:{id:'demo-student',name:'01 林小晴',email:'s01@pcps.ntpc.edu.tw',hd:'pcps.ntpc.edu.tw',teacher:false},
      student2:{id:'demo-student2',name:'02 陳小宇',email:'s02@pcps.ntpc.edu.tw',hd:'pcps.ntpc.edu.tw',teacher:false}};
    const p=profiles[req.body.role];if(!p)fail(400,'未知示範角色。');
    store.putUser(p);store.logout(cookies(req).gp_session);
    res.cookie('gp_session',store.newSession(p.id),{...cookieOptions,maxAge:8*3600000});res.json({ok:true});
  });
}
