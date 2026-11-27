// Made-up workbooks for the tests: a zip writer and a one-sheet workbook made
// from rows of text. Nothing here is used by the site or the daily run.
import { deflateRawSync } from "node:zlib";

// A zip archive of the given files. `stored` names are kept without compression.
export function zip(files, { stored = [], comment = "" } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8");
    const keep = stored.includes(name);
    const packed = keep ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(keep ? 0 : 8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(keep ? 0 : 8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const commentBuf = Buffer.from(comment, "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBuf.length, 20);
  return Buffer.concat([...locals, directory, end, commentBuf]);
}

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const column = (i) => {
  let out = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};

// A workbook with one sheet holding the given rows, every cell as text.
export function workbookOf(rows, sheetName = "Made-up sheet") {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${rows
  .map(
    (row, r) =>
      `<row r="${r + 1}">${row
        .map((cell, c) => (cell === "" ? "" : `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`))
        .join("")}</row>`,
  )
  .join("\n")}
</sheetData></worksheet>`;
  return zip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="${xml(sheetName)}" sheetId="1"/></sheets></workbook>`,
    "xl/worksheets/sheet1.xml": sheet,
  });
}
