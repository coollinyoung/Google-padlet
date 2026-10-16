import {fail} from './store.js';
// Container signature checks; no transcoding or guarantee that every codec can play.
export function mediaMime(b){
  if(b.length>=16&&b.toString('ascii',4,8)==='ftyp'){
    const brand=b.toString('ascii',8,12);
    if(['M4A ','M4B '].includes(brand))return 'audio/mp4';
    if(['isom','iso2','iso4','iso5','iso6','mp41','mp42','avc1','M4V '].includes(brand))return 'video/mp4';
  }
  if(b.length>=16&&b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&b.subarray(4,4096).includes(Buffer.from('webm')))return 'video/webm';
  if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE')return 'audio/wav';
  if(b.length>=10&&b.toString('ascii',0,3)==='ID3'&&b[3]>=2&&b[3]<=4)return 'audio/mpeg';
  if(b.length>=4&&b[0]===255&&(b[1]&0xe0)===0xe0&&(b[1]&0x18)!==8&&(b[1]&6)!==0&&(b[2]&0xf0)!==0xf0&&(b[2]&0xf0)!==0&&(b[2]&12)!==12)return 'audio/mpeg';
  if(b.length>=32&&b.toString('ascii',0,4)==='OggS'&&b[4]===0&&(b.subarray(0,4096).includes(Buffer.from('OpusHead'))||b.subarray(0,4096).includes(Buffer.from('\x01vorbis','binary'))))return 'audio/ogg';
  return null;
}
export function byteRange(header,size){
  if(!header)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||(!m[1]&&!m[2]))fail(416,'不支援的檔案範圍。');
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Number(m[2]):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)fail(416,'檔案範圍超出大小。');
  return {start,end:Math.min(end,size-1)};
}
