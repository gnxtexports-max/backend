import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import os from "os";
import { fetchImageForExcel, clearImageExportCache } from "../services/r2.service.js";

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/**
 * Build an ExcelJS workbook from columns/rows config.
 * Supports embedding binary images directly into cells (type: "image")
 * as well as hyperlinks (type: "link").
 * Returns { workbook, hyperlinkCount, imageCount }.
 */
async function buildWorkbook(sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GNXT";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || (c.type === "image" ? 22 : 22),
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
  headerRow.height = 24;

  let hyperlinkCount = 0;
  let imageCount = 0;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const rowData = rows[rIdx];
    const rowValues = {};
    let hasImageInRow = false;

    for (const col of columns) {
      const val = rowData[col.key];
      if (col.type === "image") {
        hasImageInRow = true;
        rowValues[col.key] = "";
      } else if (col.type === "link" && val && typeof val === "object" && val.target) {
        rowValues[col.key] = val.label || "View";
      } else {
        rowValues[col.key] = val !== null && val !== undefined ? val : "";
      }
    }

    const excelRow = worksheet.addRow(rowValues);
    const rowNumber = excelRow.number; // 1-indexed (header is 1)
    excelRow.height = hasImageInRow ? 75 : 20;

    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const val = rowData[col.key];

      if (col.type === "image") {
        const cell = excelRow.getCell(ci + 1);
        cell.alignment = { vertical: "middle", horizontal: "center" };

        if (val) {
          const imgData = await fetchImageForExcel(val);
          if (imgData && imgData.isPdf) {
            cell.value = {
              text: "View PDF Document",
              hyperlink: val,
              tooltip: "Open PDF file",
            };
            cell.font = {
              color: { argb: "FF1D4ED8" },
              underline: true,
              size: 10,
            };
          } else if (imgData && imgData.buffer) {
            try {
              const imageId = workbook.addImage({
                buffer: imgData.buffer,
                extension: imgData.extension,
              });

              // Position image inside the cell
              worksheet.addImage(imageId, {
                tl: { col: ci, row: rowNumber - 1 },
                ext: { width: 100, height: 90 },
                editAs: "oneCell",
              });
              cell.value = "";
              imageCount++;
            } catch (imgErr) {
              console.error(`[buildWorkbook] Failed to embed image into Excel cell (${rowNumber}, ${ci + 1}):`, imgErr.message);
              cell.value = "No Image Available";
              cell.font = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
            }
          } else {
            cell.value = "No Image Available";
            cell.font = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
          }
        } else {
          cell.value = "No Image Available";
          cell.font = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
        }
      } else if (col.type === "link" && val && typeof val === "object" && val.target) {
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
        if (!col || (col.type !== "link" && col.type !== "image")) {
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

  // Clear export cache
  clearImageExportCache();

  return { workbook, hyperlinkCount, imageCount };
}

/**
 * Generate a standalone .xlsx file and stream it to the HTTP response.
 *
 * @param {object} opts
 * @param {import("express").Response} opts.res
 * @param {string} opts.filename       - Download filename
 * @param {string} opts.sheetName      - Excel sheet tab name
 * @param {Array<{header:string, key:string, width?:number, type?:"link"|"image"|"text"}>} opts.columns
 * @param {Array<Record<string,any>>}  opts.rows   - Row objects.
 */
export async function streamExcelExport(opts) {
  const { res, filename, sheetName, columns, rows } = opts;

  console.log(`[ExcelExport] Starting export: ${filename}`);
  console.log(`[ExcelExport] Record count: ${rows.length}`);

  const { workbook, hyperlinkCount, imageCount } = await buildWorkbook(sheetName, columns, rows);

  console.log(`[ExcelExport] Generated row count: ${rows.length + 1} (incl. header)`);
  console.log(`[ExcelExport] Embedded image count: ${imageCount}`);
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
 */
export function decodeBase64Image(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  const extMap = { jpeg: ".jpg", jpg: ".jpg", png: ".png", webp: ".webp", gif: ".gif" };
  const ext = extMap[match[1]] || ".jpg";
  return { buffer: Buffer.from(match[2], "base64"), ext };
}
