/** 本地表格导入：CSV/TSV 文本与 .xlsx（ZIP + XML）首个工作表，不发送文件。 */

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 60;

export interface ImportedTable {
  name: string;
  format: 'csv' | 'tsv' | 'txt' | 'xlsx';
  text: string;
  rows: number;
}

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  localOffset: number;
}

function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\uFFFD')) return normalizeText(utf8);
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    if (!gbk.includes('\uFFFD')) return normalizeText(gbk);
  } catch {
    /* TextDecoder('gbk') is optional in some runtimes. */
  }
  return normalizeText(utf8);
}

function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function findEndOfCentralDirectory(view: DataView): number {
  const start = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('Excel 文件不是有效的 ZIP 容器');
}

function readZipEntries(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder('utf-8');
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Excel 文件目录损坏');
    }
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 格式的 Excel，请另存为普通 .xlsx 或 CSV');
    }
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.set(name, { name, compression, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压 .xlsx，请改用 CSV 或升级浏览器');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

async function readZipText(buffer: ArrayBuffer, entry: ZipEntry | undefined): Promise<string> {
  if (!entry) return '';
  const view = new DataView(buffer);
  if (entry.localOffset + 30 > view.byteLength || view.getUint32(entry.localOffset, true) !== 0x04034b50) {
    throw new Error('Excel 文件条目损坏');
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = buffer.slice(start, start + entry.compressedSize);
  if (entry.compression === 0) return decodeText(compressed);
  if (entry.compression === 8) return decodeText(await inflateRaw(compressed));
  throw new Error('Excel 使用了不支持的压缩算法');
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(text: string): string {
  return decodeXml(text.replace(/<[^>]*>/g, ''));
}

function attribute(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match?.[1] ?? '';
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map((match) => {
    const item = match[0] ?? '';
    return Array.from(item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((text) => decodeXml(text[1] ?? ''))
      .join('');
  });
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
}

function cellValue(attrs: string, body: string, shared: string[]): string {
  const type = attribute(attrs, 't');
  if (type === 'inlineStr') {
    return Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((item) => decodeXml(item[1] ?? '')).join('');
  }
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return '';
  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? (shared[index] ?? '') : '';
  }
  if (type === 'str') return decodeXml(raw);
  if (type === 'b') return raw === '1' ? '1' : '0';
  if (type === 'e') return '';
  return decodeXml(raw);
}

function parseSheetRows(xml: string, shared: string[]): { rows: number[]; a: Map<number, string>; b: Map<number, string>; hasB: boolean } {
  const indexRows: number[] = [];
  const a = new Map<number, string>();
  const b = new Map<number, string>();
  let hasB = false;
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const body = rowMatch[1] ?? '';
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const reference = attribute(attrs, 'r');
      const rowIndex = Number(reference.match(/^[A-Za-z]+(\d+)/)?.[1] ?? 0);
      if (!rowIndex) continue;
      const value = cellValue(attrs, cellMatch[2] ?? '', shared);
      if (!indexRows.includes(rowIndex)) indexRows.push(rowIndex);
      const column = columnIndex(reference);
      if (column === 0) a.set(rowIndex, value);
      else if (column === 1) {
        b.set(rowIndex, value);
        if (value.trim()) hasB = true;
      }
    }
  }
  return { rows: indexRows.sort((left, right) => left - right), a, b, hasB };
}

function cleanCell(value: string | undefined): string {
  return (value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export async function parseXlsxTable(buffer: ArrayBuffer): Promise<{ text: string; rows: number }> {
  const entries = readZipEntries(buffer);
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(await readZipText(buffer, sharedEntry)) : [];
  const sheetEntry = entries.get('xl/worksheets/sheet1.xml')
    ?? Array.from(entries.values()).find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name));
  if (!sheetEntry) throw new Error('Excel 文件中没有找到工作表');
  const sheet = await readZipText(buffer, sheetEntry);
  const parsed = parseSheetRows(sheet, shared);
  const lines: string[] = [];
  for (const row of parsed.rows) {
    const first = cleanCell(parsed.a.get(row));
    const second = cleanCell(parsed.b.get(row));
    if (!first && !second) continue;
    if (parsed.hasB) {
      if (!second) continue;
      lines.push(`${first || `#${lines.length + 1}`}\t${second}`);
    } else {
      lines.push(first);
    }
    if (lines.length >= MAX_ROWS) break;
  }
  if (!lines.length) throw new Error('Excel 首个工作表没有可导入的两列数据');
  return { text: lines.join('\n'), rows: lines.length };
}

export async function importTableFromBuffer(buffer: ArrayBuffer, name: string): Promise<ImportedTable> {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('文件超过 8 MB，请先裁剪数据');
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'xls') throw new Error('暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx 或 CSV');
  if (extension === 'xlsx') {
    const { text, rows } = await parseXlsxTable(buffer);
    return { name, format: 'xlsx', text, rows };
  }
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const text = decodeText(buffer);
    const rows = text.split('\n').filter((line) => line.trim()).length;
    if (!rows) throw new Error('文件没有可导入的数据行');
    return { name, format: extension as 'csv' | 'tsv' | 'txt', text, rows: Math.min(rows, MAX_ROWS) };
  }
  throw new Error('仅支持 .xlsx、.csv、.tsv 或 .txt 表格文件');
}

export async function readTableFile(file: File): Promise<ImportedTable> {
  return importTableFromBuffer(await file.arrayBuffer(), file.name);
}
