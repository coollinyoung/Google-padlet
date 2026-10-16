import {readConfig} from '../server/config.js';
// Inspect local configuration only. Never print credentials or contact Google.
const required=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','TOKEN_KEY','TEACHER_EMAILS'];
let missing=false;
console.log('Google Padlet 設定檢查（不會連線 Google）');
for(const key of required){const present=!!process.env[key]?.trim();console.log(`${key}: ${present?'已填寫（內容隱藏）':'尚未填寫'}`);missing||=!present;}
try{
  const config=readConfig();
  if(config.demo){console.log('目前為示範模式；Drive 驗收請設定 DEMO_MODE=false 並使用 npm start。');process.exitCode=1;}
  else {
    console.log('設定格式通過。請確認 OAuth 用戶端類型為 Web application。');
    console.log('已授權重新導向 URI 必須完全一致：'+config.baseUrl+'/auth/callback');
    console.log('教師名單人數：'+config.teachers.length);
    console.log('下一步：npm start → 使用教師帳號登入 → 連接 Google Drive → Drive 連線檢查。');
    if(new URL(config.baseUrl).hostname==='localhost'||new URL(config.baseUrl).hostname==='127.0.0.1')console.log('本機網址只能供這台電腦使用；手機與學生掃碼需可連線的正式 HTTPS 網址。');
  }
}catch{
  console.log('設定未通過。請檢查 BASE_URL 格式、TOKEN_KEY 是否為 64 個十六進位字元、教師名單與 OAuth 欄位；正式環境必須 HTTPS。');process.exitCode=1;
}
if(missing)process.exitCode=1;
