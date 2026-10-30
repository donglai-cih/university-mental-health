import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, '..', 'data');
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const p = path.join(dataDir, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
console.log('数据库已重置，下次启动会重新生成演示数据。');
