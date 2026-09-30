/**
 * ระบบสำรวจ/สั่งจองของที่ระลึก — Cloudflare Worker API
 * -------------------------------------------------------------
 * เก็บข้อมูล : Cloudflare D1 (binding: DB)
 * เก็บสลิป   : Google Drive ผ่าน Apps Script ตัวจิ๋ว (env.APPS_SCRIPT_URL + env.UPLOAD_KEY)
 * แอดมิน     : PIN 6 หลักใน secret env.ADMIN_PASS
 *
 * สัญญา API เหมือนตอนเป็น Apps Script:  POST JSON {"fn":"ชื่อฟังก์ชัน","args":[...]}
 * ตอบ {"ok":true,"data":...}  หรือ {"ok":false,"error":"ข้อความ"}
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const STATUSES = ['สำรวจ', 'รอชำระเงิน', 'ชำระแล้ว', 'กำลังผลิต', 'พร้อมรับ', 'รับแล้ว', 'ยกเลิก'];
const MODES = ['survey', 'pay', 'order', 'closed'];
// ไซร์สใหญ่ (3XL ขึ้นไป) บวกเพิ่มต่อตัว — ใช้กับทุกสินค้าที่มีตัวเลือกไซร์สเหล่านี้ (เสื้อ / เซ็ตที่มีเสื้อ)
const BIG_SIZES = ['3XL', '4XL', '5XL', '6XL'];
function sizeOf(opt) { const s = String(opt || '').split(' / ')[1]; return s ? s.trim().toUpperCase() : ''; }
const isBig = (opt) => BIG_SIZES.includes(sizeOf(opt));
const unitPrice = (p, opt, fee) => (p.price > 0 ? p.price + (fee > 0 && isBig(opt) ? fee : 0) : 0);
const lineText = (p, opt, qty, extra) =>
  p.name + (p.options.length ? ' (' + p.optionLabel + ' ' + opt + ')' : '') + (extra > 0 ? ' (+฿' + extra + ')' : '') + ' x' + qty;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

class UserError extends Error {}
const fail = (m) => { throw new UserError(m); };

/* ---------- helpers ---------- */
const digits = (s) => String(s || '').replace(/\D/g, '');
const pad = (n) => String(n).padStart(2, '0');

function bkk(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const o = {};
  parts.forEach((p) => { o[p.type] = p.value; });
  return o;
}
const fmtLong = (iso) => { const o = bkk(iso); return `${+o.day}/${+o.month}/${o.year} ${o.hour === '24' ? '00' : o.hour}:${o.minute}`; };
const fmtShort = (iso) => { const o = bkk(iso); return `${+o.day}/${+o.month}/${String(o.year).slice(2)} ${o.hour === '24' ? '00' : o.hour}:${o.minute}`; };

async function setting(env, key, def = '') {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return r ? r.value : def;
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value)).run();
}
function checkAdmin(env, pass) {
  const real = String(env.ADMIN_PASS || '');
  if (!real || String(pass) !== real) fail('รหัสแอดมินไม่ถูกต้อง');
}

async function readProducts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort').all();
  return results.map((r) => ({
    row: r.sort, id: r.id, name: r.name, price: Number(r.price) || 0,
    options: String(r.options || '').split(',').map((s) => s.trim()).filter(Boolean),
    optionLabel: r.option_label || 'ตัวเลือก',
    stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
    active: !!r.active, image: r.image || '', desc: r.description || '', poster: r.poster || '',
  }));
}

async function bankInfo(env) {
  return {
    name: await setting(env, 'BANK_NAME', ''),
    account: await setting(env, 'BANK_ACCOUNT', ''),
    holder: await setting(env, 'BANK_HOLDER', ''),
    note: await setting(env, 'PAY_INFO', ''),
  };
}

/* เปลี่ยนตัวเลือกของสินค้า 1 รายการในออเดอร์ (เช่น สีแก้ว/หมวกในเซ็ต) แล้วคำนวณยอดใหม่ */
async function changeItemOption(env, o, idx, opt, lockTotal) {
  let items = [];
  try { items = JSON.parse(o.items_json); } catch (e) { items = []; }
  const it = items[idx];
  if (!it) fail('ไม่พบรายการสินค้า');
  const products = await readProducts(env);
  const byId = {};
  products.forEach((p) => { byId[p.id] = p; });
  const p = byId[it.id];
  if (!p || !p.options.length) fail('สินค้านี้แก้ตัวเลือกไม่ได้');
  if (p.options.indexOf(opt) < 0) fail('ตัวเลือกไม่ถูกต้อง');
  const bigFee = Number(await setting(env, 'BIG_SIZE_FEE', '50')) || 0;
  items[idx] = { ...it, opt, price: unitPrice(p, opt, bigFee) };
  let total = 0;
  const lines = [];
  items.forEach((x) => {
    const q = byId[x.id];
    const unit = Number(x.price) || 0;
    total += unit * x.qty;
    lines.push(q ? lineText(q, x.opt, x.qty, q.price > 0 && unit > q.price ? unit - q.price : 0) : x.name + ' x' + x.qty);
  });
  if (lockTotal && total !== o.total) fail('ตัวเลือกนี้ทำให้ราคาเปลี่ยน (ออเดอร์ชำระเงินแล้ว) กรุณาติดต่อแอดมิน');
  await env.DB.prepare('UPDATE orders SET items_json = ?, items_text = ?, total = ? WHERE order_no = ?')
    .bind(JSON.stringify(items), lines.join('\n'), total, o.order_no).run();
  return { total, line: lines[idx] };
}

async function uploadSlip(env, orderNo, slip) {
  if (!env.APPS_SCRIPT_URL || env.APPS_SCRIPT_URL.startsWith('PUT_')) fail('ยังไม่ได้ตั้งค่าที่เก็บสลิป');
  const body = new URLSearchParams({
    action: 'uploadFile', key: env.UPLOAD_KEY || '',
    fileData: slip.base64, mimeType: slip.mime || 'image/jpeg', fileName: orderNo + '.jpg',
  });
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST', body, redirect: 'follow',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const j = await res.json().catch(() => null);
  if (!j || !j.success) fail('อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่');
  return j.url;
}

async function nextOrderNo(env, offset) {
  const o = bkk(new Date().toISOString());
  const c = (await env.DB.prepare('SELECT COUNT(*) AS c FROM orders').first()).c;
  return 'SV' + String(o.year).slice(2) + pad(o.month) + pad(o.day) + '-' + String(c + 1 + offset).padStart(3, '0');
}

function isDeducted(v) { return v === 1 || v === true || v === '1'; }

/* ---------- API: ลูกค้า ---------- */
const API = {
  async getShop(env) {
    const products = (await readProducts(env)).filter((p) => p.active);
    return {
      title: await setting(env, 'SHOP_TITLE', 'สั่งจองของที่ระลึก'),
      payInfo: await setting(env, 'PAY_INFO', ''),
      bank: await bankInfo(env),
      contactPhone: await setting(env, 'CONTACT_PHONE', ''),
      bigSizeFee: Number(await setting(env, 'BIG_SIZE_FEE', '50')) || 0,
      mode: await setting(env, 'MODE', 'survey'),
      products: products.map((p) => ({
        id: p.id, name: p.name, price: p.price, options: p.options, optionLabel: p.optionLabel,
        soldOut: p.stock !== null && p.stock <= 0, stock: p.stock, image: p.image, desc: p.desc, poster: p.poster,
      })),
    };
  },

  async submitOrder(env, data) {
    data = data || {};
    const mode = await setting(env, 'MODE', 'survey');
    if (mode !== 'survey' && mode !== 'order') fail(mode === 'pay' ? 'ปิดรับสำรวจแล้ว อยู่ในขั้นตอนชำระเงิน' : 'ปิดรับจองแล้ว');
    const useStock = mode === 'order';
    const name = String(data.name || '').trim();
    const phone = digits(data.phone);
    if (!name) fail('กรุณากรอกชื่อ-สกุล');
    if (phone.length < 9) fail('กรุณากรอกเบอร์โทรให้ถูกต้อง');
    if (!Array.isArray(data.items) || !data.items.length) fail('ยังไม่ได้เลือกสินค้า');

    const products = await readProducts(env);
    const bigFee = Number(await setting(env, 'BIG_SIZE_FEE', '50')) || 0;
    const byId = {};
    products.forEach((p) => { byId[p.id] = p; });
    const need = {}, lines = [], clean = [];
    let total = 0;

    data.items.forEach((it) => {
      const p = byId[it.id];
      const qty = Math.floor(Number(it.qty));
      if (!p || !p.active) fail('ไม่พบสินค้า: ' + it.id);
      if (!(qty > 0) || qty > 50) fail('จำนวนไม่ถูกต้อง: ' + p.name);
      if (p.options.length && p.options.indexOf(it.opt) < 0) fail('กรุณาเลือก' + p.optionLabel + ': ' + p.name);
      need[p.id] = (need[p.id] || 0) + qty;
      const unit = unitPrice(p, it.opt, bigFee);
      total += unit * qty;
      lines.push(lineText(p, it.opt, qty, unit > p.price ? unit - p.price : 0));
      clean.push({ id: p.id, name: p.name, opt: it.opt || '', qty, price: unit });
    });

    if (useStock) {
      Object.keys(need).forEach((id) => {
        const p = byId[id];
        if (p.stock !== null && p.stock < need[id]) fail(p.name + ' เหลือ ' + Math.max(p.stock, 0) + ' ชิ้น');
      });
    }

    let orderNo = await nextOrderNo(env, 0);
    let slipUrl = '';
    if (useStock && data.slip && data.slip.base64) slipUrl = await uploadSlip(env, orderNo, data.slip);

    const now = new Date().toISOString();
    let inserted = false;
    for (let i = 0; i < 6 && !inserted; i++) {
      try {
        const stmts = [env.DB.prepare(
          `INSERT INTO orders (order_no, created_at, name, phone, grp, items_text, total, status, slip_url, note, items_json, stock_deducted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(orderNo, now, name, phone, String(data.group || '').trim(), lines.join('\n'), total,
          useStock ? 'รอชำระเงิน' : 'สำรวจ', slipUrl, String(data.note || '').trim(), JSON.stringify(clean), useStock ? 1 : 0)];
        if (useStock) {
          Object.keys(need).forEach((id) => {
            if (byId[id].stock !== null) {
              stmts.push(env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL').bind(need[id], id));
            }
          });
        }
        await env.DB.batch(stmts);
        inserted = true;
      } catch (e) {
        if (!/UNIQUE|constraint/i.test(String(e.message))) throw e;
        orderNo = await nextOrderNo(env, i + 1);
      }
    }
    if (!inserted) fail('ระบบไม่ว่าง กรุณาลองใหม่');
    return { orderNo, total, lines, survey: !useStock };
  },

  async attachSlip(env, orderNo, phone, slip) {
    const o = await env.DB.prepare('SELECT order_no FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, digits(phone)).first();
    if (!o) fail('ไม่พบออเดอร์');
    if (!slip || !slip.base64) fail('ไม่พบไฟล์สลิป');
    const url = await uploadSlip(env, orderNo, slip);
    await env.DB.prepare('UPDATE orders SET slip_url = ? WHERE order_no = ?').bind(url, orderNo).run();
    return true;
  },

  async trackOrders(env, phone) {
    const p = digits(phone);
    if (p.length < 9) fail('กรุณากรอกเบอร์โทร');
    const { results } = await env.DB.prepare('SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC').bind(p).all();
    return {
      orders: results.map((r) => ({
        orderNo: r.order_no, time: fmtLong(r.created_at), items: r.items_text, total: r.total, status: r.status,
        hasSlip: !!r.slip_url, ringSize: r.ring_size || '', delivery: r.delivery || '', fee: r.fee || 0,
        addr: r.addr || '', dphone: r.dphone || '',
        lines: (() => { try { return JSON.parse(r.items_json).map((i) => ({ id: i.id, opt: i.opt, qty: i.qty })); } catch (e) { return []; } })(),
      })),
      payInfo: await setting(env, 'PAY_INFO', ''),
      bank: await bankInfo(env),
      mode: await setting(env, 'MODE', 'survey'),
      contactPhone: await setting(env, 'CONTACT_PHONE', ''),
      shipFee: Number(await setting(env, 'SHIP_FEE', '50')) || 0,
    };
  },

  async editMyOrderItem(env, orderNo, phone, idx, opt) {
    const o = await env.DB.prepare('SELECT * FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, digits(phone)).first();
    if (!o) fail('ไม่พบออเดอร์');
    if (!['สำรวจ', 'รอชำระเงิน', 'ชำระแล้ว'].includes(o.status)) fail('แก้ไขไม่ได้แล้ว เพราะออเดอร์อยู่ในขั้นตอนผลิตหรือเสร็จสิ้น กรุณาติดต่อแอดมิน');
    return changeItemOption(env, o, Number(idx), opt, o.status === 'ชำระแล้ว');
  },

  async cancelMyOrder(env, orderNo, phone) {
    const o = await env.DB.prepare('SELECT status, items_json, stock_deducted FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, digits(phone)).first();
    if (!o) fail('ไม่พบออเดอร์');
    if (o.status === 'ยกเลิก') fail('ออเดอร์นี้ถูกยกเลิกไปแล้ว');
    if ((await setting(env, 'MODE', 'survey')) === 'closed') fail('ปิดรับแล้ว ยกเลิกเองไม่ได้ กรุณาติดต่อแอดมิน');
    if (o.status !== 'สำรวจ' && o.status !== 'รอชำระเงิน') fail('ออเดอร์ชำระเงินแล้วหรืออยู่ระหว่างดำเนินการ ยกเลิกเองไม่ได้ กรุณาติดต่อแอดมิน');
    const stmts = [env.DB.prepare("UPDATE orders SET status = 'ยกเลิก' WHERE order_no = ?").bind(orderNo)];
    if (isDeducted(o.stock_deducted)) {
      let items = [];
      try { items = JSON.parse(o.items_json); } catch (e) { /* ignore */ }
      items.forEach((it) => {
        stmts.push(env.DB.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').bind(it.qty, it.id));
      });
    }
    await env.DB.batch(stmts);
    return true;
  },

  async setDelivery(env, orderNo, phone, d) {
    d = d || {};
    const method = d.method === 'จัดส่ง' ? 'จัดส่ง' : 'รับด้วยตนเอง';
    const addr = String(d.addr || '').trim();
    const dphone = digits(d.phone);
    if (method === 'จัดส่ง') {
      if (addr.length < 10) fail('กรุณากรอกที่อยู่จัดส่งให้ครบถ้วน');
      if (dphone.length < 9) fail('กรุณากรอกเบอร์โทรสำหรับจัดส่งให้ถูกต้อง');
    }
    const o = await env.DB.prepare('SELECT status FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, digits(phone)).first();
    if (!o) fail('ไม่พบออเดอร์');
    if (o.status !== 'รอชำระเงิน' && o.status !== 'ชำระแล้ว') fail('เปลี่ยนวิธีรับสินค้าได้เฉพาะออเดอร์ที่ยังไม่เริ่มผลิต กรุณาติดต่อแอดมิน');
    const fee = method === 'จัดส่ง' ? Number(await setting(env, 'SHIP_FEE', '50')) || 0 : 0;
    await env.DB.prepare('UPDATE orders SET delivery = ?, fee = ?, addr = ?, dphone = ? WHERE order_no = ?')
      .bind(method, fee, method === 'จัดส่ง' ? addr : '', method === 'จัดส่ง' ? dphone : '', orderNo).run();
    return { method, fee };
  },

  async submitReport(env, d) {
    d = d || {};
    const name = String(d.name || '').trim().slice(0, 80);
    const phone = digits(d.phone);
    let message = String(d.message || '').trim().slice(0, 1000);
    const orderNo = String(d.orderNo || '').trim().slice(0, 30);
    if (!name) fail('กรุณากรอกชื่อ-สกุล');
    if (phone.length < 9) fail('กรุณากรอกเบอร์โทรให้ถูกต้อง เพื่อให้แอดมินติดต่อกลับ');
    if (message.length < 5) fail('กรุณาอธิบายปัญหาให้ละเอียดขึ้นเล็กน้อย');
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM reports WHERE phone = ? AND created_at > ?').bind(phone, since).first();
    if (c.c >= 5) fail('ส่งเรื่องบ่อยเกินไป กรุณารอสักครู่ หรือติดต่อแอดมินโดยตรง');
    if (orderNo) message = '[ออเดอร์ ' + orderNo + '] ' + message;
    const kind = d.kind === 'contact' ? 'contact' : 'problem';
    await env.DB.prepare('INSERT INTO reports (created_at, name, phone, message, kind) VALUES (?,?,?,?,?)')
      .bind(new Date().toISOString(), name, phone, message, kind).run();
    return true;
  },

  /* ---------- API: แอดมิน ---------- */
  async adminGetReports(env, pass) {
    checkAdmin(env, pass);
    const { results } = await env.DB.prepare('SELECT * FROM reports ORDER BY (status = \'ใหม่\') DESC, created_at DESC LIMIT 200').all();
    return results.map((r) => ({ id: r.id, time: fmtShort(r.created_at), name: r.name, phone: r.phone, message: r.message, kind: r.kind || 'problem', status: r.status }));
  },

  async adminSetReportStatus(env, pass, id, status) {
    checkAdmin(env, pass);
    if (status !== 'ใหม่' && status !== 'จัดการแล้ว') fail('สถานะไม่ถูกต้อง');
    const r = await env.DB.prepare('UPDATE reports SET status = ?, handled_at = ? WHERE id = ?')
      .bind(status, status === 'จัดการแล้ว' ? new Date().toISOString() : '', Number(id)).run();
    if (!r.meta.changes) fail('ไม่พบรายการ');
    return true;
  },

  async adminDeleteReport(env, pass, id) {
    checkAdmin(env, pass);
    await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(Number(id)).run();
    return true;
  },

  async adminLogin(env, pass) {
    checkAdmin(env, pass);
    return { statuses: STATUSES };
  },

  async adminGetData(env, pass) {
    checkAdmin(env, pass);
    const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    return {
      orders: results.map((r) => ({
        orderNo: r.order_no, time: fmtShort(r.created_at), name: r.name, phone: r.phone, group: r.grp,
        items: r.items_text, total: r.total, status: r.status, slip: r.slip_url, note: r.note, json: r.items_json,
        ringSize: r.ring_size || '', delivery: r.delivery || '', fee: r.fee || 0, addr: r.addr || '', dphone: r.dphone || '',
      })),
      products: await readProducts(env),
      mode: await setting(env, 'MODE', 'survey'),
      settings: {
        title: await setting(env, 'SHOP_TITLE', 'สั่งจองของที่ระลึก'),
        payInfo: await setting(env, 'PAY_INFO', ''),
        bankName: await setting(env, 'BANK_NAME', ''),
        bankAccount: await setting(env, 'BANK_ACCOUNT', ''),
        bankHolder: await setting(env, 'BANK_HOLDER', ''),
        contactPhone: await setting(env, 'CONTACT_PHONE', ''),
        bigSizeFee: Number(await setting(env, 'BIG_SIZE_FEE', '50')) || 0,
        shipFee: Number(await setting(env, 'SHIP_FEE', '50')) || 0,
      },
    };
  },

  async adminSetStatus(env, pass, orderNo, status) {
    checkAdmin(env, pass);
    if (!STATUSES.includes(status)) fail('สถานะไม่ถูกต้อง');
    const o = await env.DB.prepare('SELECT status, items_json, stock_deducted FROM orders WHERE order_no = ?').bind(orderNo).first();
    if (!o) fail('ไม่พบออเดอร์');
    const stmts = [env.DB.prepare('UPDATE orders SET status = ? WHERE order_no = ?').bind(status, orderNo)];
    if (isDeducted(o.stock_deducted)) {
      let sign = 0;
      if (status === 'ยกเลิก' && o.status !== 'ยกเลิก') sign = 1;
      if (o.status === 'ยกเลิก' && status !== 'ยกเลิก') sign = -1;
      if (sign) {
        let items = [];
        try { items = JSON.parse(o.items_json); } catch (e) { /* ignore */ }
        items.forEach((it) => {
          stmts.push(env.DB.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').bind(sign * it.qty, it.id));
        });
      }
    }
    await env.DB.batch(stmts);
    return true;
  },

  async adminSaveProduct(env, pass, row, patch) {
    checkAdmin(env, pass);
    patch = patch || {};
    const sets = [], vals = [];
    if (patch.price !== undefined) { sets.push('price = ?'); vals.push(Math.max(0, Math.round(Number(patch.price) || 0))); }
    if (patch.stock !== undefined) {
      sets.push('stock = ?');
      vals.push(patch.stock === '' || patch.stock === null ? null : Math.round(Number(patch.stock)));
    }
    if (patch.active !== undefined) { sets.push('active = ?'); vals.push(patch.active ? 1 : 0); }
    if (!sets.length) return true;
    const r = await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE sort = ?`).bind(...vals, row).run();
    if (!r.meta.changes) fail('ไม่พบสินค้า');
    return true;
  },

  async adminSetMode(env, pass, mode) {
    checkAdmin(env, pass);
    if (!MODES.includes(mode)) fail('โหมดไม่ถูกต้อง');
    let converted = 0;
    if (mode === 'pay') {
      const products = await readProducts(env);
      const byId = {};
      products.forEach((p) => { byId[p.id] = p; });
      const bigFee = Number(await setting(env, 'BIG_SIZE_FEE', '50')) || 0;
      const { results } = await env.DB.prepare("SELECT order_no, items_json FROM orders WHERE status = 'สำรวจ'").all();
      const stmts = results.map((o) => {
        let items = [];
        try { items = JSON.parse(o.items_json); } catch (e) { /* ignore */ }
        let total = 0;
        const lines = [];
        items = items.map((it) => {
          const p = byId[it.id];
          const unit = p ? unitPrice(p, it.opt, bigFee) : Number(it.price) || 0;
          total += unit * it.qty;
          lines.push(p ? lineText(p, it.opt, it.qty, unit > p.price ? unit - p.price : 0) : it.name + ' x' + it.qty);
          return { ...it, price: unit };
        });
        return env.DB.prepare("UPDATE orders SET total = ?, items_json = ?, items_text = ?, status = 'รอชำระเงิน' WHERE order_no = ?")
          .bind(total, JSON.stringify(items), lines.join('\n'), o.order_no);
      });
      for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
      converted = stmts.length;
    }
    await setSetting(env, 'MODE', mode);
    return { converted };
  },

  async adminEditOrderItem(env, pass, orderNo, idx, opt) {
    checkAdmin(env, pass);
    const o = await env.DB.prepare('SELECT * FROM orders WHERE order_no = ?').bind(orderNo).first();
    if (!o) fail('ไม่พบออเดอร์');
    return changeItemOption(env, o, Number(idx), opt, false);
  },

  async adminSetRingSize(env, pass, orderNo, size) {
    checkAdmin(env, pass);
    const r = await env.DB.prepare('UPDATE orders SET ring_size = ? WHERE order_no = ?').bind(String(size || '').trim(), orderNo).run();
    if (!r.meta.changes) fail('ไม่พบออเดอร์');
    return true;
  },

  async adminSetSettings(env, pass, s) {
    checkAdmin(env, pass);
    s = s || {};
    if (s.title !== undefined) await setSetting(env, 'SHOP_TITLE', String(s.title).trim() || 'สั่งจองของที่ระลึก');
    if (s.payInfo !== undefined) await setSetting(env, 'PAY_INFO', String(s.payInfo).trim().slice(0, 500));
    if (s.bigSizeFee !== undefined) await setSetting(env, 'BIG_SIZE_FEE', String(Math.max(0, Math.round(Number(s.bigSizeFee) || 0))));
    if (s.contactPhone !== undefined) {
      const t = String(s.contactPhone).trim();
      if (t && !/^[0-9 \-+]{5,20}$/.test(t)) fail('เบอร์โทรแอดมิน ใส่ได้เฉพาะตัวเลขและขีด (-)');
      await setSetting(env, 'CONTACT_PHONE', t);
    }
    if (s.bankName !== undefined) await setSetting(env, 'BANK_NAME', String(s.bankName).trim().slice(0, 80));
    if (s.bankAccount !== undefined) {
      const acc = String(s.bankAccount).trim();
      if (acc && !/^[0-9 \-]{5,30}$/.test(acc)) fail('เลขบัญชี/เบอร์พร้อมเพย์ ใส่ได้เฉพาะตัวเลขและขีด (-)');
      await setSetting(env, 'BANK_ACCOUNT', acc);
    }
    if (s.bankHolder !== undefined) await setSetting(env, 'BANK_HOLDER', String(s.bankHolder).trim().slice(0, 120));
    if (s.shipFee !== undefined) await setSetting(env, 'SHIP_FEE', String(Math.max(0, Math.round(Number(s.shipFee) || 0))));
    return true;
  },
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return new Response('Souvenir API OK', { headers: CORS });
    try {
      const req = await request.json();
      const fn = req && req.fn;
      if (!fn || !Object.prototype.hasOwnProperty.call(API, fn)) fail('unknown function');
      const data = await API[fn](env, ...(Array.isArray(req.args) ? req.args : []));
      return json({ ok: true, data });
    } catch (e) {
      if (e instanceof UserError) return json({ ok: false, error: e.message });
      console.error(e);
      return json({ ok: false, error: 'เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่' });
    }
  },
};
