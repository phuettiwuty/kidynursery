import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const config = read('config.js');
const backend = read('google-apps-script/Code.gs');

const checks = [
  ['หน้าเว็บไม่โหลดข้อมูลเด็กจากไฟล์ภายในเครื่อง', !/student-details\.js|photo-map\.js/.test(html)],
  ['หน้าเว็บไม่เก็บข้อมูลเด็กใน Local Storage', !/localStorage/.test(html)],
  ['ไม่มีรหัสเขียนข้อมูลใน config', !/writeToken|growthWriteToken|kdy_[0-9a-f]+/i.test(config)],
  ['ไม่มีช่องทางเขียนแบบ legacy', !/GROWTH_WRITE_TOKEN|legacyAccess|writeToken/.test(backend)],
  ['การอ่านและเขียนข้อมูลใช้ POST', /function apiPost\(/.test(html) && /function doPost\(/.test(backend)],
  ['API สาธารณะไม่คืนรายชื่อเด็ก', /function doGet[\s\S]*?service: 'Kindery API'/.test(backend)],
  ['การเขียนต้องมี session ครู', /if \(!teacherSession\) throw new Error/.test(backend)],
  ['มีการจำกัดการลองรหัสผิด', /isLoginBlocked_|recordLoginFailure_/.test(backend)],
  ['มีเครื่องมือเปลี่ยนรหัสผ่านโดยไม่เก็บรหัสจริง', /function applyPendingPasswordChanges\(/.test(backend)],
  ['ปิดการจัดทำดัชนีโดย Search Engine', /noindex,nofollow,noarchive/.test(html)]
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`\nไม่ผ่าน ${failed} รายการ`);
  process.exit(1);
}

console.log(`\nผ่านครบ ${checks.length} รายการ`);
