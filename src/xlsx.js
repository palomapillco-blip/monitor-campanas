// Escritor mínimo de Excel (.xlsx) sin dependencias: un .xlsx es un zip con unos XML adentro.
//
//   xlsx([{ name, cols: [{ h, w, type: 'date' | 'num' | 'text' | 'link' }], rows: [[...]] }]) → Buffer
//
// 'date' recibe 'AAAA-MM-DD', 'num' un número o '' (celda vacía), 'link' una URL (se muestra "ver").
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const data = Buffer.from(f.data);
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    // Campos comunes de las cabeceras local y central: versión 2.0, nombres UTF-8, deflate, fecha 1980-01-01.
    const common = (b, at) => {
      b.writeUInt16LE(20, at);
      b.writeUInt16LE(0x0800, at + 2);
      b.writeUInt16LE(8, at + 4);
      b.writeUInt16LE(0, at + 6);
      b.writeUInt16LE(0x21, at + 8);
      b.writeUInt32LE(crc, at + 10);
      b.writeUInt32LE(comp.length, at + 14);
      b.writeUInt32LE(data.length, at + 18);
      b.writeUInt16LE(name.length, at + 22);
    };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    common(local, 4);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    common(entry, 6);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, comp);
    central.push(entry, name);
    offset += local.length + name.length + comp.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// Quita caracteres de control que el XML no admite (el OCR a veces los trae).
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const excelDate = (iso) => Date.UTC(...iso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86400000 + 25569;

// Estilos: 0 normal, 1 negrita (encabezados), 2 fecha AAAA-MM-DD.
const STYLES = `${XML}<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cell(ref, type, v) {
  if (v === '' || v === null || v === undefined) return '';
  if (type === 'date') return `<c r="${ref}" s="2"><v>${excelDate(v)}</v></c>`;
  if (type === 'num') return `<c r="${ref}"><v>${Number(v)}</v></c>`;
  if (type === 'link') return `<c r="${ref}" t="str"><f>HYPERLINK("${esc(v)}","ver")</f><v>ver</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml({ cols, rows }) {
  const head = `<row r="1">${cols.map((c, j) => `<c r="${colName(j)}1" t="inlineStr" s="1"><is><t>${esc(c.h)}</t></is></c>`).join('')}</row>`;
  const body = rows.map((r, i) => `<row r="${i + 2}">${cols.map((c, j) => cell(`${colName(j)}${i + 2}`, c.type, r[j])).join('')}</row>`).join('');
  const range = `A1:${colName(cols.length - 1)}${rows.length + 1}`;
  return `${XML}<worksheet xmlns="${NS}">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols.map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${head}${body}</sheetData>
<autoFilter ref="${range}"/>
</worksheet>`;
}

export function xlsx(sheets) {
  const n = sheets.length;
  const ids = sheets.map((_, i) => i + 1);
  const filters = sheets.map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$1:$${colName(s.cols.length - 1)}$${s.rows.length + 1}</definedName>`);
  return zip([
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ids.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${filters.join('')}</definedNames></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ids.map((i) => `<Relationship Id="rId${i}" Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}
