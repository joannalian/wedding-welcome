import type { AppState, GuestGroup } from './model';

const now = new Date().toISOString();

function guest(input: Partial<GuestGroup> & Pick<GuestGroup, 'id' | 'name' | 'category' | 'expected' | 'tables'>): GuestGroup {
  const item = {
    phone: '', actual: 0, vegetarianExpected: 0, vegetarianActual: 0,
    childChairExpected: 0, childChairActual: 0, cakeType: '不需喜餅', cakePlanned: 0,
    cakeDelivered: 0, cakeOwed: 0, cakeChinesePlanned: 0, cakeChineseDelivered: 0,
    cakeChineseOwed: 0, cakeWesternPlanned: 0, cakeWesternDelivered: 0, cakeWesternOwed: 0,
    giftReceived: false, bagNamed: false,
    giftName: '', giftAmount: null, note: '', completed: false,
    completedAt: null, completedBy: '', updatedAt: now, ...input,
  } as GuestGroup;
  if (!item.cakeChinesePlanned && item.cakeType.includes('中式')) item.cakeChinesePlanned = item.cakePlanned;
  if (!item.cakeWesternPlanned && item.cakeType.includes('西式')) item.cakeWesternPlanned = item.cakePlanned;
  return item;
}

export const initialState: AppState = {
  settings: {
    eventName: '好日子示範婚宴', eventCode: 'DEMO-2026', receptionOpen: true,
    cakeStock: 38, cakeStockChinese: 12, cakeStockWestern: 26,
    receptionPin: '0824', plannerPin: '5200',
    revision: 1, importSource: '虛構示範名單.xlsx', importedAt: '2026-08-24T08:00:00.000Z',
    operator: '示範管理員', role: 'admin',
  },
  guests: [
    guest({ id:'g01', name:'示範新人與主婚人', category:'主桌', phone:'0000000001', expected:4, tables:[{table:'第 1 桌',planned:4}] }),
    guest({ id:'g02', name:'示範賓客甲（王小明一家）', category:'新娘親友', phone:'0000000002', expected:3, childChairExpected:1, cakeType:'西式喜餅', cakePlanned:1, tables:[{table:'第 2 桌',planned:3}] }),
    guest({ id:'g03', name:'示範賓客乙（陳小美一家）', category:'新娘親友', phone:'0000000003', expected:3, vegetarianExpected:1, cakeType:'中式喜餅', cakePlanned:1, tables:[{table:'第 3 桌',planned:3}] }),
    guest({ id:'g04', name:'示範賓客丙（林大華一家）', category:'新郎親友', phone:'0000000004', expected:2, cakeType:'中式喜餅', cakePlanned:1, tables:[{table:'第 4 桌',planned:2}] }),
    guest({ id:'g05', name:'示範大學同學群', category:'新郎同學', phone:'0000000005', expected:4, childChairExpected:1, cakeType:'西式喜餅', cakePlanned:1, tables:[{table:'第 5 桌',planned:4}] }),
    guest({ id:'g06', name:'示範公司同事群', category:'新娘同事', phone:'0000000006', expected:4, vegetarianExpected:1, childChairExpected:1, cakeType:'西式喜餅', cakePlanned:1, tables:[{table:'第 6 桌',planned:2},{table:'第 7 桌',planned:2}] }),
    guest({ id:'g07', name:'示範高中同學群', category:'新娘同學', phone:'0000000007', expected:3, childChairExpected:1, tables:[{table:'第 8 桌',planned:3}] }),
    guest({ id:'g08', name:'示範賓客丁（吳小華與伴侶）', category:'新郎親友', phone:'0000000008', expected:2, cakeType:'西式喜餅', cakePlanned:1, tables:[{table:'第 9 桌',planned:2}] }),
    guest({ id:'g09', name:'示範賓客戊（李小美）', category:'新娘親友', phone:'0000000009', expected:1, cakeType:'西式喜餅', cakePlanned:1, tables:[{table:'第 10 桌',planned:1}] }),
    guest({ id:'g10', name:'示範賓客己（趙小明一家）', category:'新郎親友', phone:'0000000010', expected:2, vegetarianExpected:1, cakeType:'中式喜餅', cakePlanned:1, tables:[{table:'第 10 桌',planned:2}] }),
  ],
};
