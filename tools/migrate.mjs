/**
 * ย้ายข้อมูลจากระบบเดิม (Apps Script + Google Sheets) -> seed.sql สำหรับ Cloudflare D1
 *
 * วิธีใช้:
 *   node tools/migrate.mjs "<URL /exec ของ Apps Script เดิม>" <PIN แอดมินเดิม>
 * จะได้ไฟล์ worker/seed.sql แล้วรัน:
 *   cd worker
 *   npx wrangler d1 execute souvenir --file=seed.sql --remote
 *
 * หมายเหตุ: ลบสินค้า/ตั้งค่าเริ่มต้นแล้วใส่ค่าจากระบบเดิมแทน (ราคา สต็อก ตัวเลือก โหมด ข้อมูลบัญชี ค่าจัดส่ง)
 *          ออเดอร์เก่าไม่มีข้อมูล "ตัดสต็อกแล้วหรือยัง" จึงตั้งเป็นไม่ตัด (ยกเลิกออเดอร์เก่าจะไม่คืนสต็อก)
 */
import { writeFileSync } from 'node:fs';

const [url, pin] = process.argv.slice(2);
if (!url || !pin) {
  console.error('ใช้: node tools/migrate.mjs "<URL /exec เดิม>" <PIN แอดมิน>');
  process.exit(1);
}

async function call(fn, ...args) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn, args }) });
  const j = await r.json();
  if (!j.ok) throw new Error(fn + ': ' + j.error);
  return j.data;
}
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");

// 'd/M/yy HH:mm' (เวลาไทย) -> ISO UTC
function toIso(t) {
  const m = String(t).match(/^(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
  if (!m) return new Date().toISOString();
  const [, d, mo, y, h, mi] = m.map(Number);
  const yy = y < 100 ? 2000 + y : y;
  return new Date(`${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+07:00`).toISOString();
}

const data = await call('adminGetData', pin);
const shop = await call('getShop');
const track = await call('trackOrders', '0000000000'); // เอาแค่ shipFee

const sql = [];
sql.push('-- สร้างโดย tools/migrate.mjs — ห้ามอัปขึ้น GitHub (มีข้อมูลลูกค้า)');
sql.push('DELETE FROM products;', 'DELETE FROM orders;');

data.products.forEach((p) => {
  sql.push(
    `INSERT INTO products (id, sort, name, price, options, option_label, stock, active, image, description, poster) VALUES (${[
      q(p.id), q(p.row), q(p.name), q(p.price || 0), q((p.options || []).join(',')), q(p.optionLabel || ''),
      q(p.stock === null || p.stock === undefined ? null : Number(p.stock)), q(p.active ? 1 : 0),
      q(p.image || ''), q(p.desc || ''), q(p.poster || ''),
    ].join(', ')});`
  );
});

// เก่าสุดก่อน เพื่อให้ลำดับเลขออเดอร์คงเดิม
[...data.orders].reverse().forEach((o) => {
  sql.push(
    `INSERT INTO orders (order_no, created_at, name, phone, grp, items_text, total, status, slip_url, note, items_json, stock_deducted, ring_size, delivery, fee, addr, dphone) VALUES (${[
      q(o.orderNo), q(toIso(o.time)), q(o.name), q(String(o.phone || '').replace(/\D/g, '')), q(o.group || ''),
      q(o.items || ''), q(Number(o.total) || 0), q(o.status || 'สำรวจ'), q(o.slip || ''), q(o.note || ''),
      q(o.json || '[]'), q(0), q(o.ringSize || ''), q(o.delivery || ''), q(Number(o.fee) || 0), q(o.addr || ''),
      q(String(o.dphone || '').replace(/\D/g, '')),
    ].join(', ')});`
  );
});

const settings = { MODE: data.mode || 'survey', SHOP_TITLE: shop.title || 'สั่งจองของที่ระลึก', PAY_INFO: shop.payInfo || '', SHIP_FEE: String(track.shipFee ?? 50) };
Object.entries(settings).forEach(([k, v]) => {
  sql.push(`INSERT INTO settings (key, value) VALUES (${q(k)}, ${q(v)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
});

writeFileSync(new URL('../worker/seed.sql', import.meta.url), sql.join('\n') + '\n');
console.log(`เสร็จ: สินค้า ${data.products.length} รายการ, ออเดอร์ ${data.orders.length} รายการ, โหมด ${settings.MODE}`);
console.log('ต่อไป: cd worker && npx wrangler d1 execute souvenir --file=seed.sql --remote');
