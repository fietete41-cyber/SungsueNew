-- ระบบแจ้งโอน/ตรวจสลิป: เพิ่มคอลัมน์ในตาราง orders
-- รัน: npx wrangler d1 execute souvenir --file=migrations/2026-11-03-payment-notice.sql --remote
ALTER TABLE orders ADD COLUMN notice_at TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN notice_amount INTEGER;
ALTER TABLE orders ADD COLUMN notice_time TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN notice_note TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN admin_msg TEXT NOT NULL DEFAULT '';
-- ออเดอร์ที่เคยแนบสลิปไว้แล้ว ถือว่าแจ้งโอนแล้ว (ให้ขึ้นในรายการรอตรวจสอบของแอดมิน)
UPDATE orders SET notice_at = created_at WHERE slip_url != '' AND status = 'รอชำระเงิน';
