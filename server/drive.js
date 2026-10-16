import {google} from 'googleapis';
import {Readable} from 'node:stream';
import {oauth,decrypt,encrypt} from './auth.js';
import {fail} from './store.js';

const folderMime='application/vnd.google-apps.folder';
// A single queue serializes remote changes, including root creation and attachment uploads.
export class DriveService {
  constructor(store,config) { this.store=store;this.config=config;this.queue=Promise.resolve(); }
  run(fn) { const next=this.queue.then(fn); this.queue=next.catch(()=>{});return next; }
  client(ownerId) {
    const u=this.store.user(ownerId);if(!u?.credentials)fail(409,'教師尚未連接 Google Drive。');
    const auth=oauth(this.config);auth.setCredentials(decrypt(u.credentials,this.config.key));
    auth.on('tokens',tokens=>{const current=this.store.user(ownerId);if(current?.credentials)this.store.credentials(ownerId,encrypt({...decrypt(current.credentials,this.config.key),...tokens},this.config.key));});
    return google.drive({version:'v3',auth});
  }
  async find(drive,key,parent) {
    // Keys and parent IDs are created by the server, not accepted as search expressions from users.
    const q=`trashed = false and appProperties has { key='gpKey' and value='${key}' }`+(parent?` and '${parent}' in parents`:'');
    const {data}=await drive.files.list({q,fields:'files(id,name)',pageSize:100});return data.files?.[0]?.id;
  }
  async folder(drive,name,key,parent) {
    let id=await this.find(drive,key,parent); if(id)return id;
    const {data}=await drive.files.create({requestBody:{name,mimeType:folderMime,appProperties:{gpKey:key},...(parent?{parents:[parent]}:{})},fields:'id'});
    return data.id;
  }
  async checkFolder(drive,id) {
    const {data}=await drive.files.get({fileId:id,fields:'id,trashed,mimeType'});
    if(data.trashed||data.mimeType!==folderMime)fail(409,'Drive 資料夾已刪除或失效，請先在 Drive 還原。');
  }
  async ensure(board) {
    const drive=this.client(board.ownerId),u=this.store.user(board.ownerId);
    let root=u.rootId;
    if(root)await this.checkFolder(drive,root);
    else {root=await this.folder(drive,'Google Padlet','root-'+board.ownerId);this.store.root(u.id,root);}
    let info=JSON.parse(this.store.row(board.id).drive);
    if(info.folderId)await this.checkFolder(drive,info.folderId);
    else {info.folderId=await this.folder(drive,board.title,'board-'+board.id,root);this.store.driveInfo(board.id,info);}
    await drive.files.update({fileId:info.folderId,requestBody:{name:board.title}});
    for(const name of ['attachments','backups','exports','thumbnails']) {
      if(!info[name]) {info[name]=await this.folder(drive,name,board.id+'-'+name,info.folderId);this.store.driveInfo(board.id,info);}
    }
    return {drive,info};
  }
  async putJson(drive,parent,key,name,data) {
    const id=await this.find(drive,key,parent),media={mimeType:'application/json',body:Readable.from([JSON.stringify(data,null,2)])};
    if(id)await drive.files.update({fileId:id,media});
    else await drive.files.create({requestBody:{name,parents:[parent],appProperties:{gpKey:key}},media,fields:'id'});
  }
  async sync(id) { return this.run(async()=>{
    // Snapshot taken inside queue; only this exact version can be marked as saved.
    const board=this.store.board(id),{drive,info}=await this.ensure(board);
    const {posts,...metadata}=board;
    await this.putJson(drive,info.folderId,id+'-meta','board.json',metadata);
    await this.putJson(drive,info.folderId,id+'-data','data.json',board);
    this.store.synced(id,board.version);
  }); }
  async upload(board,file,attachmentId) { return this.run(async()=>{
    const {drive,info}=await this.ensure(this.store.board(board.id));
    // Retry uses the same key; an ambiguous successful upload does not create another file.
    const existing=await this.find(drive,attachmentId,info.attachments); if(existing)return existing;
    const {data}=await drive.files.create({requestBody:{name:file.originalname,parents:[info.attachments],appProperties:{gpKey:attachmentId}},
      media:{mimeType:file.mimetype,body:Readable.from([file.buffer])},fields:'id'});
    return data.id;
  }); }
  async remove(ownerId,id) { await this.client(ownerId).files.update({fileId:id,requestBody:{trashed:true}}); }
  async download(ownerId,id) { return this.client(ownerId).files.get({fileId:id,alt:'media'},{responseType:'stream'}); }
}
