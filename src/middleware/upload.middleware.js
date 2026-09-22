
import multer from "multer";

const storage = multer.memoryStorage();

const allowedMimeTypes = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv", // .csv
  "application/csv",
  "text/plain", // some platforms identify csv as text/plain
];

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB memory buffer limit
  fileFilter: (req, file, cb) => {
    const isAllowedMime = allowedMimeTypes.includes(file.mimetype);
    const isAllowedExt = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (isAllowedMime || isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only Excel (.xlsx, .xls) and CSV (.csv) files are allowed."));
    }
  },
});