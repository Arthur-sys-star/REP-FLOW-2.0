const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per image

// Builds a multer instance that stores uploads under public/uploads/<subfolder>/
// with a safe, unpredictable filename (never trusts the original name).
function makeUploader(subfolder) {
  const dir = path.join(UPLOAD_ROOT, subfolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_EXT.includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP or GIF images are allowed.'));
    }
    cb(null, true);
  };

  return multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE, files: 10 } });
}

// The public, web-servable path for a file already saved by makeUploader.
// public/ is served statically at "/", so public/uploads/tickets/x.jpg -> /uploads/tickets/x.jpg
function relativePath(subfolder, filename) {
  return `/uploads/${subfolder}/${filename}`;
}

module.exports = { makeUploader, relativePath, UPLOAD_ROOT };
