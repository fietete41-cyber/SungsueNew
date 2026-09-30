-- แก้คำสะกด "ไซซ์" -> "ไซร์ส" ในข้อมูลที่ใช้แสดงผล (ชื่อตัวเลือก/คำอธิบายสินค้า/ข้อความรายการในออเดอร์)
-- รัน: npx wrangler d1 execute souvenir --file=migrations/2026-09-30-spelling.sql --remote
UPDATE products SET name = REPLACE(name, 'ไซซ์', 'ไซร์ส'), option_label = REPLACE(option_label, 'ไซซ์', 'ไซร์ส'), description = REPLACE(description, 'ไซซ์', 'ไซร์ส');
UPDATE orders SET items_text = REPLACE(items_text, 'ไซซ์', 'ไซร์ส') WHERE items_text LIKE '%ไซซ์%';
UPDATE settings SET value = REPLACE(value, 'ไซซ์', 'ไซร์ส') WHERE value LIKE '%ไซซ์%';
