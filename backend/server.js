const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const cors    = require('cors');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Vehicle registry ────────────────────────────────────────────────────────
const vehicles   = {};   // { [id]: vehicleState }
const tripData   = {};   // { [id]: { speedSamples, startTime, alertLog, alertId, prevOver } }
let   alertGlobalId = 1;

const VEHICLE_NAMES = {
  A: 'Tesla Model S', B: 'Rivian R1T', C: 'BMW iX',
  D: 'Hyundai IONIQ 6', E: 'Chevy Equinox EV',
};

function round(n, d = 1) { return Math.round(n * 10 ** d) / 10 ** d; }

function createVehicle(id) {
  const battery = 60 + Math.floor(Math.random() * 35);
  vehicles[id] = {
    id,
    name: VEHICLE_NAMES[id] || `Vehicle ${id}`,
    speed: 0,
    speedLimit: 80,
    battery,
    power: 0,
    distance: 0,
    avgSpeed: 0,
    mode: 'normal',
    motorTemp: 36 + Math.floor(Math.random() * 6),
    isCharging: false,
    status: 'idle',
    tripDuration: 0,
    alerts: [],
    lastSeen: Date.now(),
    online: true,
  };
  tripData[id] = {
    speedSamples: [],
    startTime: null,
    alertLog: [],
    alertId: 0,
    prevOver: false,
    maxSpeed: 0,
  };
  return vehicles[id];
}

function getOrCreate(id) {
  return vehicles[id] || createVehicle(id);
}

// ── Derived state ────────────────────────────────────────────────────────────
function computeDerived(v) {
  const td = tripData[v.id];
  const maxPower = { eco: 60, normal: 100, sport: 150 }[v.mode] || 100;
  v.power = v.speed > 0 ? round((v.speed / 200) * maxPower, 1) : 0;
  v.motorTemp = Math.min(98, round(34 + (v.speed / 200) * 58 + Math.random() * 2, 1));
  if (v.speed > 0) {
    td.speedSamples.push(v.speed);
    if (v.speed > td.maxSpeed) td.maxSpeed = v.speed;
  }
  v.avgSpeed = td.speedSamples.length
    ? Math.round(td.speedSamples.reduce((a, b) => a + b, 0) / td.speedSamples.length)
    : 0;
  if (td.startTime && v.speed > 0) v.tripDuration = Math.floor((Date.now() - td.startTime) / 1000);
  if (v.speed === 0)      v.status = v.isCharging ? 'charging' : 'idle';
  else if (v.speed > v.speedLimit) v.status = 'overspeed';
  else                   v.status = 'driving';
}

// ── Alert helpers ────────────────────────────────────────────────────────────
function addAlert(vid, type, message, severity = 'info') {
  const td = tripData[vid];
  const v  = vehicles[vid];
  const alert = {
    id: alertGlobalId++,
    vehicleId: vid,
    vehicleName: v.name,
    type, message, severity,
    timestamp: new Date().toISOString(),
    speed: v.speed,
    limit: v.speedLimit,
  };
  td.alertLog.unshift(alert);
  if (td.alertLog.length > 100) td.alertLog.pop();
  v.alerts = td.alertLog.slice(0, 5);
  return alert;
}

// ── Broadcast helpers ────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function broadcastVehicle(id) {
  broadcast({ type: 'state', vehicleId: id, payload: vehicles[id] });
}

function broadcastFleet() {
  broadcast({ type: 'fleet', payload: Object.values(vehicles) });
}

// ── Simulation tick ──────────────────────────────────────────────────────────
setInterval(() => {
  Object.values(vehicles).forEach(v => {
    const td = tripData[v.id];
    v.lastSeen = Date.now();

    if (v.speed > 0) {
      v.distance = round(v.distance + v.speed / 3600 * 2, 2);
      const drain = (v.speed / 200) * 0.035;
      v.battery = Math.max(0, round(v.battery - drain, 2));
      computeDerived(v);

      const over = v.speed > v.speedLimit;
      if (over && !td.prevOver) {
        const a = addAlert(v.id, 'overspeed', `Exceeded limit by ${v.speed - v.speedLimit} km/h`, 'danger');
        broadcast({ type: 'alert', vehicleId: v.id, payload: a });
      }
      if (!over && td.prevOver) {
        const a = addAlert(v.id, 'speed_ok', 'Speed returned within limit', 'info');
        broadcast({ type: 'alert', vehicleId: v.id, payload: a });
      }
      td.prevOver = over;

      if (v.battery < 15 && Math.random() < 0.05) {
        const a = addAlert(v.id, 'low_battery', `Battery low: ${Math.round(v.battery)}%`, 'warning');
        broadcast({ type: 'alert', vehicleId: v.id, payload: a });
      }
    }
    broadcastVehicle(v.id);
  });
  broadcastFleet();
}, 2000);

// ── REST: Fleet ──────────────────────────────────────────────────────────────
app.get('/api/vehicles', (req, res) => {
  res.json(Object.values(vehicles));
});

app.post('/api/vehicles', (req, res) => {
  const { id, name } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const v = createVehicle(id.toUpperCase());
  if (name) v.name = name;
  broadcastVehicle(v.id);
  broadcastFleet();
  res.status(201).json(v);
});

// ── REST: Per-vehicle ────────────────────────────────────────────────────────
app.get('/api/vehicles/:id', (req, res) => {
  res.json(getOrCreate(req.params.id.toUpperCase()));
});

app.post('/api/vehicles/:id/speed', (req, res) => {
  const { speed } = req.body;
  if (typeof speed !== 'number' || speed < 0 || speed > 250)
    return res.status(400).json({ error: 'Speed must be 0–250' });
  const id = req.params.id.toUpperCase();
  const v  = getOrCreate(id);
  const td = tripData[id];
  const prev = v.speed;
  v.speed = Math.round(speed);
  v.lastSeen = Date.now();
  if (prev === 0 && speed > 0) { td.startTime = td.startTime || Date.now(); addAlert(id, 'trip_start', 'Trip started'); }
  if (prev > 0 && speed === 0) addAlert(id, 'trip_stop', 'Vehicle stopped');
  computeDerived(v);
  broadcastVehicle(id);
  res.json({ success: true, id, speed: v.speed });
});

app.post('/api/vehicles/:id/limit', (req, res) => {
  const { limit } = req.body;
  if (typeof limit !== 'number' || limit < 20 || limit > 150)
    return res.status(400).json({ error: 'Limit must be 20–150' });
  const id = req.params.id.toUpperCase();
  const v  = getOrCreate(id);
  v.speedLimit = Math.round(limit);
  addAlert(id, 'limit_change', `Speed limit set to ${v.speedLimit} km/h`);
  broadcastVehicle(id);
  res.json({ success: true, speedLimit: v.speedLimit });
});

app.post('/api/vehicles/:id/mode', (req, res) => {
  const { mode } = req.body;
  if (!['eco', 'normal', 'sport'].includes(mode))
    return res.status(400).json({ error: 'Mode must be eco|normal|sport' });
  const id = req.params.id.toUpperCase();
  const v  = getOrCreate(id);
  v.mode = mode;
  addAlert(id, 'mode_change', `Mode set to ${mode.toUpperCase()}`);
  computeDerived(v);
  broadcastVehicle(id);
  res.json({ success: true, mode });
});

app.post('/api/vehicles/:id/charging', (req, res) => {
  const id = req.params.id.toUpperCase();
  const v  = getOrCreate(id);
  v.isCharging = !!req.body.charging;
  if (v.isCharging) v.speed = 0;
  addAlert(id, 'charging', v.isCharging ? 'Charging started' : 'Charging stopped');
  broadcastVehicle(id);
  res.json({ success: true, isCharging: v.isCharging });
});

app.post('/api/vehicles/:id/reset', (req, res) => {
  const id = req.params.id.toUpperCase();
  const v  = getOrCreate(id);
  const td = tripData[id];
  v.distance = 0; v.avgSpeed = 0; v.tripDuration = 0; v.alerts = [];
  td.speedSamples = []; td.startTime = null; td.alertLog = []; td.maxSpeed = 0; td.prevOver = false;
  broadcastVehicle(id);
  res.json({ success: true });
});

app.delete('/api/vehicles/:id', (req, res) => {
  const id = req.params.id.toUpperCase();
  delete vehicles[id];
  delete tripData[id];
  broadcast({ type: 'remove', vehicleId: id });
  broadcastFleet();
  res.json({ success: true });
});

app.get('/api/vehicles/:id/alerts', (req, res) => {
  const id = req.params.id.toUpperCase();
  const td = tripData[id];
  if (!td) return res.json([]);
  res.json(td.alertLog.slice(0, parseInt(req.query.limit) || 20));
});

app.get('/api/alerts', (req, res) => {
  const all = Object.keys(tripData)
    .flatMap(id => tripData[id].alertLog)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, parseInt(req.query.limit) || 50);
  res.json(all);
});

// ── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', ws => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ type: 'fleet', payload: Object.values(vehicles) }));
  ws.on('message', raw => {
    try { const m = JSON.parse(raw); if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' })); } catch {}
  });
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/public/index.html')));

// ── Seed demo vehicles ────────────────────────────────────────────────────────
['A','B','C','D','E'].forEach(id => createVehicle(id));

// Simulate some activity at startup
setTimeout(() => {
  const speeds = { A: 72, B: 95, C: 0, D: 45, E: 110 };
  Object.entries(speeds).forEach(([id, speed]) => {
    const v = vehicles[id]; if (!v) return;
    v.speed = speed;
    const td = tripData[id];
    if (speed > 0) { td.startTime = Date.now() - Math.floor(Math.random() * 600000); v.distance = round(Math.random() * 30, 1); }
    computeDerived(v);
  });
  console.log('Demo vehicles seeded with initial speeds');
}, 500);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`EV Fleet server running → http://localhost:${PORT}`));
