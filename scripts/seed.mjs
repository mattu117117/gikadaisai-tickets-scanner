import fs from 'node:fs';

const baseUrl = String(process.argv[2] || '').replace(/\/$/, '');
const token = String(process.argv[3] || process.env.SETUP_TOKEN || '');
if (!/^https:\/\//.test(baseUrl) || !token) {
  console.error('使用方法: npm.cmd run seed -- https://your-project.vercel.app SETUP_TOKEN');
  process.exit(1);
}

const tickets = JSON.parse(fs.readFileSync(new URL('../data/tickets.json', import.meta.url), 'utf8'));
const stores = JSON.parse(fs.readFileSync(new URL('../data/stores.json', import.meta.url), 'utf8'));

async function upload(payload) {
  const response = await fetch(`${baseUrl}/api?action=setup`, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-setup-token':token },
    body:JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `セットアップに失敗しました (${response.status})`);
  return data;
}

let result = await upload({ stores });
for (let offset=0; offset<tickets.length; offset+=400) {
  result = await upload({ tickets:tickets.slice(offset,offset+400) });
  console.log(`${Math.min(offset+400,tickets.length)} / ${tickets.length} 件を送信`);
}
console.log(`完了: 商品券 ${result.ticketCount}件 / 店舗 ${result.storeCount}件`);
