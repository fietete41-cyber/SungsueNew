/**
 * เปลี่ยนตัวเลือกของ "เซ็ต" ให้เลือกสีแก้ว/สีหมวกได้ และแปลงออเดอร์เดิมให้เข้ากับตัวเลือกใหม่
 *
 *   เซ็ตโปโล     : สีกล่อง/เสื้อ / ไซซ์ / สีแก้ว / สีหมวก   (2 x 9 x 2 x 2 = 72 ตัวเลือก)
 *   เซ็ตเสื้อยืด  : สีกล่อง/เสื้อ / ไซซ์ / สีแก้ว            (2 x 9 x 2     = 36 ตัวเลือก)
 *
 * ออเดอร์เดิมที่มีตัวเลือกแบบเก่า (เช่น "ดำ / M") จะถูกแปลงเป็น กล่องดำ / M / แก้วดำ / หมวกดำ
 * (คือสีแก้ว/หมวกเท่ากับสีกล่อง เหมือนที่เคยเป็นมา) แล้วแอดมินหรือลูกค้าแก้ไขสีได้ภายหลัง
 *
 * ใช้:  node tools/migrate-set-options.mjs <URL ของ Worker> <PIN แอดมิน>
 * จะได้ไฟล์ worker/set-options.sql และไฟล์สำรอง tools/backup-orders-*.json (มีข้อมูลลูกค้า ห้ามอัป GitHub)
 * แล้วรัน:  cd worker && npx wrangler d1 execute souvenir --file=set-options.sql --remote
 */
import { writeFileSync } from 'node:fs';

const [url, pin] = process.argv.slice(2);
if (!url || !pin) { console.error('ใช้: node tools/migrate-set-options.mjs <URL Worker> <PIN>'); process.exit(1); }

const call = async (fn, ...args) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn, args }) });
  const j = await r.json();
  if (!j.ok) throw new Error(fn + ': ' + j.error);
  return j.data;
};
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const BOX = ['กล่องขาว', 'กล่องดำ'];
const MUG = ['แก้วขาว', 'แก้วดำ'];
const CAP = ['หมวกขาว', 'หมวกดำ'];
const DEF = {
  'set-polo': { label: 'สีกล่อง/เสื้อ / ไซซ์ / สีแก้ว / สีหมวก', dims: [BOX, SIZES, MUG, CAP],
    desc: 'เซ็ตของที่ระลึก 35 ปี ในกล่องของขวัญ ประกอบด้วย เสื้อโปโล 1 ตัว + หมวก 1 ใบ + แก้วเก็บความเย็น 1 ใบ + พวงกุญแจเปิดขวด 1 ชิ้น (สีเสื้อตามสีกล่อง เลือกสีแก้วและสีหมวกได้)' },
  'set-tee': { label: 'สีกล่อง/เสื้อ / ไซซ์ / สีแก้ว', dims: [BOX, SIZES, MUG],
    desc: 'เซ็ตของที่ระลึก 35 ปี ในกล่องของขวัญ ประกอบด้วย เสื้อยืด 1 ตัว + แก้วเก็บความเย็น 1 ใบ + พวงกุญแจเปิดขวด 1 ชิ้น (สีเสื้อตามสีกล่อง เลือกสีแก้วได้)' },
};
const cart = (dims) => dims.reduce((acc, d) => acc.flatMap((a) => d.map((v) => [...a, v])), [[]]).map((x) => x.join(' / '));

const data = await call('adminGetData', pin);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(new URL(`./backup-orders-${stamp}.json`, import.meta.url), JSON.stringify({ products: data.products, orders: data.orders }, null, 2));

const prods = {};
data.products.forEach((p) => { prods[p.id] = { ...p }; });
const sql = ['-- สร้างโดย tools/migrate-set-options.mjs'];

for (const [id, d] of Object.entries(DEF)) {
  if (!prods[id]) continue;
  prods[id].options = cart(d.dims);
  prods[id].optionLabel = d.label;
  sql.push(`UPDATE products SET options = ${q(prods[id].options.join(','))}, option_label = ${q(d.label)}, description = ${q(d.desc)} WHERE id = ${q(id)};`);
}

const legacy = (id, opt) => {
  const s = String(opt).split(' / ');
  if (s.length !== 2) return null;           // แบบใหม่อยู่แล้ว (หรือรูปแบบอื่น)
  const c = s[0].trim(), sz = s[1].trim();
  return id === 'set-polo' ? ['กล่อง' + c, sz, 'แก้ว' + c, 'หมวก' + c].join(' / ') : ['กล่อง' + c, sz, 'แก้ว' + c].join(' / ');
};

let changedOrders = 0, changedLines = 0, skipped = 0;
for (const o of data.orders) {
  let items;
  try { items = JSON.parse(o.json); } catch (e) { continue; }
  let touched = false;
  items = items.map((it) => {
    if (!DEF[it.id]) return it;
    const no = legacy(it.id, it.opt);
    if (!no) return it;
    if (!prods[it.id].options.includes(no)) { skipped++; return it; }
    touched = true; changedLines++;
    return { ...it, opt: no };
  });
  if (!touched) continue;
  const text = items.map((it) => {
    const p = prods[it.id];
    if (!p) return it.name + ' x' + it.qty;
    const extra = p.price > 0 && Number(it.price) > p.price ? Number(it.price) - p.price : 0;
    return p.name + (p.options.length ? ' (' + p.optionLabel + ' ' + it.opt + ')' : '') + (extra > 0 ? ' (+฿' + extra + ')' : '') + ' x' + it.qty;
  }).join('\n');
  changedOrders++;
  sql.push(`UPDATE orders SET items_json = ${q(JSON.stringify(items))}, items_text = ${q(text)} WHERE order_no = ${q(o.orderNo)};`);
}

writeFileSync(new URL('../worker/set-options.sql', import.meta.url), sql.join('\n') + '\n');
console.log(`ตัวเลือกใหม่: เซ็ตโปโล ${cart(DEF['set-polo'].dims).length} / เซ็ตเสื้อยืด ${cart(DEF['set-tee'].dims).length}`);
console.log(`ออเดอร์ที่จะแปลง: ${changedOrders} ออเดอร์ (${changedLines} รายการ) ข้าม ${skipped}`);
console.log('ไฟล์ SQL: worker/set-options.sql | ไฟล์สำรอง: tools/backup-orders-' + stamp + '.json');
