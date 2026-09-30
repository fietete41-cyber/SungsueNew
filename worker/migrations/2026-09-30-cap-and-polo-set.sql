-- แก้เซ็ตโปโลเป็นแบบมีหมวก + เพิ่มสินค้าหมวก
-- รัน: npx wrangler d1 execute souvenir --file=migrations/2026-09-30-cap-and-polo-set.sql --remote
UPDATE products SET
  name = 'เซ็ตโปโล 35 ปี (เสื้อโปโล + หมวก + แก้ว + พวงกุญแจ)',
  description = 'เซ็ตของที่ระลึก 35 ปี ในกล่องของขวัญ ประกอบด้วย เสื้อโปโล 1 ตัว + หมวก 1 ใบ + แก้วเก็บความเย็น 1 ใบ + พวงกุญแจเปิดขวด 1 ชิ้น (สีเสื้อ หมวก และแก้ว ตามสีกล่อง)',
  image = 'img/set-polo-cap.jpg',
  poster = 'img/set-polo-cap.jpg'
WHERE id = 'set-polo';
INSERT OR IGNORE INTO products (id, sort, name, price, options, option_label, stock, active, image, description, poster) VALUES
  ('cap', 8, 'หมวกแก๊ป Electrical Power', 0, 'ดำ,ขาว', 'สี', NULL, 1, 'img/cap.jpg',
   'หมวกแก๊ป ปักโลโก้ Electrical Power งานปักคุณภาพสูง คมชัด ผ้าคุณภาพ ระบายอากาศดี สายปรับขนาดได้ ด้านในเก็บงานเรียบร้อย เลือกได้ 2 สี',
   'img/poster-cap.jpg');
