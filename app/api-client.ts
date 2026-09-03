import type { AppState, EventSummary } from './model';
import { appsScriptUrl } from './public-config';

const endpoint = appsScriptUrl;

type ApiResponse<T> = { ok: boolean; data?: T; error?: string };
type CallOptions = { retries?: number; timeoutMs?: number };

const TEMPORARY_GOOGLE_ERROR = 'Google 服務暫時無法回應，請稍後再試。你的婚宴資料不會因此消失。';

class RetryableCloudError extends Error {}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function hasCloudBackend() { return Boolean(endpoint); }

export async function callCloud<T>(action: string, payload: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
  if (!endpoint) throw new Error('尚未連接 Google 雲端硬碟');
  const retries = Math.max(0, options.retries ?? 0);
  const timeoutMs = options.timeoutMs ?? 15000;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
        signal: controller.signal,
      });
      const body = await response.text();
      let result: ApiResponse<T>;
      try {
        result = JSON.parse(body) as ApiResponse<T>;
      } catch {
        throw new RetryableCloudError(TEMPORARY_GOOGLE_ERROR);
      }
      if (!response.ok) throw new RetryableCloudError(TEMPORARY_GOOGLE_ERROR);
      if (!result.ok) throw new Error(result.error || '雲端同步失敗');
      return result.data as T;
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      const retryable = timedOut || error instanceof RetryableCloudError || error instanceof TypeError;
      if (attempt < retries && retryable) {
        await wait(700 * (attempt + 1));
        continue;
      }
      if (timedOut) throw new Error('Google 連線逾時，請確認網路後再試。你的婚宴資料不會因此消失。');
      if (error instanceof TypeError) throw new Error(TEMPORARY_GOOGLE_ERROR);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error(TEMPORARY_GOOGLE_ERROR);
}

export async function loadEvent(eventCode: string, token: string) {
  return callCloud<AppState>('loadEvent', { eventCode, token }, { retries: 1, timeoutMs: 12000 });
}

export async function saveEvent(state: AppState, token: string) {
  return callCloud<{ revision: number }>('saveEvent', { eventCode: state.settings.eventCode, token, state });
}

export async function listAdminEvents(googleIdToken: string) {
  return callCloud<{ adminEmail: string; events: EventSummary[] }>('listEvents', { googleIdToken }, { retries: 1, timeoutMs: 15000 });
}

export async function loginAdminEvent(eventCode: string, googleIdToken: string) {
  return callCloud<{ token: string; state: AppState }>('login', { eventCode, role: 'admin', googleIdToken }, { retries: 1, timeoutMs: 15000 });
}

export async function createAdminEvent(eventName: string, googleIdToken: string) {
  return callCloud<{ state: AppState; folderUrl: string; spreadsheetUrl: string }>('createEvent', { eventName, googleIdToken });
}

export async function getEventInfo(eventCode: string) {
  return callCloud<{ eventName: string; eventCode: string; receptionOpen: boolean }>('eventInfo', { eventCode }, { retries: 1, timeoutMs: 12000 });
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
