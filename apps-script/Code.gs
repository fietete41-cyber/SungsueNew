/**
 * ระบบสั่งจองของที่ระลึก — Apps Script ตัวจิ๋ว (เก็บสลิปโอนเงินลง Google Drive อย่างเดียว)
 * -------------------------------------------------------------------------
 * ข้อมูลออเดอร์/แอดมิน/สต็อก อยู่ที่ Cloudflare Worker + D1 แล้ว
 * Worker จะส่งสลิปมาที่นี่ (server-to-server) พร้อม UPLOAD_KEY
 *
 * ติดตั้ง:
 *  1) Project Settings > Script properties > เพิ่ม  UPLOAD_KEY = สตริงสุ่มยาว ๆ (ค่าเดียวกับที่ตั้งใน Worker)
 *  2) Deploy > New deployment > Web app — Execute as: Me, Who has access: Anyone
 *  3) เอา URL /exec ไปใส่ worker/wrangler.toml -> APPS_SCRIPT_URL
 */

var FOLDER_NAME = 'สลิปสั่งจองของที่ระลึก';

function doGet() {
  return jsonOut({ ok: true, service: 'souvenir-slip-handler' });
}

function doPost(e) {
  try {
    var key = PropertiesService.getScriptProperties().getProperty('UPLOAD_KEY');
    if (!key || e.parameter.key !== key) throw new Error('unauthorized');

    if (e.parameter.action === 'uploadFile') {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(e.parameter.fileData),
        e.parameter.mimeType || 'image/jpeg',
        e.parameter.fileName || 'slip.jpg'
      );
      var it = DriveApp.getFoldersByName(FOLDER_NAME);
      var folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
      var f = folder.createFile(blob);
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return jsonOut({ success: true, url: f.getUrl(), id: f.getId() });
    }
    throw new Error('unknown action');
  } catch (err) {
    return jsonOut({ success: false, error: String(err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
