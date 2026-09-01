import type { AppState } from './model';
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
