/** 好日子迎賓 — Google Apps Script backend
 * Deploy as Web App: execute as owner, access anyone.
 * Set Script Properties: GOOGLE_CLIENT_ID and ADMIN_EMAIL.
 */
const EVENT_PREFIX = 'EVENT_';
const SHEETS = { SETTINGS: '婚宴設定', GUESTS: '賓客名單', AUDIT: '異動紀錄' };
const GUEST_HEADERS = ['id','賓客','分類','電話','應到','實到','素食應到','素食實到','兒童椅應到','兒童椅實到','桌次配置JSON','喜餅種類','喜餅原定','喜餅已領','欠餅','已收到紅包','袋上有編號或姓名','紅包編號','禮金金額','備註','已完成接待','完成時間','接待人員','更新時間'];

function doGet() {
  return json_({ ok: true, data: { service: '好日子迎賓', status: 'ready' } });
}

function doPost(e) {
  try {
    const input = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const routes = {
      createEvent: createEvent_, login: login_, loadEvent: loadEvent_, saveEvent: saveEvent_,
      readGoogleSheet: readGoogleSheet_, closeReception: closeReception_, health: () => ({ service: '好日子迎賓' }),
    };
    if (!routes[input.action]) throw new Error('不支援的操作');
    return json_({ ok: true, data: routes[input.action](input) });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

function createEvent_(input) {
  const admin = verifyAdmin_(input.googleIdToken);
  const eventName = clean_(input.eventName);
  if (!eventName) throw new Error('請填寫婚宴名稱');
  const eventCode = uniqueCode_();
  const folder = DriveApp.createFolder(`${eventName}_${eventCode}`);
  const book = SpreadsheetApp.create(`${eventName}_${eventCode}_好日子迎賓`);
  DriveApp.getFileById(book.getId()).moveTo(folder);
  const settings = book.getSheets()[0]; settings.setName(SHEETS.SETTINGS);
  const guests = book.insertSheet(SHEETS.GUESTS); guests.getRange(1,1,1,GUEST_HEADERS.length).setValues([GUEST_HEADERS]); guests.setFrozenRows(1);
  const audit = book.insertSheet(SHEETS.AUDIT); audit.getRange(1,1,1,6).setValues([['時間','角色','操作人員','動作','賓客ID','內容']]); audit.setFrozenRows(1);
  const state = {
    settings: { eventName, eventCode, receptionOpen:true, cakeStock:Number(input.cakeStock)||0, receptionPin:pin_(), plannerPin:pin_(), plannerEnabled:true, operator:admin.email, role:'admin' },
    guests: [],
  };
  writeState_(book, state);
  PropertiesService.getScriptProperties().setProperty(EVENT_PREFIX + eventCode, JSON.stringify({ spreadsheetId:book.getId(), folderId:folder.getId(), adminEmail:admin.email }));
  audit_(book, 'admin', admin.email, '建立婚宴', '', eventName);
  return { state, folderUrl:folder.getUrl(), spreadsheetUrl:book.getUrl() };
}

function login_(input) {
  const event = eventRecord_(input.eventCode);
  const state = readState_(SpreadsheetApp.openById(event.spreadsheetId));
  const role = input.role;
  if (role === 'admin') {
    const admin = verifyAdmin_(input.googleIdToken, event.adminEmail);
    return { token:signToken_({ eventCode:input.eventCode, role:'admin', name:admin.email, exp:Date.now()+12*60*60*1000 }), role:'admin', state:setRole_(state,'admin',admin.email) };
  }
  if (!state.settings.receptionOpen) throw new Error('本場婚宴接待已關閉');
  if (role === 'planner' && (!state.settings.plannerEnabled || String(input.pin)!==String(state.settings.plannerPin))) throw new Error('婚顧 PIN 不正確');
  if (role === 'reception' && String(input.pin)!==String(state.settings.receptionPin)) throw new Error('接待 PIN 不正確');
  if (!['planner','reception'].includes(role)) throw new Error('角色不正確');
  const name = clean_(input.operator) || (role === 'planner' ? '婚顧' : '接待人員');
  return { token:signToken_({ eventCode:input.eventCode, role, name, exp:Date.now()+12*60*60*1000 }), role, state:setRole_(state,role,name) };
}

function loadEvent_(input) {
  const session = verifyToken_(input.token, input.eventCode);
  const event = eventRecord_(input.eventCode);
  const state = readState_(SpreadsheetApp.openById(event.spreadsheetId));
  if (!state.settings.receptionOpen && session.role !== 'admin') throw new Error('本場婚宴接待已關閉');
  return setRole_(state, session.role, session.name);
}

function saveEvent_(input) {
  const session = verifyToken_(input.token, input.eventCode);
  if (session.role === 'planner') throw new Error('婚顧為唯讀權限');
  const event = eventRecord_(input.eventCode);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const book = SpreadsheetApp.openById(event.spreadsheetId);
    const current = readState_(book);
    if (!current.settings.receptionOpen && session.role !== 'admin') throw new Error('本場婚宴接待已關閉');
    const next = input.state;
    next.settings.eventCode = input.eventCode;
    next.settings.role = session.role; next.settings.operator = session.name;
    if (session.role !== 'admin') {
      next.settings.eventName=current.settings.eventName; next.settings.receptionOpen=current.settings.receptionOpen;
      next.settings.cakeStock=current.settings.cakeStock; next.settings.receptionPin=current.settings.receptionPin;
      next.settings.plannerPin=current.settings.plannerPin; next.settings.plannerEnabled=current.settings.plannerEnabled;
    }
    writeState_(book,next); audit_(book,session.role,session.name,'儲存接待資料','',`${next.guests.length} 組`);
    return { revision:Date.now() };
  } finally { lock.releaseLock(); }
}

function readGoogleSheet_(input) {
  const session = verifyToken_(input.token,input.eventCode);
  if (session.role !== 'admin') throw new Error('只有 Admin 可以重新匯入');
  const book = SpreadsheetApp.openByUrl(input.url);
  const values = book.getSheets()[0].getDataRange().getDisplayValues();
  return { title:book.getName(), values };
}

function closeReception_(input) {
  const session = verifyToken_(input.token,input.eventCode);
  if (session.role !== 'admin') throw new Error('只有 Admin 可以關閉接待');
  const event = eventRecord_(input.eventCode); const book=SpreadsheetApp.openById(event.spreadsheetId); const state=readState_(book);
  state.settings.receptionOpen=Boolean(input.open); writeState_(book,state); audit_(book,'admin',session.name,input.open?'重新開放接待':'關閉接待','','');
  return { receptionOpen:state.settings.receptionOpen };
}

function readState_(book) {
  const settingsSheet=book.getSheetByName(SHEETS.SETTINGS); const rows=settingsSheet.getDataRange().getValues(); const map={}; rows.forEach(row=>map[row[0]]=row[1]);
  const guestSheet=book.getSheetByName(SHEETS.GUESTS); const values=guestSheet.getDataRange().getValues(); const guests=values.slice(1).filter(row=>row[0]).map(row=>({
    id:String(row[0]),name:String(row[1]),category:String(row[2]),phone:String(row[3]),expected:Number(row[4])||0,actual:Number(row[5])||0,
    vegetarianExpected:Number(row[6])||0,vegetarianActual:Number(row[7])||0,childChairExpected:Number(row[8])||0,childChairActual:Number(row[9])||0,
    tables:parseJson_(row[10],[]),cakeType:String(row[11]||'不需喜餅'),cakePlanned:Number(row[12])||0,cakeDelivered:Number(row[13])||0,cakeOwed:Number(row[14])||0,
    giftReceived:Boolean(row[15]),bagNamed:Boolean(row[16]),giftName:String(row[17]||''),giftAmount:row[18]===''?null:Number(row[18]),note:String(row[19]||''),
    completed:Boolean(row[20]),completedAt:dateIso_(row[21]),completedBy:String(row[22]||''),updatedAt:dateIso_(row[23])||new Date().toISOString(),
  }));
  return {settings:{eventName:String(map.eventName||''),eventCode:String(map.eventCode||''),receptionOpen:String(map.receptionOpen)!=='false',cakeStock:Number(map.cakeStock)||0,receptionPin:String(map.receptionPin||''),plannerPin:String(map.plannerPin||''),plannerEnabled:String(map.plannerEnabled)!=='false',operator:'',role:'admin'},guests};
}

function writeState_(book,state) {
  let sheet=book.getSheetByName(SHEETS.SETTINGS); sheet.clear(); const s=state.settings;
  sheet.getRange(1,1,8,2).setValues([['eventName',s.eventName],['eventCode',s.eventCode],['receptionOpen',s.receptionOpen],['cakeStock',s.cakeStock],['receptionPin',s.receptionPin],['plannerPin',s.plannerPin],['plannerEnabled',s.plannerEnabled],['updatedAt',new Date()]]); sheet.autoResizeColumns(1,2);
  sheet=book.getSheetByName(SHEETS.GUESTS); const rows=state.guests.map(g=>[g.id,g.name,g.category,g.phone,g.expected,g.actual,g.vegetarianExpected,g.vegetarianActual,g.childChairExpected,g.childChairActual,JSON.stringify(g.tables||[]),g.cakeType,g.cakePlanned,g.cakeDelivered,g.cakeOwed,g.giftReceived,g.bagNamed,g.giftName,g.giftAmount==null?'':g.giftAmount,g.note,g.completed,g.completedAt||'',g.completedBy,g.updatedAt]);
  sheet.clearContents(); sheet.getRange(1,1,1,GUEST_HEADERS.length).setValues([GUEST_HEADERS]); if(rows.length) sheet.getRange(2,1,rows.length,GUEST_HEADERS.length).setValues(rows); sheet.setFrozenRows(1);
}

function setRole_(state,role,name){state.settings.role=role;state.settings.operator=name;if(role==='planner'){state.guests=state.guests.map(g=>Object.assign({},g,{phone:'',giftAmount:null,giftName:'',note:'',giftReceived:false,bagNamed:false}));}return state;}
function audit_(book,role,name,action,guestId,detail){book.getSheetByName(SHEETS.AUDIT).appendRow([new Date(),role,name,action,guestId,detail]);}
function eventRecord_(code){const raw=PropertiesService.getScriptProperties().getProperty(EVENT_PREFIX+clean_(code));if(!raw)throw new Error('找不到婚宴代碼');return JSON.parse(raw);}
function verifyAdmin_(idToken,expectedEmail){if(!idToken)throw new Error('請使用 Admin Google 帳號登入');const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(idToken),{muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('Google 登入已失效');const data=JSON.parse(response.getContentText());const props=PropertiesService.getScriptProperties();const clientId=props.getProperty('GOOGLE_CLIENT_ID');const adminEmail=expectedEmail||props.getProperty('ADMIN_EMAIL');if(clientId&&data.aud!==clientId)throw new Error('Google 登入來源不正確');if(!data.email_verified)throw new Error('Google 帳號尚未驗證');if(adminEmail&&String(data.email).toLowerCase()!==String(adminEmail).toLowerCase())throw new Error('此帳號不是 Admin');return data;}
function signToken_(payload){const props=PropertiesService.getScriptProperties();let secret=props.getProperty('SESSION_SECRET');if(!secret){secret=Utilities.getUuid()+Utilities.getUuid();props.setProperty('SESSION_SECRET',secret);}const body=Utilities.base64EncodeWebSafe(JSON.stringify(payload));const signature=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body,secret));return body+'.'+signature;}
function verifyToken_(token,eventCode){const parts=String(token||'').split('.');if(parts.length!==2)throw new Error('請重新登入');const secret=PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');const expected=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0],secret));if(expected!==parts[1])throw new Error('登入憑證不正確');const data=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());if(data.eventCode!==eventCode||Date.now()>data.exp)throw new Error('登入已過期，請重新登入');return data;}
function uniqueCode_(){for(let i=0;i<20;i++){const code='W'+Math.random().toString(36).slice(2,7).toUpperCase();if(!PropertiesService.getScriptProperties().getProperty(EVENT_PREFIX+code))return code;}throw new Error('無法建立婚宴代碼，請再試一次');}
function pin_(){return String(Math.floor(1000+Math.random()*9000));}
function clean_(value){return String(value||'').trim();}
function parseJson_(value,fallback){try{return JSON.parse(value);}catch(_){return fallback;}}
function dateIso_(value){if(!value)return null;const date=value instanceof Date?value:new Date(value);return isNaN(date.getTime())?String(value):date.toISOString();}
function json_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
