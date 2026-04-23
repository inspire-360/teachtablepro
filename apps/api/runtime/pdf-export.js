const fs = require("node:fs/promises");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 32;
const HEADER_HEIGHT = 28;
const PERIOD_COLUMN = 64;
const GRID_COLUMNS = 6;

async function loadFont(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  const candidates = [
    process.env.THAI_FONT_PATH,
    "assets/fonts/THSarabunNew.ttf",
    "C:/Windows/Fonts/THSarabun.ttf",
    "C:/Windows/Fonts/tahoma.ttf",
    "C:/Windows/Fonts/LeelawUI.ttf",
  ].filter(Boolean);

  for (const fontPath of candidates) {
    try {
      const fontBytes = await fs.readFile(fontPath);
      return pdfDoc.embedFont(fontBytes, { subset: true });
    } catch {
      // Try the next available font.
    }
  }

  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

function decodeImageSource(imageSource) {
  const value = String(imageSource || "").trim();
  if (!value) {
    return null;
  }

  const dataUrlMatch = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase(),
      bytes: Buffer.from(dataUrlMatch[2], "base64"),
    };
  }

  return {
    mimeType: value.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
    path: path.isAbsolute(value) ? value : path.resolve(process.cwd(), value),
  };
}

async function loadEmbeddedImage(pdfDoc, imageSource) {
  const resolved = decodeImageSource(imageSource);
  if (!resolved) {
    return null;
  }

  try {
    const bytes = resolved.bytes || await fs.readFile(resolved.path);
    if (resolved.mimeType.includes("png")) {
      return pdfDoc.embedPng(bytes);
    }
    return pdfDoc.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawFittedImage(page, image, frame, options = {}) {
  if (!image) {
    return;
  }

  const scale = Math.min(frame.width / image.width, frame.height / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = frame.x + (frame.width - width) / 2;
  const y = frame.y + (frame.height - height) / 2;

  page.drawImage(image, {
    x,
    y,
    width,
    height,
    opacity: options.opacity ?? 1,
  });
}

function wrapText(font, text, size, maxWidth, maxLines = 6) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const trimmed = lines.slice(0, maxLines);
  trimmed[maxLines - 1] = `${trimmed[maxLines - 1].slice(0, Math.max(0, trimmed[maxLines - 1].length - 3))}...`;
  return trimmed;
}

function drawCellText(page, font, text, x, y, width, height, size = 10.5, color = rgb(0.11, 0.16, 0.23)) {
  const paragraphs = String(text).split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...wrapText(font, paragraph, size, width - 8, 6));
  }

  const maxRenderableLines = Math.max(1, Math.floor((height - 8) / (size + 2)));
  const renderLines = lines.slice(0, maxRenderableLines);
  let cursorY = y + height - size - 6;
  for (const line of renderLines) {
    page.drawText(line, {
      x: x + 4,
      y: cursorY,
      size,
      font,
      color,
    });
    cursorY -= size + 2;
  }
}

function normalizeReports(payload = {}) {
  if (Array.isArray(payload.reports) && payload.reports.length > 0) {
    return payload.reports;
  }

  return [
    {
      report_title: payload.report_title || "ตารางสอน",
      education_level: payload.education_level || "-",
      section_name: payload.section_name || "-",
      matrix: payload.matrix || [],
    },
  ];
}

function drawReportPage(page, font, context, report, logoImage, signatoryImages) {
  const headerColor = rgb(0.07, 0.24, 0.48);
  const lineColor = rgb(0.8, 0.84, 0.9);
  const subtleFill = rgb(0.94, 0.96, 0.99);
  const dayLabels = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์"];
  const tableTop = PAGE_HEIGHT - 116;
  const tableWidth = PAGE_WIDTH - MARGIN * 2;
  const cellWidth = (tableWidth - PERIOD_COLUMN) / GRID_COLUMNS;
  const renderMatrix = Array.isArray(report.matrix) && report.matrix.length
    ? report.matrix
    : Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => "-"));
  const rowHeight = 58;
  const periodLabels = ["คาบ 1", "คาบ 2", "คาบ 3", "คาบ 4", "คาบ 5", "คาบ 6"];

  page.drawText(context.school_name || "TeachTable", {
    x: MARGIN,
    y: PAGE_HEIGHT - 38,
    size: 22,
    font,
    color: headerColor,
  });

  page.drawText(report.report_title || "ตารางสอน", {
    x: MARGIN,
    y: PAGE_HEIGHT - 62,
    size: 14,
    font,
    color: rgb(0.22, 0.3, 0.4),
  });

  page.drawText(
    `ระดับ ${report.education_level || "-"} | รายการ ${report.section_name || "-"} | ภาคเรียน ${context.term || "-"} | ปีการศึกษา ${context.academic_year || "-"}`,
    {
      x: MARGIN,
      y: PAGE_HEIGHT - 82,
      size: 11,
      font,
      color: rgb(0.35, 0.43, 0.54),
    },
  );

  if (logoImage) {
    drawFittedImage(page, logoImage, {
      x: PAGE_WIDTH - MARGIN - 92,
      y: PAGE_HEIGHT - 92,
      width: 84,
      height: 58,
    });
  }

  page.drawRectangle({
    x: MARGIN,
    y: tableTop - HEADER_HEIGHT,
    width: tableWidth,
    height: HEADER_HEIGHT,
    color: headerColor,
  });

  page.drawText("วัน", {
    x: MARGIN + 18,
    y: tableTop - 19,
    size: 11,
    font,
    color: rgb(1, 1, 1),
  });

  periodLabels.forEach((label, index) => {
    page.drawText(label, {
      x: MARGIN + PERIOD_COLUMN + cellWidth * index + 12,
      y: tableTop - 19,
      size: 11,
      font,
      color: rgb(1, 1, 1),
    });
  });

  renderMatrix.forEach((row, rowIndex) => {
    const y = tableTop - HEADER_HEIGHT - rowHeight * (rowIndex + 1);

    page.drawRectangle({
      x: MARGIN,
      y,
      width: PERIOD_COLUMN,
      height: rowHeight,
      color: subtleFill,
      borderColor: lineColor,
      borderWidth: 1,
    });
    page.drawText(dayLabels[rowIndex] || `วัน ${rowIndex + 1}`, {
      x: MARGIN + 12,
      y: y + rowHeight / 2 - 6,
      size: 11,
      font,
      color: rgb(0.16, 0.22, 0.32),
    });

    row.forEach((cell, columnIndex) => {
      const x = MARGIN + PERIOD_COLUMN + cellWidth * columnIndex;
      page.drawRectangle({
        x,
        y,
        width: cellWidth,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : rgb(0.97, 0.98, 1),
        borderColor: lineColor,
        borderWidth: 1,
      });
      drawCellText(page, font, cell, x, y, cellWidth, rowHeight);
    });
  });

  page.drawText(`วันที่พิมพ์เอกสาร: ${context.printed_at || "-"}`, {
    x: MARGIN,
    y: 78,
    size: 11,
    font,
    color: rgb(0.22, 0.3, 0.4),
  });

  const signatories = context.signatories || [];
  const signatureWidth = (tableWidth - 20) / 3;
  signatories.slice(0, 3).forEach((signatory, index) => {
    const x = MARGIN + index * (signatureWidth + 10);
    drawFittedImage(page, signatoryImages[index], {
      x: x + 8,
      y: 56,
      width: signatureWidth - 16,
      height: 34,
    });
    page.drawLine({
      start: { x: x + 12, y: 52 },
      end: { x: x + signatureWidth - 12, y: 52 },
      thickness: 1,
      color: rgb(0.35, 0.43, 0.54),
    });
    page.drawText(signatory.name || "........................................", {
      x: x + 14,
      y: 34,
      size: 10,
      font,
      color: rgb(0.22, 0.3, 0.4),
    });
    page.drawText(signatory.title || "", {
      x: x + 14,
      y: 18,
      size: 10,
      font,
      color: rgb(0.22, 0.3, 0.4),
    });
  });
}

async function generateTimetablePdfBuffer(payload) {
  const pdfDoc = await PDFDocument.create();
  const font = await loadFont(pdfDoc);
  const logoImage = await loadEmbeddedImage(pdfDoc, payload.logo_path);
  const signatoryImages = await Promise.all((payload.signatories || []).map((item) => loadEmbeddedImage(pdfDoc, item.signatureImage)));
  const reports = normalizeReports(payload);

  for (const report of reports) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawReportPage(page, font, payload, report, logoImage, signatoryImages);
  }

  return pdfDoc.save();
}

module.exports = {
  generateTimetablePdfBuffer,
};
