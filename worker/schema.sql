-- ระบบสำรวจ/สั่งจองของที่ระลึก — Cloudflare D1 schema
-- รัน:  npx wrangler d1 execute souvenir --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  sort         INTEGER NOT NULL,          -- ลำดับ (ใช้เป็น "row" ในหน้าแอดมิน)
  name         TEXT NOT NULL,
  price        INTEGER NOT NULL DEFAULT 0,
  options      TEXT NOT NULL DEFAULT '',  -- คั่นด้วย ,   (แบบสองชั้นใช้ "ดำ / M")
  option_label TEXT NOT NULL DEFAULT '',
  stock        INTEGER,                   -- NULL = ไม่จำกัด
  active       INTEGER NOT NULL DEFAULT 1,
  image        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  poster       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orders (
  order_no      TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,            -- ISO UTC
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,            -- เฉพาะตัวเลข
  grp           TEXT NOT NULL DEFAULT '', -- รุ่น
  items_text    TEXT NOT NULL DEFAULT '',
  total         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'สำรวจ',
  slip_url      TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  items_json    TEXT NOT NULL DEFAULT '[]',
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  ring_size     TEXT NOT NULL DEFAULT '',
  delivery      TEXT NOT NULL DEFAULT '', -- 'รับด้วยตนเอง' | 'จัดส่ง'
  fee           INTEGER NOT NULL DEFAULT 0,
  addr          TEXT NOT NULL DEFAULT '',
  dphone        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  message    TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'problem',  -- 'problem' แจ้งปัญหา | 'contact' ติดต่อแอดมิน
  status     TEXT NOT NULL DEFAULT 'ใหม่',  -- 'ใหม่' | 'จัดการแล้ว'
  handled_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('MODE', 'survey'),
  ('SHOP_TITLE', 'สั่งจองของที่ระลึก'),
  ('PAY_INFO', ''),
  ('BANK_NAME', ''),
  ('BANK_ACCOUNT', ''),
  ('BANK_HOLDER', ''),
  ('SHIP_FEE', '50');

-- สินค้าเริ่มต้น (ราคา 0 = "ราคาแจ้งภายหลัง")
INSERT OR IGNORE INTO products (id, sort, name, price, options, option_label, stock, active, image, description, poster) VALUES
  ('polo', 1, 'เสื้อโปโล (ปักโลโก้)', 0,
   'ดำ / S,ดำ / M,ดำ / L,ดำ / XL,ดำ / 2XL,ดำ / 3XL,ดำ / 4XL,ดำ / 5XL,ดำ / 6XL,ขาว / S,ขาว / M,ขาว / L,ขาว / XL,ขาว / 2XL,ขาว / 3XL,ขาว / 4XL,ขาว / 5XL,ขาว / 6XL',
   'สี / ไซร์ส', NULL, 1, 'img/polo.jpg',
   'เสื้อโปโล ปักโลโก้ มีกระเป๋า ปกโปโลปักเส้นคารู หลังปักโลโก้ ปลายแขนปัก RAIKHING', 'img/poster-polo.jpg'),
  ('tee', 2, 'เสื้อยืด (สกรีน)', 0,
   'ดำ / S,ดำ / M,ดำ / L,ดำ / XL,ดำ / 2XL,ดำ / 3XL,ดำ / 4XL,ดำ / 5XL,ดำ / 6XL,ขาว / S,ขาว / M,ขาว / L,ขาว / XL,ขาว / 2XL,ขาว / 3XL,ขาว / 4XL,ขาว / 5XL,ขาว / 6XL',
   'สี / ไซร์ส', NULL, 1, 'img/tee.jpg',
   'เสื้อยืดสกรีน มีกระเป๋า คอกลมใส่สบาย ลายกราฟิกด้านข้าง', 'img/poster-tee.jpg'),
  ('mug', 3, 'แก้วเก็บความเย็น', 0, 'ขาว,ดำ', 'สี', NULL, 1, 'img/mug.jpg',
   'เก็บความเย็นได้ 12 ชั่วโมง เก็บความร้อนได้ 8 ชั่วโมง วัสดุสแตนเลส SUS304 ฝาพลาสติก PC', 'img/poster-mug.jpg'),
  ('ring', 4, 'แหวนช่างไฟฟ้ากำลัง 35 ปี', 0,
   'ขอวัดที่แผนกวิชา,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66',
   'ขนาดแหวน', NULL, 1, 'img/ring.jpg',
   'เงินแท้ / สแตนเลส 316L (ตามงบประมาณ) ลงยาสีฟ้า หน้าแหวน 16-18 มม. — เลือกเบอร์นิ้ว 42-66 หรือเลือก "ขอวัดที่แผนกวิชา" แล้วไปวัดที่แผนกภายหลัง (กดปุ่มด้านล่างเพื่อดูวิธีวัดไซร์สด้วยตัวเอง)',
   'img/poster-ring.jpg');

-- (ฐานข้อมูลเดิมที่สร้างตาราง reports ไปแล้ว ให้รันครั้งเดียว)
-- ALTER TABLE reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'problem';
