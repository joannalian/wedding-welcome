'use client';

import { useEffect, useRef, useState } from 'react';
import { callCloud, createAdminEvent, hasCloudBackend, listAdminEvents, loadEvent, loginAdminEvent, saveEvent } from './api-client';
import { importSummary, matrixToGuests, readExcelFile } from './import-tools';
import { allocateActual, deriveStatus, formatTables, maskPhone, statusText, type AppState, type EventSummary, type GuestGroup, type MainTab, type Role } from './model';
import { googleClientId } from './public-config';
import { initialState } from './sample-data';

const DEMO_STORAGE_KEY = 'hao-ri-zi-ying-bin-demo-v2';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const money = new Intl.NumberFormat('zh-TW');
type Screen = 'loading' | 'landing' | 'admin-signin' | 'admin-hub' | 'staff-gate' | 'demo' | 'app';
type AdminIdentity = { idToken: string; email: string; events: EventSummary[] };

export default function Home() {
  const [state, setState] = useState<AppState>(() => clone(initialState));
  const [screen, setScreen] = useState<Screen>('loading');
  const [ready, setReady] = useState(false);
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
  const [imported, setImported] = useState<GuestGroup[] | null>(null);
  const [sourceName, setSourceName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const remoteSnapshot = useRef('');

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
      remoteSnapshot.current = JSON.stringify(remote); setState(remote); setSessionToken(token); setScreen('app'); setReady(true);
    }).catch((error) => {
      setCloudMessage(error instanceof Error ? error.message : '請重新登入');
      if (eventCode && (directRole === 'reception' || directRole === 'planner')) { setGateEventCode(eventCode); setGateRole(directRole); setScreen('staff-gate'); }
      else setScreen('landing');
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (ready && screen === 'demo') localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  }, [state, ready, screen]);

  useEffect(() => {
    if (!ready || screen !== 'app' || !hasCloudBackend() || !sessionToken || state.settings.role === 'planner') return;
    const serialized = JSON.stringify(state);
    if (serialized === remoteSnapshot.current) return;
    const timer = window.setTimeout(() => {
      saveEvent(state, sessionToken).then(() => { remoteSnapshot.current = serialized; }).catch((error) => setNotice(error instanceof Error ? error.message : '雲端儲存失敗'));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state, sessionToken, ready, screen]);

  useEffect(() => {
    if (screen !== 'app' || !hasCloudBackend() || !sessionToken || !state.settings.eventCode) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || draft) return;
      loadEvent(state.settings.eventCode, sessionToken).then((remote) => {
        const serialized = JSON.stringify(remote);
        if (serialized !== remoteSnapshot.current) { remoteSnapshot.current = serialized; setState(remote); }
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(poll);
  }, [sessionToken, state.settings.eventCode, draft, screen]);

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
    remoteSnapshot.current = JSON.stringify(remote); setSessionToken(token); setState(remote); setScreen('app'); setTab(remote.settings.role === 'planner' ? 'dashboard' : 'reception');
    const params = new URLSearchParams({ event:remote.settings.eventCode });
    if (remote.settings.role !== 'admin') params.set('role', remote.settings.role);
    sessionStorage.setItem(`hao-ri-zi-token-${remote.settings.eventCode}`, token); replaceQuery(params);
  };

  const openAdminEvent = async (eventCode: string) => {
    if (!adminIdentity) throw new Error('請重新使用 Google 帳號登入');
    const result = await loginAdminEvent(eventCode, adminIdentity.idToken); activateSession(result.token, result.state);
  };

  const createAndOpenEvent = async (eventName: string, cakeStock: number) => {
    if (!adminIdentity) throw new Error('請重新使用 Google 帳號登入');
    const created = await createAdminEvent(eventName, cakeStock, adminIdentity.idToken);
    const result = await loginAdminEvent(created.state.settings.eventCode, adminIdentity.idToken); activateSession(result.token, result.state);
  };

  const openGuest = (guest: GuestGroup) => {
    const next = clone(guest);
    if (next.giftName === next.name) next.giftName = '';
    setDraft(next); setStep(1); setEditingAttendance(false); setEditingCake(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeGuest = () => { setDraft(null); setStep(1); };

  const setDraftValue = <K extends keyof GuestGroup>(key: K, value: GuestGroup[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

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
      setDraft({ ...draft, cakeDelivered: 0, cakeOwed: draft.cakePlanned });
    } else {
      const available = Math.max(0, state.settings.cakeStock - state.guests.reduce((sum, guest) => sum + (guest.id === draft.id ? 0 : guest.cakeDelivered), 0));
      const delivered = Math.min(draft.cakePlanned, available);
      setDraft({ ...draft, cakeDelivered: delivered, cakeOwed: Math.max(0, draft.cakePlanned - delivered) });
      if (delivered < draft.cakePlanned) setNotice('現場喜餅不足，已自動登記為欠餅');
    }
    setStep(4); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const finishReception = () => {
    if (!draft) return;
    const finished: GuestGroup = {
      ...draft, completed: true, completedAt: new Date().toISOString(), completedBy: state.settings.operator,
      vegetarianActual: Math.min(draft.vegetarianActual || draft.vegetarianExpected, draft.actual),
      childChairActual: Math.min(draft.childChairActual || draft.childChairExpected, draft.actual), updatedAt: new Date().toISOString(),
    };
    setState((current) => ({ ...current, guests: current.guests.map((guest) => guest.id === finished.id ? finished : guest) }));
    setNotice(`${finished.name} 已完成接待`); closeGuest(); setQuery(''); setTab('reception');
  };

  const cancelReception = (guest: GuestGroup) => {
    if (!window.confirm(`要取消「${guest.name}」的已接待狀態嗎？`)) return;
    setState((current) => ({ ...current, guests: current.guests.map((item) => item.id === guest.id ? {
      ...item, actual: 0, vegetarianActual: 0, childChairActual: 0, cakeDelivered: 0, cakeOwed: 0,
      giftReceived: false, bagNamed: false, giftName: '', giftAmount: null, note: '',
      completed: false, completedAt: null, completedBy: '', updatedAt: new Date().toISOString(),
    } : item) }));
    setNotice(`${guest.name} 已回到等待接待`); closeGuest();
  };

  const handleImport = async (file: File) => {
    try {
      const guests = await readExcelFile(file);
      if (!guests.length) throw new Error('沒有找到可匯入的賓客資料');
      setImported(guests); setSourceName(file.name);
    } catch (error) { setNotice(error instanceof Error ? error.message : '無法讀取檔案'); }
  };

  const handleGoogleSheet = async (url: string) => {
    try {
      const result = await callCloud<{ title:string; values:unknown[][] }>('readGoogleSheet', { eventCode:state.settings.eventCode, token:sessionToken, url });
      const guests = matrixToGuests(result.values);
      if (!guests.length) throw new Error('試算表中沒有找到賓客資料');
      setImported(guests); setSourceName(result.title);
    } catch (error) { setNotice(error instanceof Error ? error.message : '無法讀取 Google Sheet'); }
  };

  const applyImport = () => {
    if (!imported) return;
    if (completed.length) { setNotice('已有接待紀錄，為避免覆蓋現場資料，無法整批重新匯入'); return; }
    setState((current) => ({ ...current, guests: imported }));
    setImported(null); setNotice(`已匯入 ${imported.length} 組賓客`);
  };

  const exportGiftCsv = () => {
    const header = ['賓客','分類','紅包編號','禮金金額','袋上有編號或姓名','備註','接待人員','完成時間'];
    const rows = completed.map((guest) => [guest.name,guest.category,guest.giftName,guest.giftAmount ?? '',guest.bagNamed?'是':'否',guest.note,guest.completedBy,guest.completedAt || '']);
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"','""')}"`;
    const blob = new Blob(['\ufeff' + [header,...rows].map((row) => row.map(escape).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.settings.eventName}_禮金紀錄.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const tabs: { key: MainTab; label: string; count?: number }[] = role === 'planner'
    ? [{ key:'dashboard', label:'現場總覽' }]
    : [{ key:'reception', label:'接待賓客', count:waiting.length }, { key:'completed', label:'已接待', count:completed.length }, { key:'dashboard', label:'現場總覽' }, ...(!isDemo && role === 'admin' ? [{ key:'admin' as MainTab, label:'管理' }] : [])];

  if (!ready) return <LoadingScreen />;
  if (screen === 'landing') return <EntryScreen onAdmin={()=>setScreen('admin-signin')} onDemo={enterDemo} />;
  if (screen === 'admin-signin') return <AdminSignIn message={cloudMessage} onBack={()=>setScreen('landing')} onAuthenticated={(identity)=>{ setAdminIdentity(identity); setScreen('admin-hub'); }} />;
  if (screen === 'admin-hub' && adminIdentity) return <AdminHub identity={adminIdentity} onOpen={openAdminEvent} onCreate={createAndOpenEvent} onBack={()=>{setAdminIdentity(null);setScreen('landing');}} />;
  if (screen === 'staff-gate') return <StaffGate eventCode={gateEventCode} role={gateRole} message={cloudMessage} onBack={()=>{replaceQuery();setScreen('landing');}} onLogin={activateSession} />;
  if (screen !== 'demo' && screen !== 'app') return <LoadingScreen />;
  if (!state.settings.receptionOpen && role !== 'admin') return <ClosedScreen eventName={state.settings.eventName} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">{state.settings.eventName}</p><h1>好日子迎賓</h1></div>
        <div className="top-actions">
          <span className={`sync ${!isDemo ? 'online' : ''}`}><i />{isDemo ? '虛構示範資料' : '已連接 Google Drive'}</span>
          <button className="operator" type="button" onClick={() => role === 'admin' && setTab('admin')}>{role === 'admin' ? 'Admin' : role === 'planner' ? '婚顧' : '接待'}・{state.settings.operator}</button>
          <button className="top-exit" type="button" onClick={returnHome}>{isDemo ? '離開示範' : role === 'admin' ? '切換婚宴' : '離開'}</button>
        </div>
      </header>

      <nav className="tabs" aria-label="主要功能">
        {tabs.map((item) => <button key={item.key} className={`tab ${tab === item.key ? 'active' : ''}`} type="button" onClick={() => { closeGuest(); setTab(item.key); setQuery(''); }}>
          {item.label}{typeof item.count === 'number' && <span>{item.count}</span>}
        </button>)}
      </nav>

      {tab === 'reception' && !draft && <GuestBrowser query={query} setQuery={setQuery} guests={candidates} hiddenCompletedMatch={hiddenCompletedMatch} onOpen={openGuest} />}
      {tab === 'completed' && !draft && <CompletedList query={query} setQuery={setQuery} guests={completedMatches} onOpen={openGuest} onCancel={cancelReception} />}
      {(tab === 'reception' || tab === 'completed') && draft && <ReceptionWizard guest={draft} step={step} editingAttendance={editingAttendance} editingCake={editingCake} isEdit={draft.completed} onBack={closeGuest} onChange={setDraftValue} onEditAttendance={setEditingAttendance} onEditCake={setEditingCake} onGoGift={goGift} onGoCake={goCake} onGoStep={setStep} onCake={confirmCake} onFinish={finishReception} onCancel={() => cancelReception(draft)} />}
      {tab === 'dashboard' && <Dashboard state={state} tableDetail={tableDetail} setTableDetail={setTableDetail} />}
      {tab === 'admin' && !isDemo && role === 'admin' && <AdminPanel state={state} setState={setState} completed={completed} imported={imported} sourceName={sourceName} fileRef={fileRef} onFile={handleImport} onGoogleSheet={handleGoogleSheet} applyImport={applyImport} cancelImport={() => setImported(null)} exportGiftCsv={exportGiftCsv} onCopyRoleLink={async(roleToCopy)=>{ const url=`${location.origin}${location.pathname}?event=${encodeURIComponent(state.settings.eventCode)}&role=${roleToCopy}`; await navigator.clipboard.writeText(url); setNotice(roleToCopy==='reception'?'已複製接待人員連結':'已複製婚顧連結'); }} />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function GuestBrowser({ query, setQuery, guests, hiddenCompletedMatch, onOpen }:{ query:string; setQuery:(value:string)=>void; guests:GuestGroup[]; hiddenCompletedMatch?:GuestGroup; onOpen:(guest:GuestGroup)=>void }) {
  return <section className="content guest-browser">
    <SearchCard query={query} setQuery={setQuery} />
    {hiddenCompletedMatch && <div className="already-notice"><b>{hiddenCompletedMatch.name}</b> 已完成接待，請到「已接待」查看或修改。</div>}
    <div className="list-heading"><div><h2>等待接待</h2><p>選擇賓客後，才會開啟接待資訊。</p></div><strong>{guests.length} 組</strong></div>
    <div className="guest-grid">{guests.map((guest) => <GuestCard key={guest.id} guest={guest} onOpen={onOpen} />)}</div>
    {!guests.length && <Empty title="找不到等待接待的賓客" copy="請確認名稱或電話末三碼；已完成者不會出現在這裡。" />}
  </section>;
}

function SearchCard({ query, setQuery }:{ query:string; setQuery:(value:string)=>void }) {
  return <div className="search-card"><label htmlFor="guest-search">尋找賓客</label><p>可輸入賓客名稱、分類、桌次或電話末三碼</p><div className="search-row"><span aria-hidden="true">⌕</span><input id="guest-search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="例如：小明、同事、002" autoComplete="off" autoFocus /><button className={query ? '' : 'invisible'} type="button" onClick={()=>setQuery('')}>清除</button></div></div>;
}

function GuestCard({ guest, onOpen }:{ guest:GuestGroup; onOpen:(guest:GuestGroup)=>void }) {
  return <button className="guest-card" type="button" onClick={()=>onOpen(guest)}><div className="guest-main"><span className="avatar" aria-hidden="true">{guest.name.slice(0,1)}</span><div><h3>{guest.name}</h3><p>{guest.category}・{maskPhone(guest.phone)}</p></div></div><div className="guest-meta"><span>應到 <b>{guest.expected}</b> 位</span><span>{formatTables(guest)}</span><i aria-hidden="true">›</i></div></button>;
}

function CompletedList({ query, setQuery, guests, onOpen, onCancel }:{ query:string; setQuery:(value:string)=>void; guests:GuestGroup[]; onOpen:(guest:GuestGroup)=>void; onCancel:(guest:GuestGroup)=>void }) {
  return <section className="content"><SearchCard query={query} setQuery={setQuery} /><div className="list-heading"><div><h2>已接待賓客</h2><p>可重新開啟並修正人數、紅包或喜餅紀錄。</p></div><strong>{guests.length} 組</strong></div><div className="completed-list">{guests.map((guest)=><article className="completed-row" key={guest.id}><div><span className={`status-chip ${deriveStatus(guest)}`}>{statusText(deriveStatus(guest))}</span><h3>{guest.name}</h3><p>實到 {guest.actual}／應到 {guest.expected} 位・{formatTables(guest)}</p></div><div className="completed-facts"><span>{guest.giftReceived ? `紅包${guest.giftAmount ? ` $${money.format(guest.giftAmount)}` : '（未填金額）'}` : '未收紅包'}</span><span>{guest.cakePlanned ? (guest.cakeOwed ? `欠餅 ${guest.cakeOwed} 盒` : `喜餅已領 ${guest.cakeDelivered} 盒`) : '不需喜餅'}</span></div><div className="row-actions"><button type="button" onClick={()=>onOpen(guest)}>修改</button><button className="danger-link" type="button" onClick={()=>onCancel(guest)}>取消接待</button></div></article>)}</div>{!guests.length&&<Empty title="尚無已接待賓客" copy="完成第一組接待後，紀錄會出現在這裡。" />}</section>;
}

type WizardProps = { guest:GuestGroup; step:number; editingAttendance:boolean; editingCake:boolean; isEdit:boolean; onBack:()=>void; onChange:<K extends keyof GuestGroup>(key:K,value:GuestGroup[K])=>void; onEditAttendance:(value:boolean)=>void; onEditCake:(value:boolean)=>void; onGoGift:()=>void; onGoCake:()=>void; onGoStep:(step:number)=>void; onCake:(received:boolean)=>void; onFinish:()=>void; onCancel:()=>void };
function ReceptionWizard(props:WizardProps) {
  const { guest, step, editingAttendance, editingCake, isEdit, onBack, onChange, onEditAttendance, onEditCake, onGoGift, onGoCake, onGoStep, onCake, onFinish, onCancel } = props;
  return <section className="content reception-card"><button className="back" type="button" onClick={onBack}>‹ 返回{isEdit?'已接待':'賓客列表'}</button><div className="selected-title"><h2>{guest.name}</h2></div><Progress step={step} />
    <div className="wizard-panel">
      {step===1&&<><div className="section-title"><h3>確認賓客的到場人數</h3></div><div className="expected-count"><span>名單應到</span><strong>{guest.expected}</strong><span>位</span></div>{editingAttendance&&<div className="edit-box"><NumberField label="實到人數" value={guest.actual} onChange={(value)=>onChange('actual',value)} max={99} /><NumberField label={`其中素食（原定 ${guest.vegetarianExpected}）`} value={guest.vegetarianActual} onChange={(value)=>onChange('vegetarianActual',value)} max={guest.actual||99} /><NumberField label={`其中兒童椅（原定 ${guest.childChairExpected}）`} value={guest.childChairActual} onChange={(value)=>onChange('childChairActual',value)} max={guest.actual||99} /></div>}<div className="action-row"><button className="secondary" type="button" onClick={()=>{ onEditAttendance(!editingAttendance); if(!editingAttendance){onChange('actual',guest.actual||guest.expected);onChange('vegetarianActual',guest.vegetarianActual||guest.vegetarianExpected);onChange('childChairActual',guest.childChairActual||guest.childChairExpected);} }}>{editingAttendance?'收起修改':'修改實到人數'}</button><button className="primary" type="button" onClick={()=>{ if(!editingAttendance){onChange('actual',guest.expected);onChange('vegetarianActual',guest.vegetarianExpected);onChange('childChairActual',guest.childChairExpected);} window.setTimeout(onGoGift,0); }}>{editingAttendance?`確認 ${guest.actual} 位已到`:`確認 ${guest.expected} 位已到`}</button></div></>}
      {step===2&&<><SectionTitle step="步驟 2・紅包" title="登記紅包" copy="沒有紅包也可以直接前往下一步。" prominent /><div className="check-stack"><label className="check-card"><input type="checkbox" checked={guest.giftReceived} onChange={(event)=>onChange('giftReceived',event.target.checked)} /><span><b>已收到紅包</b><small>確認有人收下這個賓客的紅包</small></span></label>{guest.giftReceived&&<><label className="check-card warning"><input type="checkbox" checked={guest.bagNamed} onChange={(event)=>onChange('bagNamed',event.target.checked)} /><span><b>已確認袋上有編號或姓名</b><small>未勾選時，下一步會再次提醒</small></span></label><label className="field"><span>紅包編號</span><input inputMode="numeric" placeholder="例如：023" value={guest.giftName} onChange={(event)=>onChange('giftName',event.target.value)} /></label><label className="field"><span>禮金金額（可不填）</span><input inputMode="numeric" placeholder="留白即可" value={guest.giftAmount??''} onChange={(event)=>onChange('giftAmount',event.target.value===''?null:Number(event.target.value))} /></label></>}<label className="field"><span>備註（可不填）</span><textarea placeholder="例如：同一賓客另有一個紅包" value={guest.note} onChange={(event)=>onChange('note',event.target.value)} /></label></div><div className="action-row"><button className="secondary" type="button" onClick={()=>onGoStep(1)}>上一步</button><button className="primary" type="button" onClick={onGoCake}>{guest.giftReceived?'完成紅包登記':'沒有紅包，繼續'}</button></div></>}
      {step===3&&<><div className="section-title"><h3>確認喜餅領取</h3></div><div className="cake-display"><div className="cake-content"><span>{guest.cakeType}</span>{guest.cakePlanned>0&&<><strong>{guest.cakePlanned}</strong><span>盒</span></>}</div></div>{guest.cakePlanned>0&&<button className="inline-edit" type="button" onClick={()=>onEditCake(!editingCake)}>{editingCake?'收起修改':'修改數量'}</button>}{editingCake&&<div className="edit-box cake-edit"><NumberField label="本次應領數量" value={guest.cakePlanned} onChange={(value)=>onChange('cakePlanned',value)} max={20} /></div>}<div className="action-row"><button className="secondary" type="button" onClick={()=>onGoStep(2)}>上一步</button>{guest.cakePlanned>0?<button className="primary" type="button" onClick={()=>onCake(true)}>確認領餅</button>:<button className="primary" type="button" onClick={()=>onCake(false)}>不需領餅，繼續</button>}</div>{guest.cakePlanned>0&&<button className="rare-action" type="button" onClick={()=>{if(window.confirm(`確定要登記欠餅 ${guest.cakePlanned} 盒嗎？`))onCake(false);}}>喜餅不足？登記欠餅</button>}</>}
      {step===4&&<><SectionTitle step="步驟 4・桌次" title="告知賓客入席桌次" copy="請向賓客清楚說明座位，再完成接待。" /><div className="table-display">{guest.tables.length?guest.tables.map((table)=><div key={table.table}><strong>{table.table}</strong>{guest.tables.length>1&&<span>安排 {table.planned} 位</span>}</div>):<div><strong>待安排</strong></div>}</div>{guest.cakeOwed>0&&<div className="owed-banner">已登記欠餅 {guest.cakeOwed} 盒</div>}<div className="action-row"><button className="secondary" type="button" onClick={()=>onGoStep(3)}>上一步</button><button className="primary finish" type="button" onClick={onFinish}>{isEdit?'儲存修改':'完成接待'}</button></div>{isEdit&&<button className="cancel-reception" type="button" onClick={onCancel}>取消此賓客的接待紀錄</button>}</>}
    </div>
  </section>;
}

function Progress({ step }:{step:number}) { const labels=['人數','紅包','喜餅','桌次']; return <div className="stepper" aria-label={`接待進度：第 ${step} 步`}>{labels.map((label,index)=><div className={`${index+1===step?'current':''} ${index+1<step?'done':''}`} key={label}><b>{index+1<step?'✓':index+1}</b><span>{label}</span></div>)}</div>; }
function SectionTitle({ step,title,copy,prominent=false }:{step:string;title:string;copy:string;prominent?:boolean}) { return <div className="section-title"><p>{step}</p><h3>{title}</h3><span className={prominent?'prominent':''}>{copy}</span></div>; }
function NumberField({ label,value,onChange,max }:{label:string;value:number;onChange:(value:number)=>void;max:number}) { return <label className="number-field"><span>{label}</span><div><button type="button" onClick={()=>onChange(Math.max(0,value-1))}>−</button><input inputMode="numeric" value={value} onChange={(event)=>onChange(Math.min(max,Math.max(0,Number(event.target.value)||0)))} /><button type="button" onClick={()=>onChange(Math.min(max,value+1))}>＋</button></div></label>; }

function Dashboard({ state, tableDetail, setTableDetail }:{state:AppState;tableDetail:string|null;setTableDetail:(value:string|null)=>void}) {
  const expected=state.guests.reduce((sum,guest)=>sum+guest.expected,0), actual=state.guests.reduce((sum,guest)=>sum+guest.actual,0), completed=state.guests.filter((guest)=>guest.completed).length;
  const cakePlanned=state.guests.reduce((sum,guest)=>sum+guest.cakePlanned,0), cakeDelivered=state.guests.reduce((sum,guest)=>sum+guest.cakeDelivered,0), cakeOwed=state.guests.reduce((sum,guest)=>sum+guest.cakeOwed,0);
  const tables = new Map<string,{planned:number;actual:number;guests:GuestGroup[];estimated:boolean}>();
  state.guests.forEach((guest)=>allocateActual(guest).forEach((item)=>{ const old=tables.get(item.table)||{planned:0,actual:0,guests:[],estimated:false}; tables.set(item.table,{planned:old.planned+item.planned,actual:old.actual+item.actual,guests:[...old.guests,guest],estimated:old.estimated||(guest.tables.length>1&&guest.actual>0&&guest.actual<guest.expected)}); }));
  const selected=tableDetail?tables.get(tableDetail):null;
  return <section className="content dashboard"><div className="dashboard-heading"><div><p className="eyebrow">即時更新</p><h2>現場總覽</h2></div><span>{state.settings.receptionOpen?'接待進行中':'接待已關閉'}</span></div><div className="metrics"><Metric label="總報到率" value={`${expected?Math.round(actual/expected*100):0}%`} detail={`實到 ${actual}／應到 ${expected} 位`} tone="rose" /><Metric label="完成接待" value={`${completed}`} unit="組" detail={`尚有 ${state.guests.length-completed} 組`} tone="sage" /><Metric label="喜餅領取" value={`${cakeDelivered}`} unit="盒" detail={`原定 ${cakePlanned} 盒${cakeOwed?`・欠 ${cakeOwed} 盒`:''}`} tone="gold" /></div><div className="progress-row"><span style={{width:`${Math.min(100,expected?actual/expected*100:0)}%`}} /></div><div className="list-heading"><div><h2>各桌到場概況</h2><p>點選桌次，可查看哪些賓客已到或未到。</p></div><strong>{tables.size} 桌</strong></div><div className="table-grid">{[...tables].sort((a,b)=>a[0].localeCompare(b[0],'zh-Hant',{numeric:true})).map(([name,data])=><button type="button" className="table-card" key={name} onClick={()=>setTableDetail(name)}><div><h3>{name}</h3>{data.estimated&&<span>含估算</span>}</div><strong>{data.actual}<small>／{data.planned} 位</small></strong><p>未到 {Math.max(0,data.planned-data.actual)} 位</p><i><span style={{width:`${Math.min(100,data.planned?data.actual/data.planned*100:0)}%`}} /></i></button>)}</div>{selected&&<div className="modal-backdrop" onMouseDown={()=>setTableDetail(null)}><div className="modal" onMouseDown={(event)=>event.stopPropagation()}><button className="modal-close" type="button" onClick={()=>setTableDetail(null)}>×</button><p className="eyebrow">桌次詳情</p><h2>{tableDetail}</h2>{selected.estimated&&<div className="estimate-note">跨桌賓客的部分抵達人數，已依原定座位比例均攤估算。</div>}<div className="table-guest-list">{selected.guests.map((guest)=><div key={guest.id}><span className={`status-dot ${deriveStatus(guest)}`} /><div><b>{guest.name}</b><small>{statusText(deriveStatus(guest))}</small></div><strong>{guest.actual}／{guest.expected} 位</strong></div>)}</div></div></div>}</section>;
}

function Metric({label,value,unit,detail,tone}:{label:string;value:string;unit?:string;detail:string;tone:string}) { return <article className={`metric ${tone}`}><p>{label}</p><strong>{value}<small>{unit}</small></strong><span>{detail}</span></article>; }

type AdminProps={state:AppState;setState:React.Dispatch<React.SetStateAction<AppState>>;completed:GuestGroup[];imported:GuestGroup[]|null;sourceName:string;fileRef:React.RefObject<HTMLInputElement|null>;onFile:(file:File)=>void;onGoogleSheet:(url:string)=>void;applyImport:()=>void;cancelImport:()=>void;exportGiftCsv:()=>void;onCopyRoleLink:(role:'reception'|'planner')=>void};
function AdminPanel({state,setState,completed,imported,sourceName,fileRef,onFile,onGoogleSheet,applyImport,cancelImport,exportGiftCsv,onCopyRoleLink}:AdminProps) {
  const [sheetUrl,setSheetUrl]=useState('');
  const summary=imported?importSummary(state.guests,imported):null;
  const giftTotal=completed.reduce((sum,guest)=>sum+(guest.giftAmount||0),0);
  const updateSettings=<K extends keyof AppState['settings']>(key:K,value:AppState['settings'][K])=>setState((current)=>({...current,settings:{...current.settings,[key]:value}}));
  return <section className="content admin-page"><div className="dashboard-heading"><div><p className="eyebrow">僅 Admin 可見</p><h2>婚宴管理</h2></div><span className={state.settings.receptionOpen?'open':'closed'}>{state.settings.receptionOpen?'接待開放中':'接待已關閉'}</span></div><div className="admin-grid"><article className="admin-card wide"><div className="card-head"><div><p>賓客名單</p><h3>匯入 Excel 或 Google Sheet</h3></div><span>{state.guests.length} 組賓客</span></div><p className="card-copy">接待開始前可重新匯入並先看差異；一旦有接待紀錄，就會停止整批覆蓋。</p><div className="import-actions"><input ref={fileRef} hidden type="file" accept=".xlsx,.csv" onChange={(event)=>event.target.files?.[0]&&onFile(event.target.files[0])}/><button className="primary" type="button" onClick={()=>fileRef.current?.click()}>選擇 Excel 檔</button><label className="sheet-url"><span>Google Sheet 網址</span><div><input placeholder="貼上 Admin 可存取的試算表網址" value={sheetUrl} onChange={(event)=>setSheetUrl(event.target.value)}/><button type="button" disabled={!sheetUrl.trim()} onClick={()=>onGoogleSheet(sheetUrl)}>讀取</button></div><small>由已登入的 Admin 帳號讀取，不會把試算表網址提供給工作人員。</small></label></div>{summary&&<div className="import-preview"><div><b>{sourceName}</b><span>匯入前確認差異</span></div><section><span><b>+{summary.added.length}</b>新增</span><span><b>{summary.changed.length}</b>更新</span><span><b>−{summary.removed.length}</b>移除</span><span><b>{summary.unchanged}</b>不變</span></section><div className="action-row"><button className="secondary" type="button" onClick={cancelImport}>取消</button><button className="primary" type="button" onClick={applyImport}>確認重新匯入</button></div></div>}</article><article className="admin-card"><div className="card-head"><div><p>婚宴資料</p><h3>場次設定</h3></div><span>{state.settings.eventCode}</span></div><label className="field"><span>婚宴名稱</span><input value={state.settings.eventName} onChange={(event)=>updateSettings('eventName',event.target.value)} /></label><label className="field"><span>現場喜餅庫存</span><input inputMode="numeric" value={state.settings.cakeStock} onChange={(event)=>updateSettings('cakeStock',Number(event.target.value)||0)} /></label><label className="field"><span>管理者 Google 帳號</span><input value={state.settings.operator} readOnly /></label></article><article className="admin-card"><div className="card-head"><div><p>工作人員入口</p><h3>連結與 PIN 分開提供</h3></div><span>婚宴代碼 {state.settings.eventCode}</span></div><div className="access-row"><div><b>接待人員</b><span>可接待、修改與看總覽</span></div><button type="button" onClick={()=>onCopyRoleLink('reception')}>複製入口</button><code>PIN {state.settings.receptionPin}</code></div><div className="access-row"><div><b>婚顧</b><span>唯讀查看現場總覽</span></div><button type="button" disabled={!state.settings.plannerEnabled} onClick={()=>onCopyRoleLink('planner')}>複製入口</button><code>PIN {state.settings.plannerPin}</code></div><label className="check-card compact"><input type="checkbox" checked={state.settings.plannerEnabled} onChange={(event)=>updateSettings('plannerEnabled',event.target.checked)} /><span><b>啟用婚顧入口</b><small>關閉後立即停用</small></span></label></article><article className="admin-card wide gift-report"><div className="card-head"><div><p>禮金報表</p><h3>已登記禮金</h3></div><span>只有 Admin 可匯出</span></div><div className="gift-summary"><div><span>已填金額</span><strong>${money.format(giftTotal)}</strong></div><div><span>收到紅包</span><strong>{completed.filter((guest)=>guest.giftReceived).length}<small> 組</small></strong></div><button className="primary" type="button" onClick={exportGiftCsv}>匯出 CSV</button></div></article><article className="admin-card wide close-card"><div><p>接待狀態</p><h3>{state.settings.receptionOpen?'關閉接待後，只有 Admin 可看報表':'目前只有 Admin 可以進入'}</h3><span>關閉不會刪除 Google Drive 中的任何資料。</span></div><button className={state.settings.receptionOpen?'danger':'primary'} type="button" onClick={()=>updateSettings('receptionOpen',!state.settings.receptionOpen)}>{state.settings.receptionOpen?'關閉接待':'重新開放接待'}</button></article></div></section>;
}

function Empty({title,copy}:{title:string;copy:string}) { return <div className="empty"><span aria-hidden="true">○</span><h3>{title}</h3><p>{copy}</p></div>; }
function ClosedScreen({eventName}:{eventName:string}) { return <main className="closed-screen"><div><p className="eyebrow">{eventName}</p><h1>好日子迎賓</h1><span>本場婚宴接待已關閉</span><p>如需查看資料，請由 Admin 登入報表。</p></div></main>; }
function LoadingScreen() { return <main className="closed-screen"><div><p className="eyebrow">正在準備</p><h1>好日子迎賓</h1><span>載入婚宴資料中…</span></div></main>; }

function EntryScreen({onAdmin,onDemo}:{onAdmin:()=>void;onDemo:()=>void}) {
  return <main className="entry-screen"><section className="entry-card"><div className="entry-brand"><span aria-hidden="true">囍</span><p className="eyebrow">婚宴當日接待</p><h1>好日子迎賓</h1><p>先選擇要管理正式婚宴，或使用虛構資料看看操作方式。</p></div><div className="entry-choices"><button className="entry-choice admin-choice" type="button" onClick={onAdmin}><span>管理</span><div><h2>管理我的婚宴</h2><p>使用 Google 帳號建立婚宴、匯入名單與分享工作人員入口。</p></div><i aria-hidden="true">›</i></button><button className="entry-choice demo-choice" type="button" onClick={onDemo}><span>示範</span><div><h2>查看示範</h2><p>只使用虛構賓客與本機資料，不會連接 Google Drive。</p></div><i aria-hidden="true">›</i></button></div><small className="privacy-note">正式資料只會在管理者登入並選定婚宴後載入；工作人員不會取得 Google Drive 權限。</small></section></main>;
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

function AdminHub({identity,onOpen,onCreate,onBack}:{identity:AdminIdentity;onOpen:(eventCode:string)=>Promise<void>;onCreate:(eventName:string,cakeStock:number)=>Promise<void>;onBack:()=>void}) {
  const [showCreate,setShowCreate]=useState(identity.events.length===0);
  const [eventName,setEventName]=useState('');
  const [cakeStock,setCakeStock]=useState(0);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const runOpen=async(code:string)=>{setBusy(code);setError('');try{await onOpen(code);}catch(e){setError(e instanceof Error?e.message:'無法開啟婚宴');setBusy('');}};
  const runCreate=async()=>{if(!eventName.trim())return setError('請填寫婚宴名稱');setBusy('create');setError('');try{await onCreate(eventName.trim(),cakeStock);}catch(e){setError(e instanceof Error?e.message:'無法建立婚宴');setBusy('');}};
  return <main className="entry-screen hub-screen"><section className="hub-card"><header className="hub-header"><div><p className="eyebrow">管理者・{identity.email}</p><h1>選擇婚宴</h1><p>每場婚宴都有獨立的 Google Drive 資料夾、試算表、代碼與工作人員 PIN。</p></div><button className="secondary" type="button" onClick={onBack}>登出</button></header><div className="event-list">{identity.events.map(event=><button className="event-card" type="button" key={event.eventCode} disabled={Boolean(busy)} onClick={()=>runOpen(event.eventCode)}><div><span className={event.receptionOpen?'open':'closed'}>{event.receptionOpen?'接待開放中':'接待已關閉'}</span><h2>{event.eventName}</h2><p>{event.guestCount} 組賓客・已接待 {event.completedCount} 組</p></div><strong>{event.eventCode}</strong><i aria-hidden="true">{busy===event.eventCode?'載入中…':'›'}</i></button>)}</div>{!identity.events.length&&!showCreate&&<Empty title="尚未建立婚宴" copy="建立第一場婚宴後，就能匯入 Excel 或 Google Sheet。" />}{showCreate?<section className="create-event"><div className="card-head"><div><p>建立新婚宴</p><h3>設定獨立的婚宴空間</h3></div>{identity.events.length>0&&<button type="button" onClick={()=>setShowCreate(false)}>取消</button>}</div><label className="field"><span>婚宴名稱</span><input value={eventName} onChange={e=>setEventName(e.target.value)} placeholder="例如：好日子正式婚宴" /></label><label className="field"><span>現場喜餅庫存</span><input inputMode="numeric" value={cakeStock||''} onChange={e=>setCakeStock(Number(e.target.value)||0)} placeholder="0" /></label><button className="primary create-submit" type="button" disabled={busy==='create'||!eventName.trim()} onClick={runCreate}>{busy==='create'?'建立中…':'建立婚宴'}</button></section>:<button className="new-event-button" type="button" onClick={()=>setShowCreate(true)}>＋ 建立新婚宴</button>}{error&&<div className="login-error">{error}</div>}</section></main>;
}

function StaffGate({eventCode,role,message,onBack,onLogin}:{eventCode:string;role:Exclude<Role,'admin'>;message:string;onBack:()=>void;onLogin:(token:string,state:AppState)=>void}) {
  const [pin,setPin]=useState('');
  const [operator,setOperator]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(message);
  const title=role==='planner'?'婚顧現場總覽':'接待人員入口';
  const submit=async()=>{setBusy(true);setError('');try{const result=await callCloud<{token:string;state:AppState}>('login',{eventCode,role,pin,operator});onLogin(result.token,result.state);}catch(e){setError(e instanceof Error?e.message:'無法進入婚宴');setBusy(false);}};
  return <main className="entry-screen"><section className="entry-card signin-card"><button className="entry-back" type="button" onClick={onBack}>‹ 返回首頁</button><div className="entry-brand compact"><span aria-hidden="true">{role==='planner'?'覽':'迎'}</span><p className="eyebrow">婚宴代碼 {eventCode}</p><h1>{title}</h1><p>{role==='planner'?'輸入婚顧 PIN 後即可唯讀查看現場進度。':'輸入您的稱呼與接待 PIN，開始協助賓客報到。'}</p></div><div className="login-fields">{role==='reception'&&<label className="field"><span>您的稱呼</span><input value={operator} onChange={e=>setOperator(e.target.value)} placeholder="例如：接待 A" autoComplete="name" /></label>}<label className="field"><span>{role==='planner'?'婚顧':'接待'} PIN</span><input inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="4 位數" autoComplete="one-time-code" /></label><button className="primary login-submit" type="button" disabled={busy||pin.length!==4||(role==='reception'&&!operator.trim())||!hasCloudBackend()} onClick={submit}>{busy?'驗證中…':'進入婚宴'}</button></div>{!hasCloudBackend()&&<div className="config-note">Google 雲端連線尚未啟用，這個工作人員入口目前無法使用。</div>}{error&&<div className="login-error">{error}</div>}<small className="privacy-note">工作人員不需要 Google 或 ChatGPT 帳號，也不會取得管理者的 Google Drive 權限。</small></section></main>;
}
