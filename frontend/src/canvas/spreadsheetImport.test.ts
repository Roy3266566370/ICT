import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { importTableFromBuffer, parseXlsxTable } from './spreadsheetImport.ts';
import { parseBusinessTable, splitTableLine } from './officeBlocks.ts';

function zip(files: Record<string, string>): ArrayBuffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  const names = Object.keys(files);
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(files[name] ?? '', 'utf8');
    const compressed = deflateRawSync(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    local.push(localHeader, nameBytes, compressed);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...local, ...central, eocd]);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

function sampleXlsx(): ArrayBuffer {
  return zip({
    'xl/sharedStrings.xml': [
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<si><t>月份</t></si><si><t>营收</t></si><si><t>1月</t></si><si><t>2月</t></si>',
      '</sst>',
    ].join(''),
    'xl/worksheets/sheet1.xml': [
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>128</v></c></row>',
      '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>136</v></c></row>',
      '</sheetData></worksheet>',
    ].join(''),
  });
}

test('CSV/TSV 拆分兼容双引号、千分位和中文分隔符', () => {
  assert.deepEqual(splitTableLine('"1月,上旬",128'), ['1月,上旬', '128']);
  assert.deepEqual(splitTableLine('"他说""好""",1,200'), ['他说"好"', '1', '200']);
  assert.deepEqual(splitTableLine('月份\t营收'), ['月份', '营收']);
  const parsed = parseBusinessTable('月份,营收\n"1月,上旬","1,200"\n2月,136');
  assert.deepEqual(parsed.labels, ['1月,上旬', '2月']);
  assert.deepEqual(parsed.values, [1200, 136]);
});

test('.xlsx 首个工作表可解析为两列文本并进入业务表格', async () => {
  const result = await parseXlsxTable(sampleXlsx());
  assert.equal(result.rows, 3);
  assert.equal(result.text, '月份\t营收\n1月\t128\n2月\t136');
  const parsed = parseBusinessTable(result.text);
  assert.deepEqual(parsed.labels, ['1月', '2月']);
  assert.deepEqual(parsed.values, [128, 136]);
});

test('文件导入按扩展名分流，UTF-8 BOM 与旧版 .xls 有明确行为', async () => {
  const xlsx = await importTableFromBuffer(sampleXlsx(), 'report.xlsx');
  assert.equal(xlsx.format, 'xlsx');
  assert.equal(xlsx.rows, 3);
  const csvBuffer = Buffer.from('\uFEFF月份,营收\n1月,128', 'utf8');
  const csv = await importTableFromBuffer(csvBuffer.buffer.slice(csvBuffer.byteOffset, csvBuffer.byteOffset + csvBuffer.byteLength), 'report.csv');
  assert.equal(csv.format, 'csv');
  assert.equal(csv.text.startsWith('\uFEFF'), false);
  await assert.rejects(importTableFromBuffer(new ArrayBuffer(4), 'old.xls'), /旧版 \.xls/);
  await assert.rejects(importTableFromBuffer(new ArrayBuffer(4), 'unknown.pdf'), /仅支持/);
});
