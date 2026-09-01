'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { callCloud, hasCloudBackend, loadEvent, saveEvent } from './api-client';
import { importSummary, matrixToGuests, readExcelFile } from './import-tools';
import { allocateActual, deriveStatus, formatTables, maskPhone, statusText, type AppState, type GuestGroup, type MainTab } from './model';
import { googleClientId } from './public-config';
import { initialState } from './sample-data';

const STORAGE_KEY = 'hao-ri-zi-ying-bin-v1';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const money = new Intl.NumberFormat('zh-TW');

export default function Home() {
  const [state, setState] = useState<AppState>(() => clone(initialState));
  const [ready, setReady] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [cloudMessage, setCloudMessage] = useState('');
  const [tab, setTab] = useState<MainTab>('reception');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    if (!hasCloudBackend()) {
      try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) setState(JSON.parse(saved)); } catch { /* keep safe sample state */ }
      setReady(true); return;
    }
    const params = new URLSearchParams(location.search);
    const eventCode = params.get('event') || '';
    const token = sessionStorage.getItem(`hao-ri-zi-token-${eventCode}`) || '';
    if (!eventCode || !token) { setReady(true); return; }
    loadEvent(eventCode, token).then((remote) => {
      remoteSnapshot.current = JSON.stringify(remote); setState(remote); setSessionToken(token); setReady(true);
    }).catch((error) => { setCloudMessage(error instanceof Error ? error.message : '請重新登入'); setReady(true); });
  }, []);

  useEffect(() => {
    if (ready && !hasCloudBackend()) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, ready]);

  useEffect(() => {
    if (!ready || !hasCloudBackend() || !sessionToken || state.settings.role === 'planner') return;
    const serialized = JSON.stringify(state);
    if (serialized === remoteSnapshot.current) return;
    const timer = window.setTimeout(() => {
      saveEvent(state, sessionToken).then(() => { remoteSnapshot.current = serialized; }).catch((error) => setNotice(error instanceof Error ? error.message : '雲端儲存失敗'));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state, sessionToken, ready]);

  useEffect(() => {
    if (!hasCloudBackend() || !sessionToken || !state.settings.eventCode) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || draft) return;
      loadEvent(state.settings.eventCode, sessionToken).then((remote) => {
        const serialized = JSON.stringify(remote);
        if (serialized !== remoteSnapshot.current) { remoteSnapshot.current = serialized; setState(remote); }
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(poll);
  }, [sessionToken, state.settings.eventCode, draft]);

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

  const openGuest = (guest: GuestGroup) => {
    const next = clone(guest);
    if (next.giftName === next.name) next.giftName = '';
    setSelectedId(guest.id); setDraft(next); setStep(1); setEditingAttendance(false); setEditingCake(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeGuest = () => { setSelectedId(null); setDraft(null); setStep(1); };

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
      const token = sessionStorage.getItem('hao-ri-zi-token') || new URLSearchParams(location.search).get('token') || '';
      const result = await callCloud<{ title:string; values:unknown[][] }>('readGoogleSheet', { eventCode:state.settings.eventCode, token, url });
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
    : [{ key:'reception', label:'接待賓客', count:waiting.length }, { key:'completed', label:'已接待', count:completed.length }, { key:'dashboard', label:'現場總覽' }, ...(role === 'admin' ? [{ key:'admin' as MainTab, label:'管理' }] : [])];

  if (!ready) return <LoadingScreen />;
  if (hasCloudBackend() && !sessionToken) return <CloudGate message={cloudMessage} onLogin={(token,remote) => { remoteSnapshot.current=JSON.stringify(remote); setSessionToken(token); setState(remote); const code=remote.settings.eventCode; sessionStorage.setItem(`hao-ri-zi-token-${code}`,token); const params=new URLSearchParams(location.search); params.set('event',code); history.replaceState(null,'',`${location.pathname}?${params}`); }} />;
  if (!state.settings.receptionOpen && role !== 'admin') return <ClosedScreen eventName={state.settings.eventName} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">{state.settings.eventName}</p><h1>好日子迎賓</h1></div>
        <div className="top-actions">
          <span className={`sync ${hasCloudBackend() ? 'online' : ''}`}><i />{hasCloudBackend() ? '已連接 Google Drive' : '本機示範'}</span>
          <button className="operator" type="button" onClick={() => role === 'admin' && setTab('admin')}>{role === 'admin' ? 'Admin' : role === 'planner' ? '婚顧' : '接待'}・{state.settings.operator}</button>
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
      {tab === 'admin' && role === 'admin' && <AdminPanel state={state} setState={setState} completed={completed} imported={imported} sourceName={sourceName} fileRef={fileRef} onFile={handleImport} onGoogleSheet={handleGoogleSheet} applyImport={applyImport} cancelImport={() => setImported(null)} exportGiftCsv={exportGiftCsv} reset={() => { if (window.confirm('要清除目前資料並回到示範名單嗎？')) { setState(clone(initialState)); setNotice('已重設示範資料'); } }} />}
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

type AdminProps={state:AppState;setState:React.Dispatch<React.SetStateAction<AppState>>;completed:GuestGroup[];imported:GuestGroup[]|null;sourceName:string;fileRef:React.RefObject<HTMLInputElement|null>;onFile:(file:File)=>void;onGoogleSheet:(url:string)=>void;applyImport:()=>void;cancelImport:()=>void;exportGiftCsv:()=>void;reset:()=>void};
function AdminPanel({state,setState,completed,imported,sourceName,fileRef,onFile,onGoogleSheet,applyImport,cancelImport,exportGiftCsv,reset}:AdminProps) {
  const [sheetUrl,setSheetUrl]=useState('');
  const summary=imported?importSummary(state.guests,imported):null;
  const giftTotal=completed.reduce((sum,guest)=>sum+(guest.giftAmount||0),0);
  const updateSettings=<K extends keyof AppState['settings']>(key:K,value:AppState['settings'][K])=>setState((current)=>({...current,settings:{...current.settings,[key]:value}}));
  return <section className="content admin-page"><div className="dashboard-heading"><div><p className="eyebrow">僅 Admin 可見</p><h2>婚宴管理</h2></div><span className={state.settings.receptionOpen?'open':'closed'}>{state.settings.receptionOpen?'接待開放中':'接待已關閉'}</span></div><div className="admin-grid"><article className="admin-card wide"><div className="card-head"><div><p>賓客名單</p><h3>匯入 Excel 或 Google Sheet</h3></div><span>{state.guests.length} 組賓客</span></div><p className="card-copy">接待開始前可重新匯入並先看差異；一旦有接待紀錄，就會停止整批覆蓋。</p><div className="import-actions"><input ref={fileRef} hidden type="file" accept=".xlsx,.csv" onChange={(event)=>event.target.files?.[0]&&onFile(event.target.files[0])}/><button className="primary" type="button" onClick={()=>fileRef.current?.click()}>選擇 Excel 檔</button><label className="sheet-url"><span>Google Sheet 網址</span><div><input placeholder="貼上試算表網址" value={sheetUrl} onChange={(event)=>setSheetUrl(event.target.value)}/><button type="button" disabled={!hasCloudBackend()||!sheetUrl.trim()} onClick={()=>onGoogleSheet(sheetUrl)}>讀取</button></div><small>{hasCloudBackend()?'由 Admin 的 Google 帳號讀取':'連接 Google Drive 後即可使用'}</small></label></div>{summary&&<div className="import-preview"><div><b>{sourceName}</b><span>匯入前確認差異</span></div><section><span><b>+{summary.added.length}</b>新增</span><span><b>{summary.changed.length}</b>更新</span><span><b>−{summary.removed.length}</b>移除</span><span><b>{summary.unchanged}</b>不變</span></section><div className="action-row"><button className="secondary" type="button" onClick={cancelImport}>取消</button><button className="primary" type="button" onClick={applyImport}>確認重新匯入</button></div></div>}</article><article className="admin-card"><div className="card-head"><div><p>婚宴資料</p><h3>場次設定</h3></div><span>{state.settings.eventCode}</span></div><label className="field"><span>婚宴名稱</span><input value={state.settings.eventName} onChange={(event)=>updateSettings('eventName',event.target.value)} /></label><label className="field"><span>現場喜餅庫存</span><input inputMode="numeric" value={state.settings.cakeStock} onChange={(event)=>updateSettings('cakeStock',Number(event.target.value)||0)} /></label><label className="field"><span>目前操作人員</span><input value={state.settings.operator} onChange={(event)=>updateSettings('operator',event.target.value)} /></label></article><article className="admin-card"><div className="card-head"><div><p>權限</p><h3>角色連結與 PIN</h3></div><span>{hasCloudBackend()?'雲端已連接':'設定前預覽'}</span></div><div className="pin-row"><div><b>接待人員</b><span>可接待、修改與看總覽</span></div><code>{state.settings.receptionPin}</code></div><div className="pin-row"><div><b>婚顧</b><span>唯讀查看現場總覽</span></div><code>{state.settings.plannerPin}</code></div><label className="check-card compact"><input type="checkbox" checked={state.settings.plannerEnabled} onChange={(event)=>updateSettings('plannerEnabled',event.target.checked)} /><span><b>啟用婚顧連結</b><small>關閉後立即停用</small></span></label></article><article className="admin-card wide gift-report"><div className="card-head"><div><p>禮金報表</p><h3>已登記禮金</h3></div><span>只有 Admin 可匯出</span></div><div className="gift-summary"><div><span>已填金額</span><strong>${money.format(giftTotal)}</strong></div><div><span>收到紅包</span><strong>{completed.filter((guest)=>guest.giftReceived).length}<small> 組</small></strong></div><button className="primary" type="button" onClick={exportGiftCsv}>匯出 CSV</button></div></article><article className="admin-card wide close-card"><div><p>接待狀態</p><h3>{state.settings.receptionOpen?'關閉接待後，只有 Admin 可看報表':'目前只有 Admin 可以進入'}</h3><span>關閉不會刪除 Google Drive 中的任何資料。</span></div><button className={state.settings.receptionOpen?'danger':'primary'} type="button" onClick={()=>updateSettings('receptionOpen',!state.settings.receptionOpen)}>{state.settings.receptionOpen?'關閉接待':'重新開放接待'}</button></article></div><button className="reset-link" type="button" onClick={reset}>重設本機示範資料</button></section>;
}

function Empty({title,copy}:{title:string;copy:string}) { return <div className="empty"><span aria-hidden="true">○</span><h3>{title}</h3><p>{copy}</p></div>; }
function ClosedScreen({eventName}:{eventName:string}) { return <main className="closed-screen"><div><p className="eyebrow">{eventName}</p><h1>好日子迎賓</h1><span>本場婚宴接待已關閉</span><p>如需查看資料，請由 Admin 登入報表。</p></div></main>; }
function LoadingScreen() { return <main className="closed-screen"><div><p className="eyebrow">正在準備</p><h1>好日子迎賓</h1><span>載入婚宴資料中…</span></div></main>; }

function CloudGate({message,onLogin}:{message:string;onLogin:(token:string,state:AppState)=>void}) {
  const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const presetEvent = params.get('event') || '';
  const presetRole = params.get('role');
  const [role,setRole]=useState<'admin'|'reception'|'planner'>(presetRole==='planner'?'planner':presetRole==='reception'?'reception':'admin');
  const [eventCode,setEventCode]=useState(presetEvent);
  const [pin,setPin]=useState('');
  const [operator,setOperator]=useState('');
  const [eventName,setEventName]=useState('');
  const [cakeStock,setCakeStock]=useState(0);
  const [error,setError]=useState(message);
  const [busy,setBusy]=useState(false);
  const googleButton=useRef<HTMLDivElement>(null);
  const adminForm=useRef({eventCode,eventName,cakeStock}); adminForm.current={eventCode,eventName,cakeStock};
  const clientId=googleClientId;

  useEffect(()=>{
    if(role!=='admin'||!clientId||!googleButton.current)return;
    const render=()=>{
      const google=(window as unknown as {google?:{accounts:{id:{initialize:(config:unknown)=>void;renderButton:(element:HTMLElement,options:unknown)=>void}}}}).google;
      if(!google||!googleButton.current)return;
      google.accounts.id.initialize({client_id:clientId,callback:async(response:{credential:string})=>{
        setBusy(true);setError('');
        try{
          if(adminForm.current.eventCode){
            const result=await callCloud<{token:string;state:AppState}>('login',{eventCode:adminForm.current.eventCode,role:'admin',googleIdToken:response.credential}); onLogin(result.token,result.state);
          }else{
            if(!adminForm.current.eventName.trim())throw new Error('請先填寫婚宴名稱');
            const created=await callCloud<{state:AppState}>('createEvent',{eventName:adminForm.current.eventName,cakeStock:adminForm.current.cakeStock,googleIdToken:response.credential});
            const result=await callCloud<{token:string;state:AppState}>('login',{eventCode:created.state.settings.eventCode,role:'admin',googleIdToken:response.credential}); onLogin(result.token,result.state);
          }
        }catch(e){setError(e instanceof Error?e.message:'Google 登入失敗');setBusy(false);}
      }});
      google.accounts.id.renderButton(googleButton.current,{theme:'outline',size:'large',shape:'pill',text:'signin_with',locale:'zh_TW',width:280});
    };
    if((window as unknown as {google?:unknown}).google){render();return;}
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=render;document.head.appendChild(script);
    return()=>{script.onload=null;};
  },[role,clientId,onLogin]);

  const pinLogin=async()=>{
    setBusy(true);setError('');
    try{const result=await callCloud<{token:string;state:AppState}>('login',{eventCode,role,pin,operator});onLogin(result.token,result.state);}
    catch(e){setError(e instanceof Error?e.message:'登入失敗');setBusy(false);}
  };

  return <main className="login-screen"><section className="login-card"><p className="eyebrow">婚宴當日接待</p><h1>好日子迎賓</h1><p className="login-copy">請選擇身分，進入這場婚宴。</p><div className="role-picker"><button className={role==='admin'?'active':''} type="button" onClick={()=>setRole('admin')}>Admin</button><button className={role==='reception'?'active':''} type="button" onClick={()=>setRole('reception')}>接待人員</button><button className={role==='planner'?'active':''} type="button" onClick={()=>setRole('planner')}>婚顧</button></div>{role==='admin'?<div className="login-fields"><label className="field"><span>婚宴代碼（建立新婚宴時留白）</span><input value={eventCode} onChange={(e)=>setEventCode(e.target.value.toUpperCase())} placeholder="例如 W8K2P1" /></label>{!eventCode&&<><label className="field"><span>新婚宴名稱</span><input value={eventName} onChange={(e)=>setEventName(e.target.value)} placeholder="例如 佳蓉與柏宇的婚宴" /></label><label className="field"><span>現場喜餅庫存</span><input inputMode="numeric" value={cakeStock||''} onChange={(e)=>setCakeStock(Number(e.target.value)||0)} placeholder="0" /></label></>}<div ref={googleButton} className="google-button" />{!clientId&&<div className="config-note">尚未設定 Google 登入，請先完成部署設定。</div>}</div>:<div className="login-fields"><label className="field"><span>婚宴代碼</span><input value={eventCode} onChange={(e)=>setEventCode(e.target.value.toUpperCase())} /></label>{role==='reception'&&<label className="field"><span>您的稱呼</span><input value={operator} onChange={(e)=>setOperator(e.target.value)} placeholder="例如 接待 A" /></label>}<label className="field"><span>{role==='planner'?'婚顧':'接待'} PIN</span><input inputMode="numeric" value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="4 位數" /></label><button className="primary login-submit" type="button" disabled={busy||!eventCode||!pin} onClick={pinLogin}>{busy?'登入中…':'進入婚宴'}</button></div>}{error&&<div className="login-error">{error}</div>}<small className="privacy-note">資料儲存在 Admin 的 Google Drive；接待關閉後，只有 Admin 可以查看。</small></section></main>;
}
