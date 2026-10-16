import path from 'node:path';
export function readConfig(env = process.env) {
  const demo = env.DEMO_MODE === 'true';
  const baseUrl = (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const url = new URL(baseUrl);
  if (url.origin !== baseUrl || !['http:', 'https:'].includes(url.protocol)) throw new Error('BASE_URL 必須是完整來源，不含子路徑、查詢或帳密。');
  const host = env.HOST || '127.0.0.1';
  if (demo && (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname) || host !== '127.0.0.1')) {
    throw new Error('示範模式只能在開發環境的 127.0.0.1 執行。');
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('正式環境 BASE_URL 必須是 HTTPS。');
  if (!demo && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !/^[a-f0-9]{64}$/i.test(env.TOKEN_KEY || ''))) {
    throw new Error('請依 .env.example 設定 Google OAuth 與 TOKEN_KEY，或執行 npm run demo。');
  }
  const teachers = (env.TEACHER_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!demo && !teachers.length) throw new Error('必須設定 TEACHER_EMAILS。');
  return {demo, baseUrl, host, port: Number(env.PORT || 3000), dataDir: path.resolve(env.DATA_DIR || (demo ? 'demo-data' : 'data')),
    key: env.TOKEN_KEY, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, teachers,
    defaultDomain: env.DEFAULT_DOMAIN || 'pcps.ntpc.edu.tw', secure: url.protocol === 'https:'};
}
