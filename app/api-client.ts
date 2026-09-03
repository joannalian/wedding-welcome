import type { AppState, EventSummary } from './model';
import { appsScriptUrl } from './public-config';

const endpoint = appsScriptUrl;

type ApiResponse<T> = { ok: boolean; data?: T; error?: string };

export function hasCloudBackend() { return Boolean(endpoint); }

export async function callCloud<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!endpoint) throw new Error('尚未連接 Google 雲端硬碟');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json() as ApiResponse<T>;
  if (!result.ok) throw new Error(result.error || '雲端同步失敗');
  return result.data as T;
}

export async function loadEvent(eventCode: string, token: string) {
  return callCloud<AppState>('loadEvent', { eventCode, token });
}

export async function saveEvent(state: AppState, token: string) {
  return callCloud<{ revision: number }>('saveEvent', { eventCode: state.settings.eventCode, token, state });
}

export async function listAdminEvents(googleIdToken: string) {
  return callCloud<{ adminEmail: string; events: EventSummary[] }>('listEvents', { googleIdToken });
}

export async function loginAdminEvent(eventCode: string, googleIdToken: string) {
  return callCloud<{ token: string; state: AppState }>('login', { eventCode, role: 'admin', googleIdToken });
}

export async function createAdminEvent(eventName: string, googleIdToken: string) {
  return callCloud<{ state: AppState; folderUrl: string; spreadsheetUrl: string }>('createEvent', { eventName, googleIdToken });
}

export async function getEventInfo(eventCode: string) {
  return callCloud<{ eventName: string; eventCode: string; receptionOpen: boolean }>('eventInfo', { eventCode });
}

export async function updateCloudGuest(eventCode: string, guest: AppState['guests'][number], token: string) {
  return callCloud<{ state: AppState }>('updateGuest', { eventCode, guest, token });
}

export async function applyCloudImport(eventCode: string, guests: AppState['guests'], sourceName: string, token: string) {
  return callCloud<{ state: AppState; summary: { added: number; updated: number; removed: number; retained: number } }>('applyImport', { eventCode, guests, sourceName, token });
}

export async function updateCloudSettings(eventCode: string, patch: Record<string, unknown>, token: string) {
  return callCloud<{ state: AppState }>('updateSettings', { eventCode, patch, token });
}
