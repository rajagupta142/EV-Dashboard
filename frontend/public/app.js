/* ── Config ── */
const BASE = window.location.origin;
const WS_URL = `ws://${window.location.host}`;

/* ── State ── */
const vehicleStates = {};   // { [id]: vehicleState }
let selectedId = null;
let ws = null, wsRetries = 0;
let logCounts = {};          // { [id]: number }
let filterMode = 'all';
let bannerDismissed = false;

/* ── DOM ── */
const $ = id => document.getElementById(id);
const connDot     = $('connDot'),     connLabel   = $('connLabel');
const fsTotal     = $('fsTotal'),     fsDriving   = $('fsDriving');
const fsAlert     = $('fsAlert'),     fsIdle      = $('fsIdle');
const fleetGrid   = $('fleetGrid');
const detailSection = $('detailSection');
const fleetSection  = $('fleetSection');
const mainLayout    = $('mainLayout');
const closeDetailBtn = $('closeDetailBtn');
const alertBanner   = $('alertBanner'),  alertBannerMsg = $('alertBannerMsg');
const speedVal    = $('speedVal'),    limitNum    = $('limitNum');
const limitPill   = $('limitPill'),   arcFill     = $('arcFill');
const needle      = $('needle'),      limitTick   = $('limitTick');
const speedSlider = $('speedSlider'), limitSlider = $('limitSlider');
const speedOut    = $('speedOut'),    limitOut    = $('limitOut');
const chargeToggle = $('chargeToggle');
const battVal     = $('battVal'),     battFill    = $('battFill'),  battRange  = $('battRange');
const tempVal     = $('tempVal'),     tempFill    = $('tempFill'),  tempStatus = $('tempStatus');
const powerVal    = $('powerVal'),    powerSub    = $('powerSub');
const distVal     = $('distVal'),     avgVal      = $('avgVal');
const logList     = $('logList'),     logCount    = $('logCount');
const detailName  = $('detailName'),  detailSub   = $('detailSub');
const ARC_LEN = 396;

/* ── WebSocket ── */
function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    wsRetries = 0;
    connDot.className = 'conn-dot live';
    connLabel.textContent = 'Live';
  };
  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'fleet') {
        msg.payload.forEach(v => { vehicleStates[v.id] = v; });
        renderFleetGrid();
        updateSummary();
      } else if (msg.type === 'state') {
        vehicleStates[msg.vehicleId] = msg.payload;
        updateVehicleCard(msg.vehicleId);
        updateSummary();
        if (msg.vehicleId === selectedId) applyDetailState(msg.payload);
      } else if (msg.type === 'alert') {
        handleAlert(msg.payload);
      } else if (msg.type === 'remove') {
        delete vehicleStates[msg.vehicleId];
        if (selectedId === msg.vehicleId) closeDetail();
        renderFleetGrid();
        updateSummary();
      }
    } catch (e) { console.error(e); }
  };
  ws.onclose = () => {
    connDot.className = 'conn-dot err';
    connLabel.textContent = 'Reconnecting…';
    wsRetries++;
    setTimeout(connectWS, Math.min(wsRetries * 1500, 8000));
  };
  ws.onerror = () => ws.close();
}

/* ── Summary bar ── */
function updateSummary() {
  const all = Object.values(vehicleStates);
  fsTotal.textContent   = all.length;
  fsDriving.textContent = all.filter(v => v.status === 'driving' || v.status === 'overspeed').length;
  fsAlert.textContent   = all.filter(v => v.status === 'overspeed').length;
  fsIdle.textContent    = all.filter(v => v.status === 'idle' || v.status === 'charging').length;
}

/* ── Fleet grid ── */
function renderFleetGrid() {
  const all = Object.values(vehicleStates);
  const filtered = all.filter(v => {
    if (filterMode === 'all')       return true;
    if (filterMode === 'driving')   return v.status === 'driving';
    if (filterMode === 'overspeed') return v.status === 'overspeed';
    if (filterMode === 'idle')      return v.status === 'idle' || v.status === 'charging';
    return true;
  });

  if (filtered.length === 0) {
    fleetGrid.innerHTML = `<div class="fleet-empty">No vehicles match this filter.</div>`;
    return;
  }

  fleetGrid.innerHTML = filtered.map(v => buildVehicleCard(v)).join('');
}

function buildVehicleCard(v) {
  const over = v.speed > v.speedLimit;
  const spdClass = over ? 'danger' : v.speed > v.speedLimit * 0.85 ? 'warn' : '';
  const selClass  = v.id === selectedId ? ' selected' : '';
  const statClass = v.status === 'overspeed' ? ' overspeed' : v.status === 'charging' ? ' charging' : '';
  const battPct   = Math.round(v.battery);
  const tempPct   = Math.round(((v.motorTemp - 30) / 65) * 100);
  return `
  <div class="v-card${selClass}${statClass}" onclick="selectVehicle('${v.id}')" id="card-${v.id}">
    <div class="vc-top">
      <span class="vc-id">${v.id}</span>
      <span class="vc-status ${v.status}">${v.status}</span>
    </div>
    <div class="vc-name">${v.name}</div>
    <div class="vc-speed-row">
      <span class="vc-speed ${spdClass}">${v.speed}</span>
      <span class="vc-kmh">km/h</span>
    </div>
    <div class="vc-bars">
      <div class="vc-bar-row">
        <span>🔋 ${battPct}%</span>
        <div class="vc-bar-track"><div class="vc-bar-fill batt-color" style="width:${battPct}%"></div></div>
      </div>
      <div class="vc-bar-row">
        <span>🌡 ${Math.round(v.motorTemp)}°C</span>
        <div class="vc-bar-track"><div class="vc-bar-fill temp-color" style="width:${Math.min(tempPct,100)}%"></div></div>
      </div>
    </div>
    <div class="vc-limit ${over ? 'over' : ''}">Limit: ${v.speedLimit} km/h</div>
  </div>`;
}

function updateVehicleCard(id) {
  const v = vehicleStates[id];
  if (!v) return;
  const existing = $(`card-${id}`);
  if (!existing) { renderFleetGrid(); return; }
  existing.outerHTML = buildVehicleCard(v);
}

/* ── Select / detail ── */
function selectVehicle(id) {
  selectedId = id;
  const v = vehicleStates[id];
  if (!v) return;

  detailSection.style.display = 'flex';
  mainLayout.classList.add('split');
  closeDetailBtn.style.display = '';

  detailName.textContent = v.name;
  detailSub.textContent  = `ID: ${v.id}`;

  // sync sliders
  speedSlider.value = v.speed;
  speedOut.textContent = v.speed;
  limitSlider.value = v.speedLimit;
  limitOut.textContent = v.speedLimit;
  chargeToggle.checked = !!v.isCharging;

  // sync mode chips
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.mode === v.mode));

  // sync log
  logCounts[id] = logCounts[id] || 0;
  logCount.textContent = logCounts[id] + ' events';

  applyDetailState(v);
  renderFleetGrid(); // re-render cards to show selection highlight
}

function closeDetail() {
  selectedId = null;
  detailSection.style.display = 'none';
  mainLayout.classList.remove('split');
  closeDetailBtn.style.display = 'none';
  renderFleetGrid();
}

function applyDetailState(v) {
  if (!v) return;
  const over = v.speed > v.speedLimit;

  speedVal.textContent = v.speed;
  speedVal.className = 'speed-val' + (over ? ' danger' : v.speed > v.speedLimit * 0.85 ? ' warn' : '');

  const ratio = Math.min(v.speed / 200, 1);
  arcFill.style.strokeDashoffset = ARC_LEN * (1 - ratio);
  needle.setAttribute('transform', `rotate(${-90 + ratio * 180} 150 155)`);
  const lRatio = Math.min(v.speedLimit / 200, 1);
  limitTick.setAttribute('transform', `rotate(${-90 + lRatio * 180} 150 155)`);

  limitNum.textContent = v.speedLimit;
  limitPill.className = 'limit-pill' + (over ? ' danger' : '');

  if (document.activeElement !== speedSlider) { speedSlider.value = v.speed; speedOut.textContent = v.speed; }
  if (document.activeElement !== limitSlider) { limitSlider.value = v.speedLimit; limitOut.textContent = v.speedLimit; }
  chargeToggle.checked = !!v.isCharging;

  const batt = Math.round(v.battery);
  battVal.textContent = batt + '%';
  battFill.style.width = batt + '%';
  battRange.textContent = `~${Math.round(batt * 4)} km range`;

  const temp = v.motorTemp;
  tempVal.textContent = Math.round(temp) + '°C';
  tempFill.style.width = Math.min(((temp - 30) / 65) * 100, 100).toFixed(1) + '%';
  tempStatus.textContent = temp > 80 ? '⚠ High' : temp > 60 ? 'Warm' : 'Normal';
  tempStatus.style.color = temp > 80 ? 'var(--red)' : temp > 60 ? 'var(--amber)' : '';

  powerVal.textContent = v.power + ' kW';
  powerSub.textContent = v.speed === 0 ? (v.isCharging ? 'Charging' : 'Idle') : v.power > 80 ? 'High draw' : 'Efficient';
  distVal.textContent = v.distance.toFixed(1) + ' km';
  avgVal.textContent = `Avg ${v.avgSpeed} km/h`;

  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.mode === v.mode));
}

/* ── Alert handling ── */
function handleAlert(alert) {
  const { vehicleId, severity, message, timestamp } = alert;

  if (severity === 'danger') {
    alertBannerMsg.textContent = `[${vehicleId}] ${message}`;
    bannerDismissed = false;
    alertBanner.classList.add('show');
    setTimeout(() => alertBanner.classList.remove('show'), 6000);
  }

  if (vehicleId === selectedId) {
    addLogEntry(alert);
    logCounts[vehicleId] = (logCounts[vehicleId] || 0) + 1;
    logCount.textContent = logCounts[vehicleId] + ' events';
  } else {
    logCounts[vehicleId] = (logCounts[vehicleId] || 0) + 1;
  }
}

function addLogEntry(alert) {
  const empty = logList.querySelector('.log-empty');
  if (empty) empty.remove();
  const bc = { danger: 'b-danger', warning: 'b-warning', info: 'b-info' }[alert.severity] || 'b-default';
  const mc = alert.severity === 'danger' ? 'danger' : '';
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `
    <span class="log-time">${new Date(alert.timestamp).toLocaleTimeString()}</span>
    <span class="log-badge ${bc}">${alert.severity}</span>
    <span class="log-msg ${mc}">${alert.message}</span>`;
  logList.insertBefore(el, logList.firstChild);
  if (logList.children.length > 20) logList.removeChild(logList.lastChild);
}

function dismissBanner() { alertBanner.classList.remove('show'); bannerDismissed = true; }

/* ── API helpers ── */
async function post(path, body) {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  } catch (e) { console.error(path, e); }
}
async function del(path) {
  try { return (await fetch(BASE + path, { method: 'DELETE' })).json(); } catch {}
}

/* ── Controls ── */
speedSlider.addEventListener('input', () => { speedOut.textContent = speedSlider.value; });
speedSlider.addEventListener('change', () => {
  if (!selectedId) return;
  post(`/api/vehicles/${selectedId}/speed`, { speed: parseInt(speedSlider.value) });
});

limitSlider.addEventListener('input', () => { limitOut.textContent = limitSlider.value; });
limitSlider.addEventListener('change', () => {
  if (!selectedId) return;
  post(`/api/vehicles/${selectedId}/limit`, { limit: parseInt(limitSlider.value) });
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (!selectedId) return;
    post(`/api/vehicles/${selectedId}/mode`, { mode: chip.dataset.mode });
  });
});

chargeToggle.addEventListener('change', () => {
  if (!selectedId) return;
  post(`/api/vehicles/${selectedId}/charging`, { charging: chargeToggle.checked });
});

$('resetBtn').addEventListener('click', () => {
  if (!selectedId) return;
  post(`/api/vehicles/${selectedId}/reset`, {});
  logList.innerHTML = '<div class="log-empty">No events yet.</div>';
  logCounts[selectedId] = 0;
  logCount.textContent = '0 events';
});

$('deleteBtn').addEventListener('click', () => {
  if (!selectedId || !confirm(`Remove ${selectedId} from fleet?`)) return;
  del(`/api/vehicles/${selectedId}`);
  closeDetail();
});

closeDetailBtn.addEventListener('click', closeDetail);

/* ── Filter tabs ── */
document.querySelectorAll('.ftab').forEach(tab => {
  tab.addEventListener('click', () => {
    filterMode = tab.dataset.filter;
    document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderFleetGrid();
  });
});

/* ── Add vehicle modal ── */
$('addVehicleBtn').addEventListener('click', () => $('modalOverlay').classList.add('open'));
function closeModal() { $('modalOverlay').classList.remove('open'); }
async function addVehicle() {
  const id   = $('newVehicleId').value.trim().toUpperCase();
  const name = $('newVehicleName').value.trim();
  if (!id) { alert('Vehicle ID is required'); return; }
  await post('/api/vehicles', { id, name });
  $('newVehicleId').value = '';
  $('newVehicleName').value = '';
  closeModal();
}
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });

/* ── Clock ── */
setInterval(() => { $('footerTime').textContent = new Date().toLocaleTimeString(); }, 1000);

/* ── Boot ── */
async function init() {
  try {
    const vehicles = await (await fetch(BASE + '/api/vehicles')).json();
    vehicles.forEach(v => { vehicleStates[v.id] = v; });
    renderFleetGrid();
    updateSummary();
  } catch {}
  connectWS();
}
init();
