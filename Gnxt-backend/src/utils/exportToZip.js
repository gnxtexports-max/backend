import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import os from "os";

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/**
 * Build an ExcelJS workbook from columns/rows config.
 * Cells with type:"link" become clickable hyperlinks.
 * Returns { workbook, hyperlinkCount }.
 */
function buildWorkbook(sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GNXT";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 22,
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1D4ED8" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFBFDBFE" } },
    };
  });
  headerRow.height = 22;

  let hyperlinkCount = 0;

  for (const rowData of rows) {
    const rowValues = {};
    for (const col of columns) {
      const val = rowData[col.key];
      if (col.type === "link" && val && typeof val === "object" && val.target) {
        rowValues[col.key] = val.label || "View";
      } else {
        rowValues[col.key] = val !== null && val !== undefined ? val : "";
      }
    }

    const excelRow = worksheet.addRow(rowValues);
    excelRow.height = 18;

    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const val = rowData[col.key];

      if (col.type === "link" && val && typeof val === "object" && val.target) {
        const cell = excelRow.getCell(ci + 1);
        cell.value = {
          text: val.label || "View",
          hyperlink: val.target,
          tooltip: val.tooltip || val.label || "View",
        };
        cell.font = {
          color: { argb: "FF1D4ED8" },
          underline: true,
          size: 11,
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        hyperlinkCount++;
      } else {
        const cell = excelRow.getCell(ci + 1);
        cell.alignment = { vertical: "middle" };
        cell.font = { size: 11 };
      }
    }

    const isEven = excelRow.number % 2 === 0;
    if (isEven) {
      excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const col = columns[colNumber - 1];
        if (!col || col.type !== "link" || !rowData[col.key]?.target) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFC" },
          };
        }
      });
    }
  }

  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  if (rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  return { workbook, hyperlinkCount };
}

/**
 * Generate a standalone .xlsx file and stream it to the HTTP response.
 * No ZIP involved — produces a valid Office Open XML spreadsheet.
 * Writes to a temp file first, then streams the raw bytes via pipe
 * to avoid any Express encoding interference with binary data.
 *
 * @param {object} opts
 * @param {import("express").Response} opts.res
 * @param {string} opts.filename       - Download filename (e.g. "Shipment_History.xlsx")
 * @param {string} opts.sheetName      - Excel sheet tab name
 * @param {Array<{header:string, key:string, width?:number, type?:"link"|"text"}>} opts.columns
 * @param {Array<Record<string,any>>}  opts.rows   - Row objects. For link cells, value must be {label, target, tooltip?}
 */
export async function streamExcelExport(opts) {
  const { res, filename, sheetName, columns, rows } = opts;

  console.log(`[ExcelExport] Starting export: ${filename}`);
  console.log(`[ExcelExport] Record count: ${rows.length}`);

  const { workbook, hyperlinkCount } = buildWorkbook(sheetName, columns, rows);

  console.log(`[ExcelExport] Generated row count: ${rows.length + 1} (incl. header)`);
  console.log(`[ExcelExport] Hyperlink count: ${hyperlinkCount}`);

  const buffer = await workbook.xlsx.writeBuffer();
  const bufferBytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const tmpXlsx = path.join(os.tmpdir(), `gnxt-xlsx-${Date.now()}-${Math.random().toString(36).substring(7)}.xlsx`);
  fs.writeFileSync(tmpXlsx, bufferBytes);

  const fileSize = bufferBytes.length;
  console.log(`[ExcelExport] File size: ${(fileSize / 1024).toFixed(1)} KB`);
  console.log(`[ExcelExport] Export completed: ${filename}`);

  try {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", fileSize);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(tmpXlsx);
      readStream.on("error", reject);
      res.on("error", reject);
      res.on("finish", resolve);
      readStream.pipe(res);
    });
  } finally {
    try { fs.unlinkSync(tmpXlsx); } catch {}
  }
}

/**
 * Decode a base64 data URL to a Buffer.
 * Input: "data:image/jpeg;base64,/9j/4AAQ..."
 * Output: { buffer: Buffer, ext: ".jpg" }
 */
export function decodeBase64Image(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  const extMap = { jpeg: ".jpg", jpg: ".jpg", png: ".png", webp: ".webp", gif: ".gif" };
  const ext = extMap[match[1]] || ".jpg";
  return { buffer: Buffer.from(match[2], "base64"), ext };
}
