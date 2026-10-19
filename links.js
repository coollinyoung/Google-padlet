import {fail} from './errors.js';
const youtubeHosts=new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com']);
function startSeconds(value){
  if(!value)return 0;
  if(/^\d+$/.test(value))return Math.min(Number(value),604800);
  const m=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return m&&m[0]?Math.min(Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0),604800):0;
}
export function normalizeLinks(input=[]){
  if(!Array.isArray(input)||input.length>20)fail(400,'每篇最多 20 個網址，請逐行貼上。');
  const result=[],seen=new Set();
  for(const raw of input){
    if(typeof raw!=='string'||raw.length>2048||!raw.trim()||/[\u0000-\u001f\u007f]/.test(raw))fail(400,'網址格式錯誤或超過 2,048 字元。');
    const value=raw.trim();let u;
    if(!/^https?:\/\//i.test(value))fail(400,'網址必須以 https:// 或 http:// 開頭；請勿貼上 iframe 程式碼。');
    try{u=new URL(value);}catch{fail(400,'無法辨識網址，請檢查格式。');}
    if(!u.hostname||u.username||u.password)fail(400,'網址不能包含登入帳密。');
    const link={url:u.href,kind:'link',host:u.hostname};let videoId;
    if(!u.port){
      if(u.hostname==='youtu.be'||u.hostname==='www.youtu.be')videoId=/^\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
      else if(youtubeHosts.has(u.hostname)){
        videoId=u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
      }
    }
    if(videoId&&/^[\w-]{11}$/.test(videoId)){
      const start=startSeconds(u.searchParams.get('start')||u.searchParams.get('t'));
      Object.assign(link,{kind:'youtube',videoId,startSeconds:start,url:`https://www.youtube.com/watch?v=${videoId}${start?'&t='+start+'s':''}`,host:'www.youtube.com'});
    }else if(u.protocol==='https:'){
      if(/\.(mp4|webm)$/i.test(u.pathname))link.kind='video';
      else if(/\.(mp3|m4a|ogg|wav)$/i.test(u.pathname))link.kind='audio';
    }
    if(!seen.has(link.url)){seen.add(link.url);result.push(link);}
  }
  return result;
}
