import type { GuestGroup } from './model';
import { makeId } from './model';

type Row = Record<string, unknown>;

const truthy = (value: unknown) => /^(1|是|有|需要|素食|兒童椅|true|v)$/i.test(String(value ?? '').trim());
const num = (value: unknown) => {
  const matched = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  return matched ? Math.max(0, Number(matched[0])) : 0;
};
const text = (value: unknown) => String(value ?? '').trim();

export function rowsToGuests(rows: Row[]): GuestGroup[] {
  const grouped = new Map<string, Row[]>();
  rows.forEach((row) => {
    const name = text(row['原始群組'] || row['賓客'] || row['群組'] || row['姓名']);
    const category = text(row['分類']) || '未分類';
    if (!name || name === '姓名') return;
    const key = `${category}\u0000${name}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });

  const now = new Date().toISOString();
  return [...grouped.entries()].map(([key, members]) => {
    const [category, name] = key.split('\u0000');
    const tableCount = new Map<string, number>();
    members.forEach((row) => {
      const table = text(row['桌次']) || '待安排';
      tableCount.set(table, (tableCount.get(table) || 0) + 1);
    });
    const chinese = members.map((row) => num(row['中式喜餅數量（群組合計）'] || row['中式喜餅'])).find((value) => value > 0) || 0;
    const western = members.map((row) => num(row['西式喜餅數量（群組合計）'] || row['西式喜餅'])).find((value) => value > 0) || 0;
    const cakeType = chinese && western ? '中式與西式喜餅' : chinese ? '中式喜餅' : western ? '西式喜餅' : '不需喜餅';
    const phone = members.map((row) => text(row['電話'])).find(Boolean) || '';
    const expectedExplicit = members.map((row) => num(row['預計人數'] || row['應到人數'] || row['應到'])).find((value) => value > 0);
    return {
      id: makeId(name, category), name, category, phone,
      expected: expectedExplicit || members.length, actual: 0,
      vegetarianExpected: members.reduce((sum, row) => sum + (truthy(row['素食']) ? 1 : num(row['素食'])), 0),
      vegetarianActual: 0,
      childChairExpected: members.reduce((sum, row) => sum + (truthy(row['兒童座椅']) ? 1 : num(row['兒童座椅'])), 0),
      childChairActual: 0,
      tables: [...tableCount].map(([table, planned]) => ({ table, planned })),
      cakeType, cakePlanned: chinese + western, cakeDelivered: 0, cakeOwed: 0,
      giftReceived: false, bagNamed: false, giftName: '', giftAmount: null,
      note: members.map((row) => text(row['備註'])).find(Boolean) || '',
      completed: false, completedAt: null, completedBy: '', updatedAt: now,
    } as GuestGroup;
  });
}

export function matrixToGuests(matrix: unknown[][]) {
  const [headers = [], ...body] = matrix;
  return rowsToGuests(body.map((cells) => Object.fromEntries(headers.map((header, index) => [String(header ?? '').trim(), cells[index] ?? '']))));
}

export async function readExcelFile(file: File) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const source = await file.text();
    const lines = source.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
    const parseLine = (line: string) => {
      const values: string[] = [];
      let value = '', quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
        else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) { values.push(value); value = ''; }
        else value += char;
      }
      values.push(value);
      return values;
    };
    const [headers, ...body] = lines.map(parseLine);
    return rowsToGuests(body.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? '']))));
  }
  const readXlsxFile = (await import('read-excel-file/browser')).default;
  const sheets = await readXlsxFile(file);
  const matrix = Array.isArray(sheets) && sheets[0] && 'data' in sheets[0] ? sheets[0].data : sheets;
  return matrixToGuests(matrix as unknown[][]);
}

export function importSummary(current: GuestGroup[], incoming: GuestGroup[]) {
  const previous = new Map(current.map((guest) => [guest.id, guest]));
  const next = new Map(incoming.map((guest) => [guest.id, guest]));
  const added = incoming.filter((guest) => !previous.has(guest.id));
  const removed = current.filter((guest) => !next.has(guest.id));
  const changed = incoming.filter((guest) => {
    const old = previous.get(guest.id);
    return old && JSON.stringify({ ...old, actual:0, completed:false, completedAt:null, updatedAt:'' }) !== JSON.stringify({ ...guest, actual:0, completed:false, completedAt:null, updatedAt:'' });
  });
  return { added, removed, changed, unchanged: incoming.length - added.length - changed.length };
}
