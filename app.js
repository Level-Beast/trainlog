/* ========================================================================
   TrainLog — vanilla JS PWA. Single-file app logic.
   Data model lives in localStorage, no backend, works fully offline.
   ======================================================================== */

/* ---------------------------- constants ---------------------------- */
const DB_KEY = 'trainlog_v1';
const ACTIVE_KEY = 'trainlog_active_session';
const WEEKDAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const WEEKDAY_LABEL = {mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'};
const WEEKDAY_SHORT = {mon:'M',tue:'T',wed:'W',thu:'T',fri:'F',sat:'S',sun:'S'};
const ROUTINE_COLORS = ['#F2C94C','#5FD0A8','#E8823D','#E5626A','#6E9FD6','#B084E8'];
const SLOT_PRESETS = ['Morning','Midday','Evening','Anytime'];

/* ---------------------------- storage ---------------------------- */
function defaultDB(){
  return {
    exercises: [],
    routines: [],
    schedule: {mon:[],tue:[],wed:[],thu:[],fri:[],sat:[],sun:[]},
    sessions: [],
    settings: {streakMode:'full', thresholdPct:50}
  };
}
let DB = loadDB();
function loadDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(!raw) return defaultDB();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultDB(), parsed);
  }catch(e){ return defaultDB(); }
}
function saveDB(){ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }

function loadActive(){
  try{ const raw = localStorage.getItem(ACTIVE_KEY); return raw? JSON.parse(raw): null; }catch(e){ return null; }
}
function saveActive(s){ localStorage.setItem(ACTIVE_KEY, JSON.stringify(s)); }
function clearActive(){ localStorage.removeItem(ACTIVE_KEY); }

/* ---------------------------- utils ---------------------------- */
function uid(){ return 'id_'+Math.random().toString(36).slice(2,9)+Date.now().toString(36); }
function fmtDate(d){ const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseDate(str){ const [y,m,d]=str.split('-').map(Number); return new Date(y,m-1,d); }
function todayStr(){ return fmtDate(new Date()); }
function weekdayKey(d){ const map=['sun','mon','tue','wed','thu','fri','sat']; return map[d.getDay()]; }
function niceDate(d){ return d.toLocaleDateString(undefined,{weekday:'short', month:'short', day:'numeric'}); }
function formatSeconds(s){ s=Math.max(0,Math.round(s)); const m=Math.floor(s/60), sec=s%60; return `${m}:${String(sec).padStart(2,'0')}`; }
function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.hidden=false;
  clearTimeout(toast._h);
  toast._h=setTimeout(()=>{ t.hidden=true; }, 2200);
}

function findExercise(id){ return DB.exercises.find(e=>e.id===id); }
function findRoutine(id){ return DB.routines.find(r=>r.id===id); }

/* ---------------------------- target formatting ---------------------------- */
function defaultTargetFor(type){
  if(type==='reps') return {sets:3, reps:10};
  if(type==='time') return {seconds:60};
  if(type==='distance') return {reps:1, meters:100};
  return {};
}
function formatTarget(type, t){
  t = t||{};
  if(type==='reps') return `${t.sets||0} × ${t.reps||0} reps`;
  if(type==='time') return formatSeconds(t.seconds||0);
  if(type==='distance') return `${t.reps||1} × ${t.meters||0} m`;
  return 'Checklist';
}
function typeLabel(type){
  return {reps:'Reps', time:'Time', distance:'Distance', checkbox:'Checklist'}[type] || type;
}

/* ---------------------------- streak / consistency engine ---------------------------- */
function ratioForLog(log){
  const ex = findExercise(log.exerciseId);
  const type = ex ? ex.type : 'checkbox';
  if(log.skipped || !log.actual) return 0;
  const a = log.actual, t = log.target || {};
  if(type==='reps'){
    const planned=(t.sets||1)*(t.reps||0), actual=(a.sets||0)*(a.reps||0);
    return planned>0 ? clamp(actual/planned,0,1) : (actual>0?1:0);
  }
  if(type==='time'){
    const planned=t.seconds||0, actual=a.seconds||0;
    return planned>0 ? clamp(actual/planned,0,1) : (actual>0?1:0);
  }
  if(type==='distance'){
    const planned=(t.reps||1)*(t.meters||0), actual=(a.reps||0)*(a.meters||0);
    return planned>0 ? clamp(actual/planned,0,1) : (actual>0?1:0);
  }
  return a.done ? 1 : 0;
}
function sessionRatio(session){
  if(!session.logs || session.logs.length===0) return 0;
  const sum = session.logs.reduce((acc,l)=>acc+ratioForLog(l),0);
  return sum/session.logs.length;
}
function sessionStatus(session){
  const r = sessionRatio(session);
  if(r>=0.999) return 'complete';
  if(r<=0.0001) return 'skipped';
  return 'partial';
}
function scheduleForDate(d){ return DB.schedule[weekdayKey(d)] || []; }
function lastSessionFor(dateStr, routineId, slot){
  const matches = DB.sessions.filter(s=>s.date===dateStr && s.routineId===routineId && s.slot===slot);
  return matches.length ? matches[matches.length-1] : null;
}
function isDayKept(dateStr){
  const d = parseDate(dateStr);
  const scheduled = scheduleForDate(d);
  if(scheduled.length===0) return null;
  const mode = DB.settings.streakMode, thr = (DB.settings.thresholdPct||50)/100;
  for(const sch of scheduled){
    const sess = lastSessionFor(dateStr, sch.routineId, sch.slot);
    if(!sess) return false;
    const r = sessionRatio(sess);
    if(mode==='full' && r<0.999) return false;
    if(mode==='any' && r<=0) return false;
    if(mode==='threshold' && r<thr) return false;
  }
  return true;
}
function computeStreak(){
  let streak=0;
  let d=new Date();
  const today=todayStr();
  for(let i=0;i<3650;i++){
    const ds=fmtDate(d);
    const kept=isDayKept(ds);
    if(kept===null){ d.setDate(d.getDate()-1); continue; }
    if(kept===true){ streak++; d.setDate(d.getDate()-1); continue; }
    if(ds===today){ d.setDate(d.getDate()-1); continue; } // grace: today not over yet
    break;
  }
  return streak;
}
function computeConsistency(days){
  let total=0,count=0;
  let d=new Date();
  for(let i=0;i<days;i++){
    const ds=fmtDate(d);
    const scheduled=scheduleForDate(d);
    for(const sch of scheduled){
      count++;
      const sess=lastSessionFor(ds, sch.routineId, sch.slot);
      total += sess? sessionRatio(sess) : 0;
    }
    d.setDate(d.getDate()-1);
  }
  return count? Math.round(100*total/count) : 0;
}
function dayCellStatus(ds){
  const d=parseDate(ds);
  if(fmtDate(d) > todayStr()) return 'future';
  const scheduled=scheduleForDate(d);
  if(scheduled.length===0) return 'none';
  const kept=isDayKept(ds);
  if(kept===true) return 'complete';
  const any = scheduled.some(sch=>{ const s=lastSessionFor(ds,sch.routineId,sch.slot); return s && sessionRatio(s)>0; });
  return any ? 'partial' : 'skipped';
}

/* ---------------------------- header ---------------------------- */
function renderHeader(){
  document.getElementById('streakNum').textContent = computeStreak();
}

/* ---------------------------- TODAY view ---------------------------- */
function renderToday(){
  const now = new Date();
  document.getElementById('todayDateFull').textContent = niceDate(now);

  const strip = document.getElementById('weekStrip');
  const todayIdx = WEEKDAYS.indexOf(weekdayKey(now));
  strip.innerHTML = WEEKDAYS.map((wd,i)=>{
    const cls = ['wd']; if(i===todayIdx) cls.push('today'); if(DB.schedule[wd].length) cls.push('has-plan');
    return `<div class="${cls.join(' ')}">${WEEKDAY_SHORT[wd]}</div>`;
  }).join('');

  const list = document.getElementById('todayList');
  const wd = weekdayKey(now);
  const scheduled = DB.schedule[wd] || [];
  const ds = todayStr();

  if(scheduled.length===0){
    list.innerHTML = `
      <div class="empty-state">
        <div>Nothing scheduled for today.</div>
        <div style="font-size:12.5px; margin-top:4px;">Build a routine and add it to your weekly schedule.</div>
        <button class="btn-primary" data-action="go-build">+ Set up your schedule</button>
      </div>`;
    return;
  }

  list.innerHTML = scheduled.map(sch=>{
    const routine = findRoutine(sch.routineId);
    if(!routine) return '';
    const sess = lastSessionFor(ds, sch.routineId, sch.slot);
    const n = routine.items.length;
    let statusHtml = '';
    let btnHtml = `<button class="btn-primary" data-action="start-session" data-routine="${routine.id}" data-slot="${escapeHtml(sch.slot)}">Start</button>`;
    if(sess){
      const st = sessionStatus(sess);
      const pct = Math.round(sessionRatio(sess)*100);
      statusHtml = `<span class="slot-status ${st}">${st.toUpperCase()} · ${pct}%</span>`;
      btnHtml = `<button class="btn-secondary full-w" style="width:100%" data-action="start-session" data-routine="${routine.id}" data-slot="${escapeHtml(sch.slot)}">Do it again</button>`;
    }
    return `
      <div class="slot-card">
        <div class="slot-top">
          <span class="slot-label">${escapeHtml(sch.slot)}</span>
          ${statusHtml}
        </div>
        <div class="routine-name" style="color:${routine.color}">${escapeHtml(routine.name)}</div>
        <div class="routine-meta">${n} exercise${n===1?'':'s'}</div>
        ${btnHtml}
      </div>`;
  }).join('');
}

/* ---------------------------- BUILD view ---------------------------- */
let buildTab = 'schedule';
function renderBuild(){
  document.querySelectorAll('.subnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.btab===buildTab));
  document.getElementById('btab-schedule').hidden = buildTab!=='schedule';
  document.getElementById('btab-routines').hidden = buildTab!=='routines';
  document.getElementById('btab-exercises').hidden = buildTab!=='exercises';
  renderScheduleTab();
  renderRoutinesTab();
  renderExercisesTab();
}

function renderScheduleTab(){
  const grid = document.getElementById('scheduleGrid');
  grid.innerHTML = WEEKDAYS.map(wd=>{
    const entries = DB.schedule[wd];
    const rows = entries.map(entry=>{
      const r = findRoutine(entry.routineId);
      const name = r ? r.name : '(deleted routine)';
      const color = r ? r.color : '#666';
      return `
        <div class="day-slot-row">
          <span><span class="swatch" style="background:${color}"></span>${escapeHtml(entry.slot)} — ${escapeHtml(name)}</span>
          <button class="rm" data-action="rm-schedule" data-day="${wd}" data-entry="${entry.id}">✕</button>
        </div>`;
    }).join('');
    return `
      <div class="day-block">
        <div class="day-block-head"><span class="day-name">${WEEKDAY_LABEL[wd]}</span></div>
        <div class="day-slots">${rows}</div>
        <button class="add-slot-btn" data-action="add-schedule" data-day="${wd}">+ Add routine to ${WEEKDAY_LABEL[wd]}</button>
      </div>`;
  }).join('');
}

function renderRoutinesTab(){
  const list = document.getElementById('routinesList');
  if(DB.routines.length===0){
    list.innerHTML = `<div class="empty-state">No routines yet. A routine is a set of exercises you'll do together, like "Morning Routine" or "Leg Day".</div>`;
    return;
  }
  list.innerHTML = DB.routines.map(r=>`
    <div class="list-item">
      <div class="list-item-main">
        <div class="list-item-title"><span class="swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}</div>
        <div class="list-item-sub">${r.items.length} exercise${r.items.length===1?'':'s'}</div>
      </div>
      <div class="list-item-actions">
        <button class="icon-btn" data-action="edit-routine" data-id="${r.id}">✎</button>
        <button class="icon-btn" data-action="del-routine" data-id="${r.id}">✕</button>
      </div>
    </div>`).join('');
}

function renderExercisesTab(){
  const list = document.getElementById('exercisesList');
  if(DB.exercises.length===0){
    list.innerHTML = `<div class="empty-state">No exercises yet. Add the moves you actually do — sprints, push-ups, meditation, whatever — with your own targets.</div>`;
    return;
  }
  list.innerHTML = DB.exercises.map(ex=>`
    <div class="list-item">
      <div class="list-item-main">
        <div class="list-item-title">${escapeHtml(ex.name)}</div>
        <div class="list-item-sub">${typeLabel(ex.type)} · ${formatTarget(ex.type, ex.target)}</div>
      </div>
      <div class="list-item-actions">
        <button class="icon-btn" data-action="edit-exercise" data-id="${ex.id}">✎</button>
        <button class="icon-btn" data-action="del-exercise" data-id="${ex.id}">✕</button>
      </div>
    </div>`).join('');
}

/* ---------------------------- HISTORY view ---------------------------- */
function renderHistory(){
  document.getElementById('statStreak').textContent = computeStreak();
  document.getElementById('statConsistency').textContent = computeConsistency(30)+'%';

  const sel = document.getElementById('streakModeSelect');
  sel.value = DB.settings.streakMode;
  document.getElementById('thresholdRow').hidden = DB.settings.streakMode!=='threshold';
  document.getElementById('thresholdSlider').value = DB.settings.thresholdPct;
  document.getElementById('thresholdVal').textContent = DB.settings.thresholdPct+'%';

  const cal = document.getElementById('calendarGrid');
  const days = 56;
  let cells = [];
  let d = new Date();
  for(let i=0;i<days;i++){ cells.push(fmtDate(d)); d.setDate(d.getDate()-1); }
  cells.reverse();
  cal.innerHTML = cells.map(ds=>`<div class="cal-cell ${dayCellStatus(ds)}" title="${ds}"></div>`).join('');

  const log = document.getElementById('sessionLog');
  const recent = DB.sessions.slice().sort((a,b)=> b.startedAt - a.startedAt).slice(0,25);
  if(recent.length===0){
    log.innerHTML = `<div class="empty-state">No sessions logged yet.</div>`;
  } else {
    log.innerHTML = recent.map(s=>{
      const r = findRoutine(s.routineId);
      const st = sessionStatus(s);
      const pct = Math.round(sessionRatio(s)*100);
      return `
        <div class="log-item">
          <div class="log-item-l">
            <div class="log-title">${r?escapeHtml(r.name):'(deleted routine)'} <span style="color:var(--text-faint)">· ${escapeHtml(s.slot)}</span></div>
            <div class="log-date">${s.date}</div>
          </div>
          <div class="log-badge ${st}">${pct}%</div>
        </div>`;
    }).join('');
  }
}

/* ---------------------------- view routing ---------------------------- */
let currentView = 'today';
function switchView(v){
  currentView = v;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.getElementById('view-today').hidden = v!=='today';
  document.getElementById('view-build').hidden = v!=='build';
  document.getElementById('view-history').hidden = v!=='history';
  renderAll();
}
function renderAll(){
  renderHeader();
  if(currentView==='today') renderToday();
  if(currentView==='build') renderBuild();
  if(currentView==='history') renderHistory();
}

/* ---------------------------- MODAL ---------------------------- */
function openModal(html){
  document.getElementById('modalInner').innerHTML = html;
  document.getElementById('modalOverlay').hidden = false;
}
function closeModal(){
  document.getElementById('modalOverlay').hidden = true;
  document.getElementById('modalInner').innerHTML = '';
}

/* ----- Exercise modal ----- */
function exerciseModal(existingId){
  const ex = existingId ? findExercise(existingId) : null;
  const type = ex ? ex.type : 'reps';
  const t = ex ? ex.target : defaultTargetFor(type);
  const html = `
    <div class="modal-title">${ex? 'Edit exercise':'New exercise'}</div>
    <div class="field">
      <label>NAME</label>
      <input type="text" id="fExName" value="${ex?escapeHtml(ex.name):''}" placeholder="e.g. Sprint, Push-ups, Meditation">
    </div>
    <div class="field">
      <label>TYPE</label>
      <div class="chip-select" id="fExTypeChips">
        ${['reps','time','distance','checkbox'].map(tp=>`<button type="button" class="chip ${tp===type?'active':''}" data-type="${tp}">${typeLabel(tp)}</button>`).join('')}
      </div>
    </div>
    <div id="fExTargetFields"></div>
    <div class="btn-row" style="margin-top:8px">
      ${ex?`<button class="btn-danger" id="fExDelete">Delete</button>`:''}
      <button class="btn-primary" id="fExSave">${ex?'Save changes':'Add exercise'}</button>
    </div>
  `;
  openModal(html);
  let currentType = type;
  const targetVals = Object.assign({}, t);
  function renderTargetFields(){
    const box = document.getElementById('fExTargetFields');
    if(currentType==='reps'){
      box.innerHTML = `<div class="field-row">
        <div class="field"><label>SETS</label><input type="number" id="fSets" value="${targetVals.sets||3}" min="1"></div>
        <div class="field"><label>REPS</label><input type="number" id="fReps" value="${targetVals.reps||10}" min="1"></div>
      </div>`;
    } else if(currentType==='time'){
      box.innerHTML = `<div class="field"><label>TARGET SECONDS</label><input type="number" id="fSeconds" value="${targetVals.seconds||60}" min="1"></div>`;
    } else if(currentType==='distance'){
      box.innerHTML = `<div class="field-row">
        <div class="field"><label>REPS (e.g. sprints)</label><input type="number" id="fDReps" value="${targetVals.reps||1}" min="1"></div>
        <div class="field"><label>METERS EACH</label><input type="number" id="fMeters" value="${targetVals.meters||100}" min="1"></div>
      </div>`;
    } else {
      box.innerHTML = `<div class="hint">No target needed — you'll just mark this done or not.</div>`;
    }
  }
  renderTargetFields();
  document.getElementById('fExTypeChips').addEventListener('click', e=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    currentType = btn.dataset.type;
    document.querySelectorAll('#fExTypeChips .chip').forEach(c=>c.classList.toggle('active', c===btn));
    Object.assign(targetVals, defaultTargetFor(currentType));
    renderTargetFields();
  });
  document.getElementById('fExSave').addEventListener('click', ()=>{
    const name = document.getElementById('fExName').value.trim();
    if(!name){ toast('Give it a name first'); return; }
    let target = {};
    if(currentType==='reps') target = {sets: +document.getElementById('fSets').value||1, reps:+document.getElementById('fReps').value||1};
    if(currentType==='time') target = {seconds:+document.getElementById('fSeconds').value||1};
    if(currentType==='distance') target = {reps:+document.getElementById('fDReps').value||1, meters:+document.getElementById('fMeters').value||1};
    if(ex){
      ex.name=name; ex.type=currentType; ex.target=target;
    } else {
      DB.exercises.push({id:uid(), name, type:currentType, target});
    }
    saveDB(); closeModal(); renderAll();
    toast('Saved');
  });
  if(ex){
    document.getElementById('fExDelete').addEventListener('click', ()=>{
      if(!confirm('Delete this exercise? It will be removed from any routines using it.')) return;
      DB.exercises = DB.exercises.filter(e=>e.id!==ex.id);
      DB.routines.forEach(r=>{ r.items = r.items.filter(it=>it.exerciseId!==ex.id); });
      saveDB(); closeModal(); renderAll();
    });
  }
}

/* ----- Routine modal ----- */
let routineDraft = null;
function routineModal(existingId){
  const existing = existingId ? findRoutine(existingId) : null;
  routineDraft = existing ? JSON.parse(JSON.stringify(existing)) : {id: uid(), name:'', color: ROUTINE_COLORS[DB.routines.length % ROUTINE_COLORS.length], items:[]};
  renderRoutineModal(!!existing);
}
function renderRoutineModal(isEdit){
  const d = routineDraft;
  const itemsHtml = d.items.length ? d.items.map((it,idx)=>{
    const ex = findExercise(it.exerciseId);
    const name = ex? ex.name : '(deleted)';
    const type = ex? ex.type : 'checkbox';
    return `
      <div class="list-item" style="margin-bottom:8px">
        <div class="list-item-main">
          <div class="list-item-title">${idx+1}. ${escapeHtml(name)}</div>
          <div class="list-item-sub">${formatTarget(type, it.target)}</div>
        </div>
        <div class="list-item-actions">
          <button class="icon-btn" data-raction="up" data-idx="${idx}">↑</button>
          <button class="icon-btn" data-raction="down" data-idx="${idx}">↓</button>
          <button class="icon-btn" data-raction="rm" data-idx="${idx}">✕</button>
        </div>
      </div>`;
  }).join('') : `<div class="hint">No exercises added yet.</div>`;

  const exOptions = DB.exercises.map(ex=>`<option value="${ex.id}">${escapeHtml(ex.name)}</option>`).join('');

  const html = `
    <div class="modal-title">${isEdit?'Edit routine':'New routine'}</div>
    <div class="field">
      <label>NAME</label>
      <input type="text" id="fRName" value="${escapeHtml(d.name)}" placeholder="e.g. Morning Routine, Leg Day">
    </div>
    <div class="field">
      <label>COLOR</label>
      <div class="chip-select" id="fRColorChips">
        ${ROUTINE_COLORS.map(c=>`<button type="button" class="chip" data-color="${c}" style="background:${d.color===c?c:'var(--surface-2)'}; ${d.color===c?'color:#1A1A1A;border-color:'+c:''}">●</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>EXERCISES</label>
      <div id="fRItems">${itemsHtml}</div>
    </div>
    ${DB.exercises.length ? `
    <div class="field-row">
      <div class="field" style="flex:2">
        <select id="fRExSelect">${exOptions}</select>
      </div>
      <div class="field" style="flex:1">
        <button type="button" class="btn-secondary" id="fRAddEx" style="width:100%">+ Add</button>
      </div>
    </div>` : `<div class="hint">You don't have any exercises yet — create some in the Exercises tab first.</div>`}
    <div class="btn-row" style="margin-top:10px">
      ${isEdit? `<button class="btn-danger" id="fRDelete">Delete</button>`:''}
      <button class="btn-primary" id="fRSave">${isEdit?'Save changes':'Create routine'}</button>
    </div>
  `;
  openModal(html);

  document.getElementById('fRColorChips').addEventListener('click', e=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    routineDraft.color = btn.dataset.color;
    renderRoutineModal(isEdit);
  });
  const addBtn = document.getElementById('fRAddEx');
  if(addBtn){
    addBtn.addEventListener('click', ()=>{
      const exId = document.getElementById('fRExSelect').value;
      const ex = findExercise(exId);
      if(!ex) return;
      routineDraft.items.push({id:uid(), exerciseId: ex.id, target: Object.assign({}, ex.target)});
      renderRoutineModal(isEdit);
    });
  }
  document.getElementById('fRItems').addEventListener('click', e=>{
    const btn = e.target.closest('button[data-raction]'); if(!btn) return;
    const idx = +btn.dataset.idx, act = btn.dataset.raction;
    if(act==='rm') routineDraft.items.splice(idx,1);
    if(act==='up' && idx>0) [routineDraft.items[idx-1], routineDraft.items[idx]] = [routineDraft.items[idx], routineDraft.items[idx-1]];
    if(act==='down' && idx<routineDraft.items.length-1) [routineDraft.items[idx+1], routineDraft.items[idx]] = [routineDraft.items[idx], routineDraft.items[idx+1]];
    renderRoutineModal(isEdit);
  });
  document.getElementById('fRSave').addEventListener('click', ()=>{
    const name = document.getElementById('fRName').value.trim();
    if(!name){ toast('Give it a name first'); return; }
    if(routineDraft.items.length===0){ toast('Add at least one exercise'); return; }
    routineDraft.name = name;
    const idx = DB.routines.findIndex(r=>r.id===routineDraft.id);
    if(idx>=0) DB.routines[idx] = routineDraft; else DB.routines.push(routineDraft);
    saveDB(); closeModal(); renderAll();
    toast('Saved');
  });
  if(isEdit){
    document.getElementById('fRDelete').addEventListener('click', ()=>{
      if(!confirm('Delete this routine? It will be removed from your schedule too.')) return;
      DB.routines = DB.routines.filter(r=>r.id!==routineDraft.id);
      WEEKDAYS.forEach(wd=>{ DB.schedule[wd] = DB.schedule[wd].filter(e=>e.routineId!==routineDraft.id); });
      saveDB(); closeModal(); renderAll();
    });
  }
}

/* ----- Schedule add modal ----- */
function addScheduleModal(day){
  if(DB.routines.length===0){
    openModal(`
      <div class="modal-title">Add to ${WEEKDAY_LABEL[day]}</div>
      <div class="hint">You need a routine first — build one in the Routines tab.</div>
      <button class="btn-primary full" id="fGoRoutines">Go build a routine</button>
    `);
    document.getElementById('fGoRoutines').addEventListener('click', ()=>{
      closeModal(); buildTab='routines'; renderAll();
    });
    return;
  }
  const routineOptions = DB.routines.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const html = `
    <div class="modal-title">Add to ${WEEKDAY_LABEL[day]}</div>
    <div class="field">
      <label>WHEN</label>
      <div class="chip-select" id="fSlotChips">
        ${SLOT_PRESETS.map(s=>`<button type="button" class="chip" data-slot="${s}">${s}</button>`).join('')}
      </div>
      <input type="text" id="fSlotName" placeholder="Custom label" style="margin-top:8px" value="Morning">
    </div>
    <div class="field">
      <label>ROUTINE</label>
      <select id="fScheduleRoutine">${routineOptions}</select>
    </div>
    <button class="btn-primary full" id="fAddScheduleSave">Add to schedule</button>
  `;
  openModal(html);
  document.getElementById('fSlotChips').addEventListener('click', e=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    document.getElementById('fSlotName').value = btn.dataset.slot;
    document.querySelectorAll('#fSlotChips .chip').forEach(c=>c.classList.toggle('active', c===btn));
  });
  document.getElementById('fAddScheduleSave').addEventListener('click', ()=>{
    const slot = document.getElementById('fSlotName').value.trim() || 'Anytime';
    const routineId = document.getElementById('fScheduleRoutine').value;
    DB.schedule[day].push({id:uid(), slot, routineId});
    saveDB(); closeModal(); renderAll();
    toast('Added to schedule');
  });
}

/* ---------------------------- SESSION (active workout) ---------------------------- */
function startSession(routineId, slot){
  const routine = findRoutine(routineId);
  if(!routine || routine.items.length===0){ toast('This routine has no exercises'); return; }
  const session = {
    id: uid(), date: todayStr(), routineId, slot,
    startedAt: Date.now(), endedAt: null, currentIndex: 0,
    logs: routine.items.map(it=>({itemId:it.id, exerciseId:it.exerciseId, target: Object.assign({}, it.target), actual:null, effort:null, skipped:false}))
  };
  saveActive(session);
  sessionTimer = {running:false, elapsed:0, handle:null};
  document.getElementById('sessionOverlay').hidden = false;
  document.getElementById('sessionRoutineName').textContent = `${routine.name} · ${slot}`;
  renderSessionStep();
}

let sessionTimer = {running:false, elapsed:0, handle:null};

function renderSessionStep(){
  const active = loadActive();
  if(!active){ closeSessionOverlay(); return; }
  const idx = active.currentIndex;
  const total = active.logs.length;
  document.getElementById('sessionProgress').textContent = `${Math.min(idx+1,total)} / ${total}`;

  if(idx>=total){ finalizeSession(active,false); return; }

  const log = active.logs[idx];
  const ex = findExercise(log.exerciseId) || {name:'(deleted exercise)', type:'checkbox', target:{}};
  const t = log.target || {};
  const isLast = idx===total-1;

  let fieldsHtml = '';
  if(ex.type==='reps'){
    fieldsHtml = `<div class="ex-log-fields">
      <div class="field"><label>SETS</label><input type="number" id="aSets" value="${t.sets||1}" min="0"></div>
      <div class="field"><label>REPS</label><input type="number" id="aReps" value="${t.reps||0}" min="0"></div>
    </div>`;
  } else if(ex.type==='time'){
    fieldsHtml = `
      <div class="timer-display" id="timerDisplay">${formatSeconds(sessionTimer.elapsed)}</div>
      <div class="btn-row" style="margin-bottom:14px">
        <button class="btn-secondary" id="timerToggle">${sessionTimer.running?'Stop':'Start timer'}</button>
      </div>
      <div class="ex-log-fields"><div class="field"><label>OR ENTER SECONDS</label><input type="number" id="aSeconds" value="${t.seconds||0}" min="0"></div></div>`;
  } else if(ex.type==='distance'){
    fieldsHtml = `<div class="ex-log-fields">
      <div class="field"><label>REPS</label><input type="number" id="aDReps" value="${t.reps||1}" min="0"></div>
      <div class="field"><label>METERS</label><input type="number" id="aMeters" value="${t.meters||0}" min="0"></div>
    </div>`;
  } else {
    fieldsHtml = `<div class="hint">Mark it done when you've done it.</div>`;
  }

  document.getElementById('sessionBody').innerHTML = `
    <div class="ex-card">
      <div class="ex-name">${escapeHtml(ex.name)}</div>
      <div class="ex-target">Planned: ${formatTarget(ex.type, t)}</div>
      ${fieldsHtml}
      <div class="effort-row">
        <div class="eyebrow">EFFORT</div>
        <div class="effort-scale" id="effortScale">
          ${[1,2,3,4,5].map(n=>`<button type="button" class="effort-dot" data-effort="${n}">${n}</button>`).join('')}
        </div>
      </div>
      <div class="session-actions">
        <button class="btn-primary" id="btnDone">${isLast?'Finish session':'Mark done →'}</button>
        <button class="btn-secondary" id="btnSkip">Skip this one</button>
      </div>
    </div>
  `;

  let selectedEffort = null;
  document.getElementById('effortScale').addEventListener('click', e=>{
    const btn = e.target.closest('.effort-dot'); if(!btn) return;
    selectedEffort = +btn.dataset.effort;
    document.querySelectorAll('.effort-dot').forEach(d=>d.classList.toggle('active', d===btn));
  });

  if(ex.type==='time'){
    document.getElementById('timerToggle').addEventListener('click', ()=>{
      if(sessionTimer.running){
        clearInterval(sessionTimer.handle);
        sessionTimer.running=false;
        document.getElementById('aSeconds').value = sessionTimer.elapsed;
        renderSessionStep();
      } else {
        sessionTimer.running=true;
        sessionTimer.handle = setInterval(()=>{
          sessionTimer.elapsed++;
          const disp = document.getElementById('timerDisplay');
          if(disp) disp.textContent = formatSeconds(sessionTimer.elapsed);
        },1000);
        renderSessionStep();
      }
    });
  }

  document.getElementById('btnDone').addEventListener('click', ()=>{
    let actual = {};
    if(ex.type==='reps') actual = {sets:+document.getElementById('aSets').value||0, reps:+document.getElementById('aReps').value||0};
    else if(ex.type==='time') actual = {seconds:+document.getElementById('aSeconds').value||sessionTimer.elapsed||0};
    else if(ex.type==='distance') actual = {reps:+document.getElementById('aDReps').value||0, meters:+document.getElementById('aMeters').value||0};
    else actual = {done:true};
    log.actual = actual; log.effort = selectedEffort; log.skipped = false;
    if(sessionTimer.running){ clearInterval(sessionTimer.handle); }
    sessionTimer = {running:false, elapsed:0, handle:null};
    active.currentIndex++;
    saveActive(active);
    renderSessionStep();
  });
  document.getElementById('btnSkip').addEventListener('click', ()=>{
    log.skipped = true; log.actual = null; log.effort = selectedEffort;
    if(sessionTimer.running){ clearInterval(sessionTimer.handle); }
    sessionTimer = {running:false, elapsed:0, handle:null};
    active.currentIndex++;
    saveActive(active);
    renderSessionStep();
  });
}

function tapOut(){
  const active = loadActive();
  if(!active){ closeSessionOverlay(); return; }
  const doneOrSkippedCount = active.currentIndex;
  if(doneOrSkippedCount < active.logs.length){
    if(!confirm('End this session now? What you\'ve logged so far will be saved, the rest counts as skipped.')) return;
  }
  for(let i=active.currentIndex;i<active.logs.length;i++){
    if(active.logs[i].actual===null && !active.logs[i].skipped) active.logs[i].skipped = true;
  }
  active.currentIndex = active.logs.length;
  finalizeSession(active,true);
}

function finalizeSession(active){
  if(sessionTimer.running) clearInterval(sessionTimer.handle);
  active.endedAt = Date.now();
  DB.sessions.push(active);
  saveDB();
  clearActive();
  const ratio = sessionRatio(active);
  const pct = Math.round(ratio*100);
  const status = sessionStatus(active);
  const doneCount = active.logs.filter(l=>!l.skipped).length;
  document.getElementById('sessionProgress').textContent = '';
  document.getElementById('sessionBody').innerHTML = `
    <div class="session-summary">
      <div class="eyebrow">SESSION ${status.toUpperCase()}</div>
      <div class="summary-ring">${pct}%</div>
      <div class="hint">${doneCount} of ${active.logs.length} exercises logged</div>
      <button class="btn-primary full" id="btnSessionDone" style="margin-top:20px">Done</button>
    </div>
  `;
  document.getElementById('btnSessionDone').addEventListener('click', ()=>{
    closeSessionOverlay(); renderAll();
  });
}

function closeSessionOverlay(){
  document.getElementById('sessionOverlay').hidden = true;
}

/* ---------------------------- INIT / EVENTS ---------------------------- */
function init(){
  // nav
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click', ()=>switchView(b.dataset.view)));
  document.getElementById('streakChip').addEventListener('click', ()=>switchView('history'));

  // build subnav
  document.getElementById('buildSubnav').addEventListener('click', e=>{
    const btn = e.target.closest('.subnav-btn'); if(!btn) return;
    buildTab = btn.dataset.btab; renderBuild();
  });
  document.getElementById('newExerciseBtn').addEventListener('click', ()=>exerciseModal(null));
  document.getElementById('newRoutineBtn').addEventListener('click', ()=>routineModal(null));

  // modal backdrop close
  document.getElementById('modalOverlay').addEventListener('click', e=>{
    if(e.target.id==='modalOverlay') closeModal();
  });

  // session close (tap out)
  document.getElementById('sessionClose').addEventListener('click', tapOut);

  // history settings
  document.getElementById('streakModeSelect').addEventListener('change', e=>{
    DB.settings.streakMode = e.target.value; saveDB(); renderHistory(); renderHeader();
  });
  document.getElementById('thresholdSlider').addEventListener('input', e=>{
    DB.settings.thresholdPct = +e.target.value;
    document.getElementById('thresholdVal').textContent = e.target.value+'%';
  });
  document.getElementById('thresholdSlider').addEventListener('change', ()=>{
    saveDB(); renderHistory(); renderHeader();
  });

  // delegated clicks for dynamic content
  document.getElementById('views').addEventListener('click', e=>{
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const action = el.dataset.action;
    if(action==='go-build'){ switchView('build'); }
    if(action==='start-session'){ startSession(el.dataset.routine, el.dataset.slot); }
    if(action==='edit-routine'){ routineModal(el.dataset.id); }
    if(action==='del-routine'){
      if(confirm('Delete this routine?')){
        DB.routines = DB.routines.filter(r=>r.id!==el.dataset.id);
        WEEKDAYS.forEach(wd=>{ DB.schedule[wd] = DB.schedule[wd].filter(e2=>e2.routineId!==el.dataset.id); });
        saveDB(); renderAll();
      }
    }
    if(action==='edit-exercise'){ exerciseModal(el.dataset.id); }
    if(action==='del-exercise'){
      if(confirm('Delete this exercise?')){
        DB.exercises = DB.exercises.filter(x=>x.id!==el.dataset.id);
        DB.routines.forEach(r=>{ r.items = r.items.filter(it=>it.exerciseId!==el.dataset.id); });
        saveDB(); renderAll();
      }
    }
    if(action==='add-schedule'){ addScheduleModal(el.dataset.day); }
    if(action==='rm-schedule'){
      DB.schedule[el.dataset.day] = DB.schedule[el.dataset.day].filter(e2=>e2.id!==el.dataset.entry);
      saveDB(); renderAll();
    }
  });

  // resume an in-progress session if the app was closed mid-workout
  const active = loadActive();
  if(active && active.currentIndex < active.logs.length){
    const routine = findRoutine(active.routineId);
    document.getElementById('sessionOverlay').hidden = false;
    document.getElementById('sessionRoutineName').textContent = `${routine?routine.name:'Session'} · ${active.slot}`;
    renderSessionStep();
  } else if(active){
    clearActive();
  }

  renderAll();

  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
