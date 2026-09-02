export type Role = 'admin' | 'reception' | 'planner';
export type GuestStatus = 'waiting' | 'partial' | 'arrived' | 'over';
export type MainTab = 'reception' | 'completed' | 'dashboard' | 'admin';

export type TableAllocation = { table: string; planned: number };

export type GuestGroup = {
  id: string;
  name: string;
  category: string;
  phone: string;
  expected: number;
  actual: number;
  vegetarianExpected: number;
  vegetarianActual: number;
  childChairExpected: number;
  childChairActual: number;
  tables: TableAllocation[];
  cakeType: '中式喜餅' | '西式喜餅' | '中式與西式喜餅' | '不需喜餅';
  cakePlanned: number;
  cakeDelivered: number;
  cakeOwed: number;
  giftReceived: boolean;
  bagNamed: boolean;
  giftName: string;
  giftAmount: number | null;
  note: string;
  completed: boolean;
  completedAt: string | null;
  completedBy: string;
  updatedAt: string;
};

export type EventSettings = {
  eventName: string;
  eventCode: string;
  receptionOpen: boolean;
  cakeStock: number;
  receptionPin: string;
  plannerPin: string;
  plannerEnabled: boolean;
  operator: string;
  role: Role;
};

export type AppState = {
  settings: EventSettings;
  guests: GuestGroup[];
};

export type EventSummary = {
  eventName: string;
  eventCode: string;
  receptionOpen: boolean;
  guestCount: number;
  completedCount: number;
  updatedAt: string | null;
};

export function deriveStatus(guest: GuestGroup): GuestStatus {
  if (guest.actual <= 0) return 'waiting';
  if (guest.actual < guest.expected) return 'partial';
  if (guest.actual === guest.expected) return 'arrived';
  return 'over';
}

export function statusText(status: GuestStatus) {
  return { waiting: '尚未抵達', partial: '部分抵達', arrived: '已到齊', over: '超額抵達' }[status];
}

export function formatTables(guest: GuestGroup) {
  return guest.tables.map((item) => item.table).join('、') || '待安排';
}

export function allocateActual(guest: GuestGroup) {
  const items = guest.tables;
  if (!items.length) return [];
  const total = items.reduce((sum, item) => sum + item.planned, 0) || guest.expected || 1;
  const raw = items.map((item) => ({ ...item, raw: (guest.actual * item.planned) / total }));
  const result = raw.map((item) => ({ table: item.table, planned: item.planned, actual: Math.floor(item.raw), remainder: item.raw % 1 }));
  let rest = Math.max(0, guest.actual - result.reduce((sum, item) => sum + item.actual, 0));
  [...result].sort((a, b) => b.remainder - a.remainder).forEach((item) => {
    if (rest > 0) { item.actual += 1; rest -= 1; }
  });
  return result.map((item) => ({ table: item.table, planned: item.planned, actual: item.actual }));
}

export function maskPhone(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `末三碼 ${digits.slice(-3).padStart(3, '•')}` : '未留電話';
}

export function makeId(name: string, category: string) {
  let hash = 2166136261;
  for (const char of `${category}|${name}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `guest-${(hash >>> 0).toString(36)}`;
}
