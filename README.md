# ระบบสำรวจ/สั่งจองของที่ระลึก — Vercel + Cloudflare

```
web/         หน้าเว็บ (static)              -> Vercel  (Root Directory = web)
worker/      API + ฐานข้อมูล                -> Cloudflare Worker + D1
apps-script/ ตัวจิ๋ว เก็บสลิปลง Google Drive -> Apps Script (ใช้เก็บไฟล์อย่างเดียว)
tools/       migrate.mjs ย้ายออเดอร์เดิมจากชีต
```
ไม่ต้องใช้บัตรเครดิต (Cloudflare Free / Vercel Hobby)

## 1) Apps Script ตัวจิ๋ว (เก็บสลิป)
1. https://script.google.com > New project > วางโค้ดจาก `apps-script/Code.gs`
2. Project Settings > Script properties > เพิ่ม `UPLOAD_KEY` = สตริงสุ่มยาว ๆ (จดไว้ ใช้ข้อ 2)
3. Deploy > New deployment > Web app — Execute as **Me**, Who has access **Anyone** > อนุญาตสิทธิ์
4. คัดลอก URL ที่ลงท้าย `/exec`

## 2) Cloudflare Worker + D1
```bash
cd worker
npx wrangler login
npx wrangler d1 create souvenir          # เอา database_id ไปใส่ wrangler.toml
npx wrangler d1 execute souvenir --file=schema.sql --remote
```
แก้ `worker/wrangler.toml`: `database_id` และ `APPS_SCRIPT_URL` (URL /exec จากข้อ 1) แล้ว
```bash
npx wrangler secret put ADMIN_PASS       # PIN แอดมิน 6 หลัก
npx wrangler secret put UPLOAD_KEY       # ค่าเดียวกับใน Apps Script
npx wrangler deploy                      # ได้ URL https://souvenir-api.<ชื่อ>.workers.dev
```

## 3) ย้ายออเดอร์เดิมจากระบบเก่า (ถ้ามี)
```bash
node tools/migrate.mjs "<URL /exec ของ Apps Script เดิม>" <PIN แอดมินเดิม>
cd worker && npx wrangler d1 execute souvenir --file=seed.sql --remote
```
ดึงสินค้า ราคา สต็อก ออเดอร์ โหมด ข้อมูลบัญชี ค่าจัดส่ง จากระบบเดิมมาใส่ D1 (ไฟล์ `seed.sql` มีข้อมูลลูกค้า ห้ามอัป GitHub — ถูก ignore ไว้แล้ว) — ถ้าไม่มีออเดอร์เก่า ข้ามข้อนี้ได้ ระบบมีสินค้าเริ่มต้นให้แล้ว

## 4) หน้าเว็บ -> Vercel
1. เปิด `web/index.html` แก้ `API_URL` เป็น URL ของ Worker (ข้อ 2)
2. push ขึ้น GitHub แล้ว Vercel > Add New Project > เลือก repo > **Root Directory = `web`** > Deploy
3. Vercel ตั้ง `Cache-Control: must-revalidate` ให้แล้ว (`web/vercel.json`) ผู้ใช้จะได้หน้าใหม่เสมอ

## ตั้งค่า / ใช้งาน
- ชื่อร้าน ข้อมูลบัญชี ค่าจัดส่ง แก้ได้ในหน้าแอดมิน > "ตั้งค่าร้าน" (ไม่ต้องแก้โค้ด)
- ราคา สต็อก เปิด/ปิดขายสินค้า แก้ในหน้าแอดมิน > "สินค้า / ราคา / สต็อก"
- เปลี่ยน PIN: `cd worker && npx wrangler secret put ADMIN_PASS`
- เพิ่ม/แก้ตัวเลือกสินค้า: `npx wrangler d1 execute souvenir --remote --command "UPDATE products SET options='...' WHERE id='ring'"`
- ดูข้อมูล: Cloudflare Dashboard > Storage & Databases > D1 > souvenir
- แก้ `web/index.html` แล้ว push ให้เพิ่มเลข `VER` ใน index.html และ `web/version.json` ให้ตรงกัน

## ขั้นตอนการใช้งาน
สำรวจ (ยังไม่โอน) -> แอดมินดูสรุปยอด -> "เปิดชำระเงิน" -> ลูกค้าเข้า "ตรวจสอบ" ด้วยเบอร์โทร เลือกรับเอง/จัดส่ง (+ค่าจัดส่ง) โอนและแนบสลิป -> แอดมินเปลี่ยนสถานะ
