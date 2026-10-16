import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
export class Store {
  constructor(dir) {
    mkdirSync(dir, {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(path.join(dir, 'padlet.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, profile TEXT NOT NULL, credentials TEXT, root_id TEXT);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL,
        version INTEGER NOT NULL, sync_version INTEGER NOT NULL DEFAULT 0, drive TEXT NOT NULL DEFAULT '{}', sync_error TEXT,
        UNIQUE(owner,title));
      CREATE TABLE IF NOT EXISTS operations (board_id TEXT NOT NULL, user_id TEXT NOT NULL, id TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(board_id,user_id,id));
      CREATE TABLE IF NOT EXISTS visits (board_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(board_id,user_id));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, board_id TEXT, user_id TEXT, action TEXT, created_at TEXT);
      PRAGMA user_version=1;`);
  }
  user(id) { const r = this.db.prepare('SELECT * FROM users WHERE id=?').get(id); return r ? {...JSON.parse(r.profile), credentials:r.credentials, rootId:r.root_id} : null; }
  putUser(user) {
    this.db.prepare('INSERT INTO users(id,profile) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile').run(user.id, JSON.stringify(user));
    return this.user(user.id);
  }
  credentials(id, value) { this.db.prepare('UPDATE users SET credentials=? WHERE id=?').run(value, id); }
  root(id, value) { this.db.prepare('UPDATE users SET root_id=? WHERE id=?').run(value, id); }
  newSession(userId) {
    this.cleanup(); const id = randomUUID() + randomUUID();
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(id, userId, Date.now() + 8 * 3600000); return id;
  }
  session(id) {
    const r = this.db.prepare('SELECT user_id FROM sessions WHERE id=? AND expires>?').get(id || '', Date.now());
    return r && this.user(r.user_id);
  }
  logout(id) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(id || ''); }
  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());
  }
  setState(id, data) { this.cleanup(); this.db.prepare('INSERT INTO oauth_states VALUES (?,?,?)').run(id, JSON.stringify(data), Date.now()+600000); }
  takeState(id) {
    const row = this.db.prepare('DELETE FROM oauth_states WHERE id=? RETURNING *').get(id || '');
    return row && row.expires > Date.now() ? JSON.parse(row.data) : null;
  }
  row(id) { return this.db.prepare('SELECT * FROM boards WHERE id=?').get(id); }
  board(id) { const r = this.row(id); if (!r) fail(404, '找不到互動牆。'); return JSON.parse(r.data); }
  list(userId) {
    return this.db.prepare('SELECT b.* FROM boards b WHERE owner=? OR EXISTS(SELECT 1 FROM visits v WHERE v.board_id=b.id AND v.user_id=?) ORDER BY rowid DESC').all(userId,userId);
  }
  visit(boardId,userId) { this.db.prepare('INSERT OR IGNORE INTO visits VALUES (?,?)').run(boardId,userId); }
  create(board) {
    try { this.db.prepare('INSERT INTO boards(id,owner,title,data,version) VALUES(?,?,?,?,?)').run(board.id, board.ownerId, board.title, JSON.stringify(board),board.version); }
    catch(e) { if (String(e.message).includes('UNIQUE')) fail(409,'已有同名互動牆，請更換名稱。'); throw e; }
  }
  // All callbacks must be synchronous; one SQLite transaction commits data + replay record + audit together.
  mutate(boardId, userId, operationId, action, fn) {
    if (typeof operationId !== 'string' || !/^[\w-]{8,100}$/.test(operationId)) fail(400,'缺少有效操作識別碼。');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT result FROM operations WHERE board_id=? AND user_id=? AND id=?').get(boardId,userId,operationId);
      if (old) { this.db.exec('COMMIT'); return JSON.parse(old.result); }
      const board = this.board(boardId);
      const result = fn(board) || {};
      board.version++; board.updatedAt = new Date().toISOString();
      this.db.prepare('UPDATE boards SET data=?,title=?,version=?,sync_error=NULL WHERE id=?').run(JSON.stringify(board),board.title,board.version,boardId);
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(boardId,userId,operationId,JSON.stringify(result));
      this.db.prepare('INSERT INTO audit(board_id,user_id,action,created_at) VALUES(?,?,?,?)').run(boardId,userId,action,board.updatedAt);
      this.db.exec('COMMIT'); return result;
    } catch(e) {
      this.db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) fail(409,'已有同名互動牆。');
      throw e;
    }
  }
  driveInfo(id, info) { this.db.prepare('UPDATE boards SET drive=? WHERE id=?').run(JSON.stringify(info),id); }
  synced(id, version) { this.db.prepare('UPDATE boards SET sync_version=?,sync_error=NULL WHERE id=?').run(version,id); }
  syncError(id, message) { this.db.prepare('UPDATE boards SET sync_error=? WHERE id=?').run(message,id); }
  close() { this.db.close(); }
}
