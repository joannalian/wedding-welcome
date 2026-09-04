'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyCloudImport, callCloud, createAdminEvent, getCloudRevision, getEventInfo, hasCloudBackend, listAdminEvents, loadEvent, loginAdminEvent, updateCloudGuest, updateCloudSettings } from './api-client';
import { importSummary, parseGuestMatrix, readExcelFile, type ImportDiagnostics } from './import-tools';
import { allocateActual, deriveStatus, formatTables, maskPhone, statusText, type AppState, type EventSummary, type GuestGroup, type MainTab, type Role } from './model';
import { googleClientId } from './public-config';
import { initialState } from './sample-data';

const DEMO_STORAGE_KEY = 'hao-ri-zi-ying-bin-demo-v2';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const money = new Intl.NumberFormat('zh-TW');
const syncCakeTotals = (guest: GuestGroup): GuestGroup => {
  const cakePlanned = guest.cakeChinesePlanned + guest.cakeWesternPlanned;
  const cakeDelivered = guest.cakeChineseDelivered + guest.cakeWesternDelivered;
  const cakeOwed = guest.cakeChineseOwed + guest.cakeWesternOwed;
  const cakeType = guest.cakeChinesePlanned && guest.cakeWesternPlanned ? '中式與西式喜餅' : guest.cakeChinesePlanned ? '中式喜餅' : guest.cakeWesternPlanned ? '西式喜餅' : '不需喜餅';
  return { ...guest, cakePlanned, cakeDelivered, cakeOwed, cakeType };
};
type Screen = 'loading' | 'landing' | 'admin-signin' | 'admin-hub' | 'staff-gate' | 'demo' | 'app';
type SyncStatus = 'synced' | 'syncing' | 'error';
type AdminIdentity = { idToken: string; email: string; events: EventSummary[] };
type ImportedPayload = { guests: GuestGroup[]; diagnostics: ImportDiagnostics };

export default function Home() {
  const [state, setState] = useState<AppState>(() => clone(initialState));
  const [screen, setScreen] = useState<Screen>('loading');
  const [ready, setReady] = useState(false);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [adminIdentity, setAdminIdentity] = useState<AdminIdentity | null>(null);
  const [gateRole, setGateRole] = useState<'reception' | 'planner'>('reception');
  const [gateEventCode, setGateEventCode] = useState('');
  const [cloudMessage, setCloudMessage] = useState('');
  const [tab, setTab] = useState<MainTab>('reception');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<GuestGroup | null>(null);
  const [step, setStep] = useState(1);
  const [editingAttendance, setEditingAttendance] = useState(false);
  const [editingCake, setEditingCake] = useState(false);
  const [tableDetail, setTableDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [imported, setImported] = useState<ImportedPayload | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ tone:'success'|'error'|'info'; text:string } | null>(null);
  const [savingGuest, setSavingGuest] = useState(false);
  const [openingGuestId, setOpeningGuestId] = useState('');
  const [draftBaseUpdatedAt, setDraftBaseUpdatedAt] = useState('');
  const [conflictMessage, setConflictMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const remoteSnapshot = useRef('');
  const writeInFlight = useRef(false);
  const refreshInFlight = useRef(false);

  const markSynced = () => { setSyncStatus('synced'); setLastSyncedAt(Date.now()); };

  const refreshEvent = useCallback(async (showFeedback=false) => {
    if (screen !== 'app' || !hasCloudBackend() || !sessionToken || !state.settings.eventCode || writeInFlight.current || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (showFeedback) setSyncStatus('syncing');
    try {
      const heartbeat = await getCloudRevision(state.settings.eventCode, sessionToken);
      if (!heartbeat.receptionOpen && state.settings.role !== 'admin') {
        setState((current)=>({...current,settings:{...current.settings,receptionOpen:false,revision:heartbeat.revision}}));
        markSynced(); return;
      }
      if (heartbeat.revision !== state.settings.revision) {
        const remote = await loadEvent(state.settings.eventCode, sessionToken);
        remoteSnapshot.current = JSON.stringify(remote); setState(remote);
        if (draft) {
          const latest = remote.guests.find((guest)=>guest.id===draft.id);
          if (latest && latest.updatedAt !== draftBaseUpdatedAt) setConflictMessage(`這筆資料剛剛已由「${latest.completedBy||'其他接待人員'}」更新，請先載入最新資料。`);
        }
      }
      markSynced();
      if (showFeedback) setNotice('已取得最新資料');
    } catch (error) {
      setSyncStatus('error');
      if (showFeedback) setNotice(error instanceof Error ? error.message : '目前無法同步，請稍後重試');
    } finally { refreshInFlight.current = false; }
  }, [draft, draftBaseUpdatedAt, screen, sessionToken, state.settings.eventCode, state.settings.revision, state.settings.role]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'demo') {
      queueMicrotask(()=>{ try { const saved = localStorage.getItem(DEMO_STORAGE_KEY); if (saved) setState(JSON.parse(saved)); } catch { /* keep safe sample state */ } setScreen('demo'); setReady(true); }); return;
    }
    if (!hasCloudBackend()) { queueMicrotask(()=>{setScreen('landing');setReady(true);}); return; }
    const eventCode = params.get('event') || '';
    const directRole = params.get('role');
    const token = sessionStorage.getItem(`hao-ri-zi-token-${eventCode}`) || '';
    if (!eventCode || !token) {
      queueMicrotask(()=>{ if (eventCode && (directRole === 'reception' || directRole === 'planner')) { setGateEventCode(eventCode); setGateRole(directRole); setScreen('staff-gate'); } else setScreen('landing'); setReady(true); }); return;
    }
    loadEvent(eventCode, token).then((remote) => {
      remoteSnapshot.current = JSON.stringify(remote); setState(remote); setSessionToken(token); setScreen('app'); markSynced(); setReady(true);
    }).catch((error) => {
      setCloudMessage(error instanceof Error ? error.message : '請重新登入');
      if (eventCode && (directRole === 'reception' || directRole === 'planner')) { setGateEventCode(eventCode); setGateRole(directRole); setScreen('staff-gate'); }
      else setScreen('landing');
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setLoadingSlow(true), 7000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (ready && screen === 'demo') localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  }, [state, ready, screen]);

  useEffect(() => {
    if (screen !== 'app' || !hasCloudBackend() || !sessionToken || !state.settings.eventCode) return;
    const refresh = () => { if (document.visibilityState === 'visible') void refreshEvent(false); };
    const poll = window.setInterval(refresh, 12000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(poll); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [refreshEvent, sessionToken, state.settings.eventCode, screen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const role = state.settings.role;
  const waiting = state.guests.filter((guest) => !guest.completed);
  const completed = state.guests.filter((guest) => guest.completed);
  const normalized = query.trim().toLowerCase();
  const matches = (guest: GuestGroup) => `${guest.name}${guest.category}${guest.phone}${guest.tables.map((table) => table.table).join('')}`.toLowerCase().includes(normalized);
  const candidates = waiting.filter((guest) => !normalized || matches(guest));
  const completedMatches = completed.filter((guest) => !normalized || matches(guest));
  const hiddenCompletedMatch = normalized ? completed.find(matches) : undefined;
  const isDemo = screen === 'demo';

  const replaceQuery = (params?: URLSearchParams) => history.replaceState(null, '', `${location.pathname}${params && params.toString() ? `?${params}` : ''}`);

  const enterDemo = () => {
    try { const saved = localStorage.getItem(DEMO_STORAGE_KEY); setState(saved ? JSON.parse(saved) : clone(initialState)); }
    catch { setState(clone(initialState)); }
    setSessionToken(''); setAdminIdentity(null); setScreen('demo'); setTab('reception');
    replaceQuery(new URLSearchParams({ mode:'demo' }));
  };

  const returnHome = () => {
    if (state.settings.eventCode) sessionStorage.removeItem(`hao-ri-zi-token-${state.settings.eventCode}`);
    setSessionToken(''); setAdminIdentity(null); setCloudMessage(''); setScreen('landing'); setState(clone(initialState));
    setTab('reception'); closeGuest(); replaceQuery();
  };

  const activateSession = (token: string, remote: AppState) => {
    remoteSnapshot.current = JSON.stringify(remote); setSessionToken(token); setState(remote); setScreen('app'); markSynced(); setTab(remote.settings.role === 'planner' ? 'dashboard' : remote.settings.role === 'admin' ? 'admin' : 'reception');
    const params = new URLSearchParams({ event:remote.settings.eventCode });
    if (remote.settings.role !== 'admin') params.set('role', remote.settings.role);
    sessionStorage.setItem(`hao-ri-zi-token-${remote.settings.eventCode}`, token); replaceQuery(params);
  };

  const openAdminEvent = async (eventCode: string) => {
    if (!adminIdentity) throw new Error('請重新使用 Google 帳號登入');
    const result = await loginAdminEvent(eventCode, adminIdentity.idToken); activateSession(result.token, result.state);
  };

  const createAndOpenEvent = async (eventName: string) => {
    if (!adminIdentity) throw new Error('請重新使用 Google 帳號登入');
    const created = await createAdminEvent(eventName, adminIdentity.idToken);
    const result = await loginAdminEvent(created.state.settings.eventCode, adminIdentity.idToken); activateSession(result.token, result.state);
  };

  const openGuest = async (guest: GuestGroup) => {
    let currentGuest = guest;
    if (!isDemo && sessionToken) {
      setOpeningGuestId(guest.id);
      try {
        setSyncStatus('syncing');
        const remote = await loadEvent(state.settings.eventCode, sessionToken);
        remoteSnapshot.current = JSON.stringify(remote); setState(remote); markSynced();
        currentGuest = remote.guests.find((item) => item.id === guest.id) || guest;
      } catch (error) { setSyncStatus('error'); setNotice(error instanceof Error ? error.message : '無法取得最新賓客資料'); setOpeningGuestId(''); return; }
      setOpeningGuestId('');
    }
    const next = clone(currentGuest);
    if (next.giftName === next.name) next.giftName = '';
    setDraft(next); setDraftBaseUpdatedAt(currentGuest.updatedAt); setConflictMessage(''); setSaveError(''); setStep(1); setEditingAttendance(false); setEditingCake(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeGuest = () => { setDraft(null); setDraftBaseUpdatedAt(''); setConflictMessage(''); setSaveError(''); setStep(1); };

  const reloadDraft = async () => {
    if (!draft || !sessionToken) return;
    setSyncStatus('syncing');
    try {
      const remote=await loadEvent(state.settings.eventCode,sessionToken), latest=remote.guests.find((guest)=>guest.id===draft.id);
      if (!latest) throw new Error('這位賓客已不在最新名單');
      remoteSnapshot.current=JSON.stringify(remote); setState(remote); setDraft(clone(latest)); setDraftBaseUpdatedAt(latest.updatedAt); setConflictMessage(''); setSaveError(''); setStep(1); markSynced(); setNotice('已載入最新接待資料，請重新確認');
    } catch(error) { setSyncStatus('error'); setSaveError(error instanceof Error?error.message:'無法載入最新資料'); }
  };

  const setDraftValue = <K extends keyof GuestGroup>(key: K, value: GuestGroup[K]) => setDraft((current) => {
    if (!current) return current;
    const next = { ...current, [key]: value };
    return key.startsWith('cake') ? syncCakeTotals(next) : next;
  });

  const goGift = () => {
    if (!draft) return;
    if (draft.actual < 0) return setNotice('實到人數不能小於 0');
    setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goCake = () => {
    if (!draft) return;
    if (draft.giftReceived && !draft.bagNamed) {
      const proceed = window.confirm('尚未確認紅包袋上有編號或姓名。仍要前往喜餅步驟嗎？');
      if (!proceed) return;
    }
    setStep(3); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmCake = (received: boolean) => {
    if (!draft) return;
    if (!received) {
      setDraft(syncCakeTotals({ ...draft, cakeChineseDelivered: 0, cakeChineseOwed: draft.cakeChinesePlanned, cakeWesternDelivered: 0, cakeWesternOwed: draft.cakeWesternPlanned }));
    } else {
      const availableChinese = Math.max(0, state.settings.cakeStockChinese - state.guests.reduce((sum, guest) => sum + (guest.id === draft.id ? 0 : guest.cakeChineseDelivered), 0));
      const availableWestern = Math.max(0, state.settings.cakeStockWestern - state.guests.reduce((sum, guest) => sum + (guest.id === draft.id ? 0 : guest.cakeWesternDelivered), 0));
      const chinese = Math.min(draft.cakeChinesePlanned, availableChinese), western = Math.min(draft.cakeWesternPlanned, availableWestern);
      setDraft(syncCakeTotals({ ...draft, cakeChineseDelivered: chinese, cakeChineseOwed: Math.max(0, draft.cakeChinesePlanned - chinese), cakeWesternDelivered: western, cakeWesternOwed: Math.max(0, draft.cakeWesternPlanned - western) }));
      if (chinese < draft.cakeChinesePlanned || western < draft.cakeWesternPlanned) setNotice('現場喜餅不足，已自動登記為欠餅');
    }
    setStep(4); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const finishReception = async () => {
    if (!draft) return;
    const finished = syncCakeTotals({
      ...draft, completed: true, completedAt: new Date().toISOString(), completedBy: state.settings.operator,
      vegetarianActual: Math.min(draft.vegetarianActual || draft.vegetarianExpected, draft.actual),
      childChairActual: Math.min(draft.childChairActual || draft.childChairExpected, draft.actual), updatedAt: new Date().toISOString(),
    });
    setSavingGuest(true); setSaveError(''); setConflictMessage(''); setSyncStatus('syncing');
    writeInFlight.current = true;
    try {
      if (isDemo) setState((current) => ({ ...current, guests: current.guests.map((guest) => guest.id === finished.id ? finished : guest) }));
      else { const result = await updateCloudGuest(state.settings.eventCode, finished, sessionToken, draftBaseUpdatedAt); remoteSnapshot.current = JSON.stringify(result.state); setState(result.state); }
      markSynced();
      setNotice(`${finished.name} 已完成接待並同步`); closeGuest(); setQuery(''); setTab('reception');
    } catch (error) {
      const message=error instanceof Error ? error.message : '接待資料儲存失敗';
      if (message.includes('剛剛已由')) { setConflictMessage(message); setSyncStatus('synced'); }
      else { setSaveError(`${message}。目前填寫內容仍保留在畫面上，請確認連線後重新送出。`); setSyncStatus('error'); }
    }
    finally { writeInFlight.current = false; setSavingGuest(false); }
  };

  const cancelReception = async (guest: GuestGroup) => {
    if (!window.confirm(`確定要清除「${guest.name}」的整筆接待紀錄嗎？\n\n將清除實到人數、紅包、禮金、喜餅領取、備註與接待人員。此操作無法在網頁上復原。`)) return;
    const cancelled = syncCakeTotals({
      ...guest, actual: 0, vegetarianActual: 0, childChairActual: 0, cakeDelivered: 0, cakeOwed: 0,
      cakeChineseDelivered: 0, cakeChineseOwed: 0, cakeWesternDelivered: 0, cakeWesternOwed: 0,
      giftReceived: false, bagNamed: false, giftName: '', giftAmount: null, note: '',
      completed: false, completedAt: null, completedBy: '', updatedAt: new Date().toISOString(),
    });
    setSavingGuest(true); setSyncStatus('syncing');
    writeInFlight.current = true;
    try {
      if (isDemo) setState((current) => ({ ...current, guests: current.guests.map((item) => item.id === guest.id ? cancelled : item) }));
      else { const result = await updateCloudGuest(state.settings.eventCode, cancelled, sessionToken, guest.updatedAt); remoteSnapshot.current = JSON.stringify(result.state); setState(result.state); }
      markSynced(); setNotice(`${guest.name} 的接待紀錄已清除並同步`); closeGuest();
    } catch (error) { const message=error instanceof Error ? error.message : '無法清除接待紀錄'; setNotice(message); setSyncStatus(message.includes('剛剛已由')?'synced':'error'); }
    finally { writeInFlight.current = false; setSavingGuest(false); }
  };

  const handleImport = async (file: File) => {
    setImportBusy(true); setImportFeedback({ tone:'info', text:'正在讀取 Excel…' });
    try {
      const parsed = await readExcelFile(file);
      if (!parsed.guests.length) throw new Error('沒有找到可匯入的賓客資料，請確認賓客名稱欄位');
      setImported(parsed); setSourceName(file.name); setImportFeedback({ tone:'success', text:`讀取成功：找到 ${parsed.guests.length} 組賓客，請確認下方資料。` });
    } catch (error) { setImportFeedback({ tone:'error', text:error instanceof Error ? error.message : '無法讀取檔案' }); }
    finally { setImportBusy(false); }
  };

  const handleGoogleSheet = async (url: string) => {
    setImportBusy(true); setImportFeedback({ tone:'info', text:'正在連線並讀取 Google Sheet，第一次可能需要數秒…' });
    try {
      const result = await callCloud<{ title:string; sheetName:string; values:unknown[][]; rowCount:number }>('readGoogleSheet', { eventCode:state.settings.eventCode, token:sessionToken, url }, { retries:1, timeoutMs:20000 });
      const parsed = parseGuestMatrix(result.values);
      if (!parsed.guests.length) throw new Error('試算表中沒有找到賓客資料，請確認第一列欄位名稱');
      setImported(parsed); setSourceName(`${result.title}／${result.sheetName}`); setImportFeedback({ tone:'success', text:`讀取成功：${result.rowCount} 列資料整理為 ${parsed.guests.length} 組賓客。` });
    } catch (error) { setImportFeedback({ tone:'error', text:error instanceof Error ? error.message : '無法讀取 Google Sheet' }); }
    finally { setImportBusy(false); }
  };

  const applyImport = async () => {
    if (!imported) return;
    setImportBusy(true); setSyncStatus('syncing'); setImportFeedback({ tone:'info', text:'正在安全合併並儲存至 Google Drive…' });
    writeInFlight.current = true;
    try {
      const result = await applyCloudImport(state.settings.eventCode, imported.guests, sourceName, sessionToken);
      remoteSnapshot.current = JSON.stringify(result.state); setState(result.state); setImported(null); markSynced();
      const s = result.summary; setImportFeedback({ tone:'success', text:`匯入完成並已同步：新增 ${s.added}、更新 ${s.updated}、移除 ${s.removed}${s.retained ? `、保留已接待 ${s.retained}` : ''} 組。` });
    } catch (error) { setSyncStatus('error'); setImportFeedback({ tone:'error', text:error instanceof Error ? error.message : '名單匯入失敗' }); }
    finally { writeInFlight.current = false; setImportBusy(false); }
  };

  const saveAdminSettings = async (patch: Record<string, unknown>) => {
    writeInFlight.current = true; setSyncStatus('syncing');
    try {
      const result = await updateCloudSettings(state.settings.eventCode, patch, sessionToken);
      remoteSnapshot.current = JSON.stringify(result.state); setState(result.state); markSynced(); setNotice('設定已儲存並同步');
    } catch (error) {
      try {
        const remote = await loadEvent(state.settings.eventCode, sessionToken);
        const saved = Object.entries(patch).every(([key,value]) => remote.settings[key as keyof typeof remote.settings] === value);
        remoteSnapshot.current = JSON.stringify(remote); setState(remote);
        if (saved) { markSynced(); setNotice('設定已儲存並同步'); return; }
      } catch { /* show the original write error below */ }
      setSyncStatus('error'); setNotice(error instanceof Error ? error.message : '設定儲存失敗'); throw error;
    } finally { writeInFlight.current = false; }
  };

  const exportGiftCsv = () => {
    const header = ['賓客','分類','已收到紅包','紅包編號','禮金金額','袋上有編號或姓名','備註','接待人員','完成時間'];
    const rows = completed.map((guest) => [guest.name,guest.category,guest.giftReceived?'是':'否',guest.giftName,guest.giftAmount ?? '',guest.bagNamed?'是':'否',guest.note,guest.completedBy,guest.completedAt || '']);
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"','""')}"`;
    const blob = new Blob(['\ufeff' + [header,...rows].map((row) => row.map(escape).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.settings.eventName}_禮金紀錄.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const exportReceptionCsv = () => {
    const header=['賓客','分類','電話','桌次','應到','實到','素食應到','素食實到','兒童椅應到','兒童椅實到','中式喜餅應發','中式喜餅已發','中式欠餅','西式喜餅應發','西式喜餅已發','西式欠餅','收到紅包','紅包編號','禮金金額','袋上有編號或姓名','備註','接待狀態','接待人員','完成時間','最後更新'];
    const rows=state.guests.map((guest)=>[guest.name,guest.category,guest.phone,formatTables(guest),guest.expected,guest.actual,guest.vegetarianExpected,guest.vegetarianActual,guest.childChairExpected,guest.childChairActual,guest.cakeChinesePlanned,guest.cakeChineseDelivered,guest.cakeChineseOwed,guest.cakeWesternPlanned,guest.cakeWesternDelivered,guest.cakeWesternOwed,guest.giftReceived?'是':'否',guest.giftName,guest.giftAmount??'',guest.bagNamed?'是':'否',guest.note,guest.completed?'已接待':'未接待',guest.completedBy,guest.completedAt||'',guest.updatedAt]);
    const escape=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
    const blob=new Blob(['\ufeff'+[header,...rows].map(row=>row.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${state.settings.eventName}_完整接待紀錄.csv`;link.click();URL.revokeObjectURL(link.href);
  };

  const tabs: { key: MainTab; label: string; count?: number }[] = role === 'planner'
    ? [{ key:'dashboard', label:'現場總覽' }]
    : [{ key:'reception', label:'接待賓客', count:waiting.length }, { key:'completed', label:'已接待', count:completed.length }, { key:'dashboard', label:'現場總覽' }, ...(!isDemo && role === 'admin' ? [{ key:'admin' as MainTab, label:'管理' }] : [])];

  if (!ready) return <LoadingScreen slow={loadingSlow} onRetry={()=>location.reload()} />;
  if (screen === 'landing') return <EntryScreen onAdmin={()=>setScreen('admin-signin')} onDemo={enterDemo} />;
  if (screen === 'admin-signin') return <AdminSignIn message={cloudMessage} onBack={()=>setScreen('landing')} onAuthenticated={(identity)=>{ setAdminIdentity(identity); setScreen('admin-hub'); }} />;
  if (screen === 'admin-hub' && adminIdentity) return <AdminHub identity={adminIdentity} onOpen={openAdminEvent} onCreate={createAndOpenEvent} onBack={()=>{setAdminIdentity(null);setScreen('landing');}} />;
  if (screen === 'staff-gate') return <StaffGate eventCode={gateEventCode} role={gateRole} message={cloudMessage} onBack={()=>{replaceQuery();setScreen('landing');}} onLogin={activateSession} />;
  if (screen !== 'demo' && screen !== 'app') return <LoadingScreen slow={loadingSlow} onRetry={()=>location.reload()} />;
  if (!state.settings.receptionOpen && role !== 'admin') return <ClosedScreen eventName={state.settings.eventName} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">{state.settings.eventName}</p><h1>好日子迎賓</h1></div>
        <div className="top-actions">
          <button className={`sync ${isDemo?'demo':syncStatus}`} type="button" disabled={isDemo||syncStatus==='syncing'} onClick={()=>void refreshEvent(true)} aria-label={isDemo?'虛構示範資料':'重新同步婚宴資料'}><i /><span className="sync-long">{isDemo?'虛構示範資料':syncStatus==='syncing'?'同步中…':syncStatus==='error'?'連線不穩・點此重試':`已同步${lastSyncedAt?`・${new Date(lastSyncedAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`:''}`}</span><span className="sync-short">{isDemo?'示範':syncStatus==='syncing'?'同步中':syncStatus==='error'?'同步失敗':'已同步'}</span></button>
          <button className="operator" type="button" onClick={() => role === 'admin' && setTab('admin')}>{role === 'admin' ? 'Admin' : role === 'planner' ? '婚顧' : '接待'}・{state.settings.operator}</button>
          <button className="top-exit" type="button" onClick={returnHome}>{isDemo ? '離開示範' : role === 'admin' ? '切換婚宴' : '離開'}</button>
        </div>
      </header>

      <nav className="tabs" aria-label="主要功能">
        {tabs.map((item) => <button key={item.key} className={`tab ${tab === item.key ? 'active' : ''}`} type="button" onClick={() => { closeGuest(); setTab(item.key); setQuery(''); }}>
          {item.label}{typeof item.count === 'number' && <span>{item.count}</span>}
        </button>)}
      </nav>

      {tab === 'reception' && !draft && <GuestBrowser query={query} setQuery={setQuery} guests={candidates} hiddenCompletedMatch={hiddenCompletedMatch} onOpen={openGuest} openingGuestId={openingGuestId} />}
      {tab === 'completed' && !draft && <CompletedList query={query} setQuery={setQuery} guests={completedMatches} onOpen={openGuest} onCancel={cancelReception} />}
      {(tab === 'reception' || tab === 'completed') && draft && <ReceptionWizard guest={draft} step={step} editingAttendance={editingAttendance} editingCake={editingCake} isEdit={draft.completed} saving={savingGuest} conflictMessage={conflictMessage} saveError={saveError} onReload={()=>void reloadDraft()} onBack={closeGuest} onChange={setDraftValue} onEditAttendance={setEditingAttendance} onEditCake={setEditingCake} onGoGift={goGift} onGoCake={goCake} onGoStep={setStep} onCake={confirmCake} onFinish={finishReception} onCancel={() => cancelReception(draft)} />}
      {tab === 'dashboard' && <Dashboard state={state} tableDetail={tableDetail} setTableDetail={setTableDetail} />}
      {tab === 'admin' && !isDemo && role === 'admin' && <AdminPanel state={state} completed={completed} imported={imported} sourceName={sourceName} importBusy={importBusy} importFeedback={importFeedback} fileRef={fileRef} onFile={handleImport} onGoogleSheet={handleGoogleSheet} applyImport={applyImport} cancelImport={() => setImported(null)} exportGiftCsv={exportGiftCsv} exportReceptionCsv={exportReceptionCsv} onSaveSettings={saveAdminSettings} onCopyRoleLink={async(roleToCopy)=>{ const url=`${location.origin}${location.pathname}?event=${encodeURIComponent(state.settings.eventCode)}&role=${roleToCopy}`; await navigator.clipboard.writeText(url); setNotice(roleToCopy==='reception'?'已複製接待人員連結':'已複製婚顧連結'); }} />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function GuestBrowser({ query, setQuery, guests, hiddenCompletedMatch, onOpen, openingGuestId }:{ query:string; setQuery:(value:string)=>void; guests:GuestGroup[]; hiddenCompletedMatch?:GuestGroup; onOpen:(guest:GuestGroup)=>void; openingGuestId:string }) {
  return <section className="content guest-browser">
    <SearchCard query={query} setQuery={setQuery} />
    {hiddenCompletedMatch && <div className="already-notice"><b>{hiddenCompletedMatch.name}</b> 已完成接待，請到「已接待」查看或修改。</div>}
    <div className="list-heading"><div><h2>等待接待</h2><p>選擇賓客後，才會開啟接待資訊。</p></div><strong>{guests.length} 組</strong></div>
    <div className="guest-grid">{guests.map((guest) => <GuestCard key={guest.id} guest={guest} onOpen={onOpen} busy={openingGuestId===guest.id} />)}</div>
    {!guests.length && <Empty title="找不到等待接待的賓客" copy="請確認名稱或電話末三碼；已完成者不會出現在這裡。" />}
  </section>;
}

function SearchCard({ query, setQuery }:{ query:string; setQuery:(value:string)=>void }) {
  return <div className="search-card"><label htmlFor="guest-search">尋找賓客</label><p>可輸入賓客名稱、分類、桌次或電話末三碼</p><div className="search-row"><span aria-hidden="true">⌕</span><input id="guest-search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="例如：小明、同事、002" autoComplete="off" /><button className={query ? '' : 'invisible'} type="button" onClick={()=>setQuery('')}>清除</button></div></div>;
}

function GuestCard({ guest, onOpen, busy=false }:{ guest:GuestGroup; onOpen:(guest:GuestGroup)=>void; busy?:boolean }) {
  return <button className="guest-card" type="button" disabled={busy} onClick={()=>onOpen(guest)}><div className="guest-main"><span className="avatar" aria-hidden="true">{guest.name.slice(0,1)}</span><div><h3>{guest.name}</h3><p>{guest.category}・{maskPhone(guest.phone)}</p></div></div><div className="guest-meta"><span>應到 <b>{guest.expected}</b> 位</span><span>{formatTables(guest)}</span><i aria-hidden="true">{busy?'同步中…':'›'}</i></div></button>;
}

function CompletedList({ query, setQuery, guests, onOpen, onCancel }:{ query:string; setQuery:(value:string)=>void; guests:GuestGroup[]; onOpen:(guest:GuestGroup)=>void; onCancel:(guest:GuestGroup)=>void }) {
  return <section className="content"><SearchCard query={query} setQuery={setQuery} /><div className="list-heading"><div><h2>已接待賓客</h2><p>「重新開啟修改」會保留所有資料；只有「清除紀錄」才會刪除接待內容。</p></div><strong>{guests.length} 組</strong></div><div className="completed-list">{guests.map((guest)=><article className="completed-row" key={guest.id}><div><span className={`status-chip ${deriveStatus(guest)}`}>{statusText(deriveStatus(guest))}</span><h3>{guest.name}</h3><p>實到 {guest.actual}／應到 {guest.expected} 位・{formatTables(guest)}</p></div><div className="completed-facts"><span>{guest.giftReceived ? `紅包${guest.giftAmount ? ` $${money.format(guest.giftAmount)}` : '（未填金額）'}` : '未收紅包'}</span><span>{guest.cakePlanned ? (guest.cakeOwed ? `欠餅 ${guest.cakeOwed} 盒` : `喜餅已領 ${guest.cakeDelivered} 盒`) : '不需喜餅'}</span></div><div className="row-actions"><button type="button" onClick={()=>onOpen(guest)}>重新開啟修改</button><button className="danger-link" type="button" onClick={()=>onCancel(guest)}>清除紀錄</button></div></article>)}</div>{!guests.length&&<Empty title="尚無已接待賓客" copy="完成第一組接待後，紀錄會出現在這裡。" />}</section>;
}

type WizardProps = { guest:GuestGroup; step:number; editingAttendance:boolean; editingCake:boolean; isEdit:boolean; saving:boolean; conflictMessage:string; saveError:string; onReload:()=>void; onBack:()=>void; onChange:<K extends keyof GuestGroup>(key:K,value:GuestGroup[K])=>void; onEditAttendance:(value:boolean)=>void; onEditCake:(value:boolean)=>void; onGoGift:()=>void; onGoCake:()=>void; onGoStep:(step:number)=>void; onCake:(received:boolean)=>void; onFinish:()=>void; onCancel:()=>void };
function ReceptionWizard(props:WizardProps) {
  const { guest, step, editingAttendance, editingCake, isEdit, saving, conflictMessage, saveError, onReload, onBack, onChange, onEditAttendance, onEditCake, onGoGift, onGoCake, onGoStep, onCake, onFinish, onCancel } = props;
  return <section className="content reception-card"><button className="back" type="button" onClick={onBack}>‹ 返回{isEdit?'已接待':'賓客列表'}</button><div className="selected-title"><h2>{guest.name}</h2></div><Progress step={step} />
    {conflictMessage&&<div className="draft-alert conflict-alert" role="alert"><div><b>另一台裝置已更新這位賓客</b><span>{conflictMessage}</span></div><button type="button" onClick={onReload}>載入最新資料</button></div>}
    {saveError&&<div className="draft-alert save-alert" role="alert"><div><b>尚未儲存成功</b><span>{saveError}</span></div></div>}
    <div className="wizard-panel">
      {step===1&&<><div className="section-title"><h3>確認賓客的到場人數</h3></div><div className="expected-count"><span>名單應到</span><strong>{guest.expected}</strong><span>位</span></div>{editingAttendance&&<div className="edit-box"><NumberField label="實到人數" value={guest.actual} onChange={(value)=>onChange('actual',value)} max={99} /><NumberField label={`其中素食（原定 ${guest.vegetarianExpected}）`} value={guest.vegetarianActual} onChange={(value)=>onChange('vegetarianActual',value)} max={guest.actual||99} /><NumberField label={`其中兒童椅（原定 ${guest.childChairExpected}）`} value={guest.childChairActual} onChange={(value)=>onChange('childChairActual',value)} max={guest.actual||99} /></div>}<div className="action-row"><button className="secondary" type="button" onClick={()=>{ onEditAttendance(!editingAttendance); if(!editingAttendance){onChange('actual',guest.actual||guest.expected);onChange('vegetarianActual',guest.vegetarianActual||guest.vegetarianExpected);onChange('childChairActual',guest.childChairActual||guest.childChairExpected);} }}>{editingAttendance?'收起修改':'修改實到人數'}</button><button className="primary" type="button" onClick={()=>{ if(!editingAttendance){onChange('actual',guest.expected);onChange('vegetarianActual',guest.vegetarianExpected);onChange('childChairActual',guest.childChairExpected);} window.setTimeout(onGoGift,0); }}>{editingAttendance?`確認 ${guest.actual} 位已到`:`確認 ${guest.expected} 位已到`}</button></div></>}
      {step===2&&<><SectionTitle title="登記紅包" copy="沒有紅包也可以直接前往下一步。" prominent /><div className="check-stack"><label className="check-card"><input type="checkbox" checked={guest.giftReceived} onChange={(event)=>onChange('giftReceived',event.target.checked)} /><span><b>已收到紅包</b></span></label>{guest.giftReceived&&<><label className="check-card warning"><input type="checkbox" checked={guest.bagNamed} onChange={(event)=>onChange('bagNamed',event.target.checked)} /><span><b>已確認袋上有編號或姓名</b></span></label><label className="field"><span>紅包編號</span><input inputMode="numeric" placeholder="例如：023" value={guest.giftName} onChange={(event)=>onChange('giftName',event.target.value)} /></label><label className="field"><span>禮金金額（可不填）</span><input inputMode="numeric" placeholder="留白即可" value={guest.giftAmount??''} onChange={(event)=>onChange('giftAmount',event.target.value===''?null:Number(event.target.value))} /></label></>}<label className="field"><span>備註（可不填）</span><textarea placeholder="例如：同一賓客另有一個紅包" value={guest.note} onChange={(event)=>onChange('note',event.target.value)} /></label></div><div className="action-row"><button className="secondary" type="button" onClick={()=>onGoStep(1)}>上一步</button><button className="primary" type="button" onClick={onGoCake}>{guest.giftReceived?'完成紅包登記':'沒有紅包，繼續'}</button></div></>}
      {step===3&&<><div className="section-title"><h3>確認喜餅領取</h3></div><div className="cake-display"><div className="cake-types">{guest.cakeChinesePlanned>0&&<div className="cake-content"><span>中式喜餅</span><strong>{guest.cakeChinesePlanned}</strong><span>盒</span></div>}{guest.cakeWesternPlanned>0&&<div className="cake-content"><span>西式喜餅</span><strong>{guest.cakeWesternPlanned}</strong><span>盒</span></div>}{guest.cakePlanned===0&&<div className="cake-content"><span>不需喜餅</span></div>}</div></div>{guest.cakePlanned>0&&<button className="inline-edit" type="button" onClick={()=>onEditCake(!editingCake)}>{editingCake?'收起修改':'修改數量'}</button>}{editingCake&&<div className="edit-box cake-edit"><NumberField label="中式喜餅" value={guest.cakeChinesePlanned} onChange={(value)=>onChange('cakeChinesePlanned',value)} max={20} /><NumberField label="西式喜餅" value={guest.cakeWesternPlanned} onChange={(value)=>onChange('cakeWesternPlanned',value)} max={20} /></div>}<div className="action-row"><button className="secondary" type="button" onClick={()=>onGoStep(2)}>上一步</button>{guest.cakePlanned>0?<button className="primary" type="button" onClick={()=>onCake(true)}>確認領餅</button>:<button className="primary" type="button" onClick={()=>onCake(false)}>不需領餅，繼續</button>}</div>{guest.cakePlanned>0&&<button className="rare-action" type="button" onClick={()=>{if(window.confirm('確定要登記這位賓客的喜餅尚未領取嗎？'))onCake(false);}}>喜餅不足或未帶走？登記欠餅</button>}</>}
      {step===4&&<><SectionTitle title="告知賓客入席桌次" /><div className="table-display">{guest.tables.length?guest.tables.map((table)=><div key={table.table}><strong>{table.table}</strong>{guest.tables.length>1&&<span>安排 {table.planned} 位</span>}</div>):<div><strong>待安排</strong></div>}</div>{guest.cakeOwed>0&&<div className="owed-banner">已登記欠餅：中式 {guest.cakeChineseOwed} 盒、西式 {guest.cakeWesternOwed} 盒</div>}<div className="action-row"><button className="secondary" type="button" disabled={saving} onClick={()=>onGoStep(3)}>上一步</button><button className="primary finish" type="button" disabled={saving||Boolean(conflictMessage)} onClick={onFinish}>{saving?'同步中…':isEdit?'儲存修改':'完成接待'}</button></div>{isEdit&&<button className="cancel-reception" type="button" disabled={saving} onClick={onCancel}>清除這筆接待紀錄</button>}</>}
    </div>
  </section>;
}

function Progress({ step }:{step:number}) { const labels=['人數','紅包','喜餅','桌次']; return <div className="stepper" aria-label={`接待進度：第 ${step} 步`}>{labels.map((label,index)=><div className={`${index+1===step?'current':''} ${index+1<step?'done':''}`} key={label}><b>{index+1<step?'✓':index+1}</b><span>{label}</span></div>)}</div>; }
function SectionTitle({ step,title,copy,prominent=false }:{step?:string;title:string;copy?:string;prominent?:boolean}) { return <div className="section-title">{step&&<p>{step}</p>}<h3>{title}</h3>{copy&&<span className={prominent?'prominent':''}>{copy}</span>}</div>; }
function NumberField({ label,value,onChange,max }:{label:string;value:number;onChange:(value:number)=>void;max:number}) { return <label className="number-field"><span>{label}</span><div><button type="button" onClick={()=>onChange(Math.max(0,value-1))}>−</button><input inputMode="numeric" value={value} onChange={(event)=>onChange(Math.min(max,Math.max(0,Number(event.target.value)||0)))} /><button type="button" onClick={()=>onChange(Math.min(max,value+1))}>＋</button></div></label>; }

function Dashboard({ state, tableDetail, setTableDetail }:{state:AppState;tableDetail:string|null;setTableDetail:(value:string|null)=>void}) {
  const [cakeDetail,setCakeDetail]=useState<'chinese'|'western'|null>(null);
  const expected=state.guests.reduce((sum,guest)=>sum+guest.expected,0), actual=state.guests.reduce((sum,guest)=>sum+guest.actual,0), completed=state.guests.filter((guest)=>guest.completed).length;
  const chinesePlanned=state.guests.reduce((sum,guest)=>sum+guest.cakeChinesePlanned,0), chineseDelivered=state.guests.reduce((sum,guest)=>sum+guest.cakeChineseDelivered,0);
  const westernPlanned=state.guests.reduce((sum,guest)=>sum+guest.cakeWesternPlanned,0), westernDelivered=state.guests.reduce((sum,guest)=>sum+guest.cakeWesternDelivered,0);
  const tables = new Map<string,{planned:number;actual:number;guests:GuestGroup[];estimated:boolean}>();
  state.guests.forEach((guest)=>allocateActual(guest).forEach((item)=>{ const old=tables.get(item.table)||{planned:0,actual:0,guests:[],estimated:false}; tables.set(item.table,{planned:old.planned+item.planned,actual:old.actual+item.actual,guests:[...old.guests,guest],estimated:old.estimated||(guest.tables.length>1&&guest.actual>0&&guest.actual<guest.expected)}); }));
  const selected=tableDetail?tables.get(tableDetail):null;
  const cakeGuests=cakeDetail?state.guests.map((guest)=>({
    guest,
    planned:cakeDetail==='chinese'?guest.cakeChinesePlanned:guest.cakeWesternPlanned,
    delivered:cakeDetail==='chinese'?guest.cakeChineseDelivered:guest.cakeWesternDelivered,
  })).filter((item)=>item.planned>0).sort((a,b)=>{
    const aDone=a.delivered>=a.planned, bDone=b.delivered>=b.planned;
    return Number(aDone)-Number(bDone)||a.guest.name.localeCompare(b.guest.name,'zh-Hant');
  }):[];
  const cakeTitle=cakeDetail==='chinese'?'中式喜餅':'西式喜餅';
  return <section className="content dashboard"><div className="dashboard-heading"><div><p className="eyebrow">即時更新</p><h2>現場總覽</h2></div><span>{state.settings.receptionOpen?'接待進行中':'接待已關閉'}</span></div><div className="metrics"><Metric label="總報到率" value={`${expected?Math.round(actual/expected*100):0}%`} detail={`實到 ${actual}／應到 ${expected} 位`} tone="rose" /><Metric label="完成接待" value={`${completed}`} unit="組" detail={`尚有 ${state.guests.length-completed} 組`} tone="sage" /></div><div className="progress-row"><span style={{width:`${Math.min(100,expected?actual/expected*100:0)}%`}} /></div><div className="cake-summary"><div className="cake-summary-heading"><h2>喜餅發放</h2><p>點選喜餅種類，可查看已領與未領賓客。</p></div><div className="cake-summary-grid"><CakeMetric title="中式喜餅" stock={state.settings.cakeStockChinese} planned={chinesePlanned} delivered={chineseDelivered} tone="chinese" onClick={()=>setCakeDetail('chinese')} /><CakeMetric title="西式喜餅" stock={state.settings.cakeStockWestern} planned={westernPlanned} delivered={westernDelivered} tone="western" onClick={()=>setCakeDetail('western')} /></div></div><div className="list-heading"><div><h2>各桌到場概況</h2><p>點選桌次，可查看哪些賓客已到或未到。</p></div><strong>{tables.size} 桌</strong></div><div className="table-grid">{[...tables].sort((a,b)=>a[0].localeCompare(b[0],'zh-Hant',{numeric:true})).map(([name,data])=><button type="button" className="table-card" key={name} onClick={()=>setTableDetail(name)}><div><h3>{name}</h3>{data.estimated&&<span>含估算</span>}</div><strong>{data.actual}<small>／{data.planned} 位</small></strong><p>未到 {Math.max(0,data.planned-data.actual)} 位</p><i><span style={{width:`${Math.min(100,data.planned?data.actual/data.planned*100:0)}%`}} /></i></button>)}</div>{selected&&<div className="modal-backdrop" onMouseDown={()=>setTableDetail(null)}><div className="modal" onMouseDown={(event)=>event.stopPropagation()}><button className="modal-close" type="button" onClick={()=>setTableDetail(null)}>×</button><p className="eyebrow">桌次詳情</p><h2>{tableDetail}</h2>{selected.estimated&&<div className="estimate-note">跨桌賓客的部分抵達人數，已依原定座位比例均攤估算。</div>}<div className="table-guest-list table-arrival-list">{selected.guests.map((guest)=>{const status=deriveStatus(guest);return <div className={`table-arrival-row ${status}`} key={guest.id}><div className="table-arrival-identity"><b>{guest.name}</b><small>{guest.category||'未分類'}</small></div><div className="table-arrival-result"><span className={`arrival-badge ${status}`}>{statusText(status)}</span><strong>{guest.actual}／{guest.expected} 位</strong></div></div>;})}</div></div></div>}{cakeDetail&&<div className="modal-backdrop" onMouseDown={()=>setCakeDetail(null)}><div className="modal cake-detail-modal" onMouseDown={(event)=>event.stopPropagation()}><button className="modal-close" type="button" onClick={()=>setCakeDetail(null)}>×</button><p className="eyebrow">喜餅領取名單</p><h2>{cakeTitle}</h2><div className="cake-detail-summary"><span>已領 <b>{cakeGuests.filter(item=>item.delivered>=item.planned).length}</b> 組</span><span>未完成 <b>{cakeGuests.filter(item=>item.delivered<item.planned).length}</b> 組</span></div>{cakeGuests.length?<div className="table-guest-list cake-guest-list">{cakeGuests.map(({guest,planned,delivered})=>{const status=delivered>=planned?'received':delivered>0?'partial':'waiting';return <div key={guest.id}><span className={`status-dot ${status}`} /><div><b>{guest.name}</b><small>{status==='received'?'已領取':status==='partial'?'部分領取':'尚未領取'}・{formatTables(guest)}</small></div><strong>{delivered}／{planned} 盒</strong></div>;})}</div>:<Empty title="沒有應領賓客" copy={`名單中沒有需要領取${cakeTitle}的賓客。`} />}</div></div>}</section>;
}

function Metric({label,value,unit,detail,tone}:{label:string;value:string;unit?:string;detail:string;tone:string}) { return <article className={`metric ${tone}`}><p>{label}</p><strong>{value}<small>{unit}</small></strong><span>{detail}</span></article>; }
function CakeMetric({title,stock,planned,delivered,tone,onClick}:{title:string;stock:number;planned:number;delivered:number;tone:string;onClick:()=>void}) { return <button type="button" className={`cake-metric ${tone}`} onClick={onClick} aria-label={`查看${title}領取名單`}><h3>{title}<i aria-hidden="true">›</i></h3><div><span><small>庫存數量</small><strong>{stock}<i>盒</i></strong></span><span><small>應發數量</small><strong>{planned}<i>盒</i></strong></span><span><small>已發數量</small><strong>{delivered}<i>盒</i></strong></span></div></button>; }

type AdminSection='setup'|'guests'|'staff'|'reports';
type AdminProps={state:AppState;completed:GuestGroup[];imported:ImportedPayload|null;sourceName:string;importBusy:boolean;importFeedback:{tone:'success'|'error'|'info';text:string}|null;fileRef:React.RefObject<HTMLInputElement|null>;onFile:(file:File)=>void;onGoogleSheet:(url:string)=>void;applyImport:()=>void;cancelImport:()=>void;exportGiftCsv:()=>void;exportReceptionCsv:()=>void;onSaveSettings:(patch:Record<string,unknown>)=>Promise<void>;onCopyRoleLink:(role:'reception'|'planner')=>void};
function AdminPanel({state,completed,imported,sourceName,importBusy,importFeedback,fileRef,onFile,onGoogleSheet,applyImport,cancelImport,exportGiftCsv,exportReceptionCsv,onSaveSettings,onCopyRoleLink}:AdminProps) {
  const [section,setSection]=useState<AdminSection>('setup');
  const [sheetUrl,setSheetUrl]=useState('');
  const [eventName,setEventName]=useState(state.settings.eventName);
  const [cakeStockChinese,setCakeStockChinese]=useState(state.settings.cakeStockChinese||0);
  const [cakeStockWestern,setCakeStockWestern]=useState(state.settings.cakeStockWestern||0);
  const [settingsBusy,setSettingsBusy]=useState(false);
  const [guestQuery,setGuestQuery]=useState('');
  const summary=imported?importSummary(state.guests,imported.guests):null;
  const giftTotal=completed.reduce((sum,guest)=>sum+(guest.giftAmount||0),0);
  const filteredGuests=state.guests.filter(g=>`${g.name}${g.category}${g.phone}${formatTables(g)}`.toLowerCase().includes(guestQuery.trim().toLowerCase()));
  const saveSettings=async()=>{setSettingsBusy(true);try{await onSaveSettings({eventName,cakeStockChinese,cakeStockWestern});}finally{setSettingsBusy(false);}};
  const toggleReception=async()=>{if(state.settings.receptionOpen&&!window.confirm('關閉後，接待人員與婚顧都無法進入。確定關閉嗎？'))return;setSettingsBusy(true);try{await onSaveSettings({receptionOpen:!state.settings.receptionOpen});}finally{setSettingsBusy(false);}};
  return <section className="content admin-page">
    <div className="dashboard-heading"><div><p className="eyebrow">僅 Admin 可見</p><h2>{state.settings.eventName}</h2><small>婚宴代碼 {state.settings.eventCode}</small></div><span className={state.settings.receptionOpen?'open':'closed'}>{state.settings.receptionOpen?'接待開放中':'接待已關閉'}</span></div>
    <nav className="admin-nav" aria-label="婚宴管理功能">{([['setup','設定'],['guests',`賓客名單 ${state.guests.length}`],['staff','工作人員'],['reports','報表']] as [AdminSection,string][]).map(([key,label])=><button key={key} type="button" className={section===key?'active':''} onClick={()=>setSection(key)}>{label}</button>)}</nav>

    {section==='setup'&&<div className="admin-stack">
      <article className="admin-card"><div className="card-head"><div><p>步驟 1</p><h3>場次基本設定</h3></div><span>{state.settings.eventCode}</span></div><label className="field"><span>婚宴名稱</span><input value={eventName} onChange={e=>setEventName(e.target.value)} /></label><div className="stock-grid"><label className="field"><span>中式喜餅現場庫存</span><input inputMode="numeric" value={cakeStockChinese||''} placeholder="0" onChange={e=>setCakeStockChinese(Number(e.target.value)||0)} /></label><label className="field"><span>西式喜餅現場庫存</span><input inputMode="numeric" value={cakeStockWestern||''} placeholder="0" onChange={e=>setCakeStockWestern(Number(e.target.value)||0)} /></label></div><button className="primary settings-save" type="button" disabled={settingsBusy||!eventName.trim()} onClick={saveSettings}>{settingsBusy?'儲存中…':'儲存設定'}</button></article>
      <article className="admin-card"><div className="card-head"><div><p>步驟 2</p><h3>匯入賓客名單</h3></div><span>{state.guests.length} 組賓客</span></div><p className="card-copy">可重新匯入修正名單；系統會保留已接待的實到、紅包與領餅紀錄。</p><div className="import-actions"><input ref={fileRef} hidden type="file" accept=".xlsx,.csv" onChange={e=>e.target.files?.[0]&&onFile(e.target.files[0])}/><button className="primary" type="button" disabled={importBusy} onClick={()=>fileRef.current?.click()}>選擇 Excel 檔</button><label className="sheet-url"><span>Google Sheet 網址</span><div><input placeholder="貼上 Admin 可存取的試算表網址" value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} /><button type="button" disabled={importBusy||!sheetUrl.trim()} onClick={()=>onGoogleSheet(sheetUrl)}>{importBusy?'讀取中…':'讀取'}</button></div></label></div>{importFeedback&&<div className={`import-feedback ${importFeedback.tone}`} role="status">{importBusy&&<span className="spinner"/>}{importFeedback.text}</div>}
      {imported&&summary&&<div className="import-preview"><div><b>{sourceName}</b><span>匯入前確認</span></div><section><span><b>+{summary.added.length}</b>新增</span><span><b>{summary.changed.length}</b>更新</span><span><b>−{summary.removed.length}</b>移除</span><span><b>{summary.unchanged}</b>不變</span></section>{imported.diagnostics.warnings.length>0&&<div className="import-warnings">{imported.diagnostics.warnings.map(w=><p key={w}>⚠ {w}</p>)}</div>}<GuestDataTable guests={imported.guests} compact /><div className="action-row"><button className="secondary" type="button" disabled={importBusy} onClick={cancelImport}>取消</button><button className="primary" type="button" disabled={importBusy} onClick={applyImport}>{importBusy?'同步中…':'確認匯入並同步'}</button></div></div>}</article>
      <article className="admin-card close-card"><div><p>步驟 3</p><h3>{state.settings.receptionOpen?'接待目前開放':'接待目前關閉'}</h3><span>關閉後接待人員與婚顧都不能進入，只有 Admin 可查看資料。</span></div><button className={state.settings.receptionOpen?'danger':'primary'} type="button" disabled={settingsBusy} onClick={toggleReception}>{state.settings.receptionOpen?'關閉接待':'重新開放接待'}</button></article>
    </div>}

    {section==='guests'&&<article className="admin-card guest-data-card"><div className="card-head"><div><p>已儲存名單</p><h3>確認匯入後的資料</h3></div><span>{state.settings.importSource||'尚無匯入來源'}</span></div>{state.settings.importedAt&&<p className="card-copy">最近匯入：{new Date(state.settings.importedAt).toLocaleString('zh-TW')}</p>}<div className="guest-table-search"><input value={guestQuery} onChange={e=>setGuestQuery(e.target.value)} placeholder="搜尋賓客、分類、電話或桌次"/><b>{filteredGuests.length} 組</b></div>{filteredGuests.length?<GuestDataTable guests={filteredGuests}/>:<Empty title="找不到賓客" copy="請更換搜尋文字或先到設定匯入名單。"/>}</article>}

    {section==='staff'&&<article className="admin-card"><div className="card-head"><div><p>工作人員入口</p><h3>連結與 PIN 分開提供</h3></div><span>{state.settings.eventName}</span></div><p className="card-copy">接待開放期間兩個入口都可使用；關閉接待後會一起停用。</p><div className="access-row"><div><b>接待人員</b><span>可接待、修改與看總覽</span></div><button type="button" onClick={()=>onCopyRoleLink('reception')}>複製入口</button><code>PIN {state.settings.receptionPin}</code></div><div className="access-row"><div><b>婚顧</b><span>唯讀查看現場總覽</span></div><button type="button" onClick={()=>onCopyRoleLink('planner')}>複製入口</button><code>PIN {state.settings.plannerPin}</code></div></article>}

    {section==='reports'&&<div className="admin-stack"><article className="admin-card report-card"><div className="card-head"><div><p>完整接待報表</p><h3>婚宴結束後核對名單</h3></div><span>只有 Admin 可匯出</span></div><p className="card-copy">包含應到與實到、素食、兒童椅、喜餅、紅包、接待人員及完成時間。</p><div className="report-action"><div><strong>{completed.length}<small>／{state.guests.length} 組</small></strong><span>已完成接待</span></div><button className="primary" type="button" onClick={exportReceptionCsv}>匯出完整接待 CSV</button></div></article><article className="admin-card gift-report"><div className="card-head"><div><p>禮金報表</p><h3>已登記禮金</h3></div><span>只有 Admin 可匯出</span></div><div className="gift-summary"><div><span>已填金額</span><strong>${money.format(giftTotal)}</strong></div><div><span>收到紅包</span><strong>{completed.filter(g=>g.giftReceived).length}<small> 組</small></strong></div><button className="primary" type="button" onClick={exportGiftCsv}>匯出禮金 CSV</button></div></article></div>}
  </section>;
}

function GuestDataTable({guests,compact=false}:{guests:GuestGroup[];compact?:boolean}) {
  return <div className={`guest-data-wrap ${compact?'compact':''}`}><table className="guest-data-table"><thead><tr><th>賓客</th><th>分類</th><th>電話</th><th>應到</th><th>桌次</th><th>素食</th><th>兒童椅</th><th>中式餅</th><th>西式餅</th><th>狀態</th></tr></thead><tbody>{guests.map(g=><tr key={g.id}><td data-label="賓客"><b>{g.name}</b></td><td data-label="分類">{g.category}</td><td data-label="電話">{g.phone||'—'}</td><td data-label="應到">{g.expected}</td><td data-label="桌次">{formatTables(g)}</td><td data-label="素食">{g.vegetarianExpected}</td><td data-label="兒童椅">{g.childChairExpected}</td><td data-label="中式餅">{g.cakeChinesePlanned}</td><td data-label="西式餅">{g.cakeWesternPlanned}</td><td data-label="狀態">{g.completed?'已接待':'等待'}</td></tr>)}</tbody></table></div>;
}

function Empty({title,copy}:{title:string;copy:string}) { return <div className="empty"><span aria-hidden="true">○</span><h3>{title}</h3><p>{copy}</p></div>; }
function ClosedScreen({eventName}:{eventName:string}) { return <main className="closed-screen"><div><p className="eyebrow">{eventName}</p><h1>好日子迎賓</h1><span>本場婚宴接待已關閉</span><p>如需查看資料，請由 Admin 登入報表。</p></div></main>; }
function LoadingScreen({slow,onRetry}:{slow:boolean;onRetry:()=>void}) { return <main className="closed-screen"><div><p className="eyebrow">正在準備</p><h1>好日子迎賓</h1><span>{slow?'Google 回應較慢，仍在重新連線…':'載入婚宴資料中…'}</span>{slow&&<><p>婚宴資料仍保存在 Google Drive，不會因載入較慢而消失。</p><button className="secondary loading-retry" type="button" onClick={onRetry}>重新連線</button></>}</div></main>; }

function EntryScreen({onAdmin,onDemo}:{onAdmin:()=>void;onDemo:()=>void}) {
  return <main className="entry-screen"><section className="entry-card"><div className="entry-brand"><span aria-hidden="true">囍</span><p className="eyebrow">婚宴當日接待</p><h1>好日子迎賓</h1><p>先選擇要管理正式婚宴，或使用虛構資料看看操作方式。</p></div><div className="entry-choices"><button className="entry-choice admin-choice" type="button" onClick={onAdmin}><span>管理</span><div><h2>管理我的婚宴</h2><p>使用 Google 帳號建立婚宴、匯入名單與分享工作人員入口。</p></div><i aria-hidden="true">›</i></button><button className="entry-choice demo-choice" type="button" onClick={onDemo}><span>示範</span><div><h2>查看示範</h2><p>只使用虛構賓客與本機資料，不會連接 Google Drive。</p></div><i aria-hidden="true">›</i></button></div><small className="privacy-note">正式資料只會在管理者登入並選定婚宴後載入；工作人員不會取得 Google Drive 權限。<br/><a href="privacy.html">查看隱私權說明</a></small></section></main>;
}

type GoogleIdentityApi = { accounts:{ id:{ initialize:(config:{client_id:string;callback:(response:{credential:string})=>void})=>void; renderButton:(element:HTMLElement,options:Record<string,unknown>)=>void } } };

function AdminSignIn({message,onBack,onAuthenticated}:{message:string;onBack:()=>void;onAuthenticated:(identity:AdminIdentity)=>void}) {
  const [error,setError]=useState(message);
  const [busy,setBusy]=useState(false);
  const googleButton=useRef<HTMLDivElement>(null);
  const authCallback=useRef(onAuthenticated);
  const configured=hasCloudBackend()&&Boolean(googleClientId);

  useEffect(()=>{authCallback.current=onAuthenticated;},[onAuthenticated]);

  useEffect(()=>{
    if(!configured||!googleButton.current)return;
    const render=()=>{
      const google=(window as unknown as {google?:GoogleIdentityApi}).google;
      if(!google||!googleButton.current)return;
      googleButton.current.replaceChildren();
      google.accounts.id.initialize({client_id:googleClientId,callback:async(response)=>{
        setBusy(true);setError('');
        try{const result=await listAdminEvents(response.credential);authCallback.current({idToken:response.credential,email:result.adminEmail,events:result.events});}
        catch(e){setError(e instanceof Error?e.message:'Google 登入失敗');setBusy(false);}
      }});
      google.accounts.id.renderButton(googleButton.current,{theme:'outline',size:'large',shape:'pill',text:'continue_with',locale:'zh_TW',width:300});
    };
    if((window as unknown as {google?:GoogleIdentityApi}).google){render();return;}
    let script=document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if(!script){script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.dataset.googleIdentity='true';document.head.appendChild(script);}
    script.addEventListener('load',render,{once:true});
    return()=>script?.removeEventListener('load',render);
  },[configured]);

  return <main className="entry-screen"><section className="entry-card signin-card"><button className="entry-back" type="button" onClick={onBack}>‹ 返回首頁</button><div className="entry-brand compact"><span aria-hidden="true">管</span><p className="eyebrow">管理者專用</p><h1>連結 Google 帳號</h1><p>登入後才會顯示你的婚宴列表，也才能匯入 Google Sheet 與建立工作人員入口。</p></div><div ref={googleButton} className="google-button" />{busy&&<div className="signin-progress">正在讀取你的婚宴…</div>}{!configured&&<div className="config-note"><b>Google 連線尚未啟用</b><span>目前仍可返回首頁查看示範；正式啟用時會在這裡出現 Google 登入按鈕。</span></div>}{error&&<div className="login-error">{error}</div>}<small className="privacy-note">只接受預先指定的管理者帳號；不會把 Google 密碼或 Drive 權限交給接待人員。</small></section></main>;
}

function AdminHub({identity,onOpen,onCreate,onBack}:{identity:AdminIdentity;onOpen:(eventCode:string)=>Promise<void>;onCreate:(eventName:string)=>Promise<void>;onBack:()=>void}) {
  const [showCreate,setShowCreate]=useState(identity.events.length===0);
  const [eventName,setEventName]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const runOpen=async(code:string)=>{setBusy(code);setError('');try{await onOpen(code);}catch(e){setError(e instanceof Error?e.message:'無法開啟婚宴');setBusy('');}};
  const runCreate=async()=>{if(!eventName.trim())return setError('請填寫婚宴名稱');setBusy('create');setError('');try{await onCreate(eventName.trim());}catch(e){setError(e instanceof Error?e.message:'無法建立婚宴');setBusy('');}};
  return <main className="entry-screen hub-screen"><section className="hub-card"><header className="hub-header"><div><p className="eyebrow">管理者・{identity.email}</p><h1>選擇婚宴</h1><p>每場婚宴都有獨立的 Google Drive 資料夾、試算表、代碼與工作人員 PIN。</p></div><button className="secondary" type="button" onClick={onBack}>登出</button></header><div className="event-list">{identity.events.map(event=><button className="event-card" type="button" key={event.eventCode} disabled={Boolean(busy)} onClick={()=>runOpen(event.eventCode)}><div><span className={event.receptionOpen?'open':'closed'}>{event.receptionOpen?'接待開放中':'接待已關閉'}</span><h2>{event.eventName}</h2><p>{event.guestCount} 組賓客・已接待 {event.completedCount} 組</p></div><strong>{event.eventCode}</strong><i aria-hidden="true">{busy===event.eventCode?'載入中…':'›'}</i></button>)}</div>{!identity.events.length&&!showCreate&&<Empty title="尚未建立婚宴" copy="建立第一場婚宴後，就會進入設定並匯入名單。" />}{showCreate?<section className="create-event"><div className="card-head"><div><p>建立新婚宴</p><h3>設定獨立的婚宴空間</h3></div>{identity.events.length>0&&<button type="button" onClick={()=>setShowCreate(false)}>取消</button>}</div><label className="field"><span>婚宴名稱</span><input value={eventName} onChange={e=>setEventName(e.target.value)} placeholder="例如：好日子正式婚宴" /></label><p className="card-copy">建立後會進入設定，引導您匯入名單並填寫中式、西式喜餅庫存。</p><button className="primary create-submit" type="button" disabled={busy==='create'||!eventName.trim()} onClick={runCreate}>{busy==='create'?'建立中…':'建立婚宴'}</button></section>:<button className="new-event-button" type="button" onClick={()=>setShowCreate(true)}>＋ 建立新婚宴</button>}{error&&<div className="login-error">{error}</div>}</section></main>;
}

function StaffGate({eventCode,role,message,onBack,onLogin}:{eventCode:string;role:Exclude<Role,'admin'>;message:string;onBack:()=>void;onLogin:(token:string,state:AppState)=>void}) {
  const [pin,setPin]=useState('');
  const [operator,setOperator]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(message);
  const [eventName,setEventName]=useState('');
  const title=role==='planner'?'婚顧現場總覽':'接待人員入口';
  useEffect(()=>{getEventInfo(eventCode).then(info=>setEventName(info.eventName)).catch(()=>undefined);},[eventCode]);
  const submit=async()=>{setBusy(true);setError('');try{const result=await callCloud<{token:string;state:AppState}>('login',{eventCode,role,pin,operator});onLogin(result.token,result.state);}catch(e){setError(e instanceof Error?e.message:'無法進入婚宴');setBusy(false);}};
  return <main className="entry-screen"><section className="entry-card signin-card"><button className="entry-back" type="button" onClick={onBack}>‹ 返回首頁</button><div className="entry-brand compact"><span aria-hidden="true">{role==='planner'?'覽':'迎'}</span>{eventName&&<h1 className="event-gate-name">{eventName}</h1>}<p className="eyebrow">婚宴代碼 {eventCode}</p><h2>{title}</h2><p>{role==='planner'?'輸入婚顧 PIN 後即可唯讀查看現場進度。':'輸入您的稱呼與接待 PIN，開始協助賓客報到。'}</p></div><div className="login-fields">{role==='reception'&&<label className="field"><span>您的稱呼</span><input value={operator} onChange={e=>setOperator(e.target.value)} placeholder="例如：接待 A" autoComplete="name" /></label>}<label className="field"><span>{role==='planner'?'婚顧':'接待'} PIN</span><input inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="4 位數" autoComplete="one-time-code" /></label><button className="primary login-submit" type="button" disabled={busy||pin.length!==4||(role==='reception'&&!operator.trim())||!hasCloudBackend()} onClick={submit}>{busy?'驗證中…':'進入婚宴'}</button></div>{!hasCloudBackend()&&<div className="config-note">Google 雲端連線尚未啟用，這個工作人員入口目前無法使用。</div>}{error&&<div className="login-error">{error}</div>}<small className="privacy-note">工作人員不需要 Google 或 ChatGPT 帳號，也不會取得管理者的 Google Drive 權限。</small></section></main>;
}
