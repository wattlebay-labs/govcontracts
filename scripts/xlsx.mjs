// A small reader for .xlsx workbooks, using only what Node ships with.
// A workbook is a zip archive of XML files. This reads the cell text of each
// sheet: enough to take a table out of a published spreadsheet. It does not
// read formats, formulas' workings, dates as dates, or anything else.
//
//   readWorkbook(buffer) -> [ { name, rows: [ [cell, cell, ...], ... ] } ]
//
// Every cell comes back as a string ("" where a cell is empty or missing).
// A number is given as the file holds it, so 80111600 stays "80111600".
import { inflateRawSync } from "node:zlib";

const SIG_END = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// The files in a zip archive, by name. Sizes and positions are taken from the
// central directory at the end of the archive, which is always complete.
export function unzip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let end = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive: no end record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error("zip64 archives are not supported");
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== SIG_CENTRAL) {
      throw new Error("zip archive is damaged: bad directory entry");
    }
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`zip entry is encrypted: ${name}`);
    if (name.endsWith("/")) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL) {
      throw new Error(`zip archive is damaged: no file header for ${name}`);
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + packed > buf.length) throw new Error(`zip archive is cut short at ${name}`);
    const raw = buf.subarray(start, start + packed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip entry uses a method that is not supported (${method}): ${name}`);
    if (data.length !== size) throw new Error(`zip entry has the wrong length: ${name}`);
    files.set(name, data);
  }
  return files;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

// Excel writes a control character in text as _x000D_ and the like.
const unescapeExcel = (text) =>
  text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const attr = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[1] ?? m[2]) : null;
};

// The text of a string item: every <t> in it, in order, leaving out the
// phonetic guides (<rPh>) that some workbooks carry beside the text.
function textOf(xml) {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of plain.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ?? "";
  return unescapeExcel(decodeXml(out));
}

function sharedStrings(xml) {
  const list = [];
  if (!xml) return list;
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) list.push(textOf(m[1] ?? ""));
  return list;
}

// "A" -> 0, "Z" -> 25, "AA" -> 26.
export function columnIndex(ref) {
  const letters = /^[A-Za-z]+/.exec(ref || "")?.[0];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const number = parseInt(attr(rowMatch[1], "r") || "", 10);
    const index = Number.isFinite(number) && number > 0 ? number - 1 : rows.length;
    const cells = [];
    let next = 0;
    for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const fromRef = columnIndex(attr(cell[1], "r"));
      const col = fromRef >= 0 ? fromRef : next;
      next = col + 1;
      const type = attr(cell[1], "t");
      const body = cell[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "inlineStr") {
        text = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      } else if (type === "s") {
        const at = parseInt(v ?? "", 10);
        if (!Number.isInteger(at) || at < 0 || at >= strings.length) {
          throw new Error(`workbook is damaged: no shared string ${v}`);
        }
        text = strings[at];
      } else if (v !== undefined) {
        text = type === "str" ? unescapeExcel(decodeXml(v)) : decodeXml(v);
      }
      while (cells.length < col) cells.push("");
      cells[col] = text;
    }
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  return rows;
}

const resolvePath = (base, target) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
};

export function readWorkbook(buffer) {
  const files = unzip(buffer);
  const text = (name) => (files.has(name) ? files.get(name).toString("utf8") : null);
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("not a workbook: xl/workbook.xml is missing");
  const targets = new Map();
  for (const m of (text("xl/_rels/workbook.xml.rels") || "").matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) targets.set(id, resolvePath("xl/workbook.xml", target));
  }
  const strings = sharedStrings(text("xl/sharedStrings.xml"));
  const sheets = [];
  let position = 0;
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    position += 1;
    const name = attr(m[1], "name") ?? `Sheet${position}`;
    const path = targets.get(attr(m[1], "r:id")) ?? `xl/worksheets/sheet${position}.xml`;
    const xml = text(path);
    if (xml === null) throw new Error(`workbook is damaged: sheet "${name}" has no file (${path})`);
    sheets.push({ name, rows: sheetRows(xml, strings) });
  }
  if (!sheets.length) throw new Error("workbook has no sheets");
  return sheets;
}
