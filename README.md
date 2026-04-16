# EV-Dashboard
# ⚡ EV Monitor

Real-time multi-vehicle fleet monitoring dashboard with WebSocket live updates.

## Setup & Run

```bash
cd backend
npm install
node server.js
# Open → http://localhost:3000
```

## Project Structure

```
ev-fleet/
├── backend/
│   ├── server.js          # Express + WebSocket, vehicles map
│   └── package.json
└── frontend/public/
    ├── index.html         # Fleet grid + detail panel
    ├── style.css          # Dark HUD theme
    └── app.js             # WS client, multi-vehicle state
```

## REST API

| Method   | Endpoint                        | Description                  |
|----------|---------------------------------|------------------------------|
| GET      | /api/vehicles                   | All vehicles (fleet overview)|
| POST     | /api/vehicles                   | Add new vehicle {id, name}   |
| GET      | /api/vehicles/:id               | Single vehicle state         |
| POST     | /api/vehicles/:id/speed         | Set speed {speed}            |
| POST     | /api/vehicles/:id/limit         | Set limit {limit}            |
| POST     | /api/vehicles/:id/mode          | Set mode {mode}              |
| POST     | /api/vehicles/:id/charging      | Toggle charging {charging}   |
| POST     | /api/vehicles/:id/reset         | Reset trip                   |
| DELETE   | /api/vehicles/:id               | Remove vehicle               |
| GET      | /api/vehicles/:id/alerts        | Vehicle alert log            |
| GET      | /api/alerts                     | All alerts across fleet      |

## WebSocket Events (Server → Client)

```json
{ "type": "fleet",  "payload": [ ...all vehicles ] }
{ "type": "state",  "vehicleId": "A", "payload": { ...vehicleState } }
{ "type": "alert",  "vehicleId": "A", "payload": { ...alert } }
{ "type": "remove", "vehicleId": "A" }
```

## Test with curl

```bash
# Set speed for vehicle A
curl -X POST http://localhost:3000/api/vehicles/A/speed \
  -H "Content-Type: application/json" -d "{\"speed\": 95}"

# Add a new vehicle
curl -X POST http://localhost:3000/api/vehicles \
  -H "Content-Type: application/json" -d "{\"id\": \"F\", \"name\": \"Kia EV6\"}"

# Get entire fleet
curl http://localhost:3000/api/vehicles

# Get all alerts
curl http://localhost:3000/api/alerts
```

## Features

- **Fleet grid** — live cards for every vehicle, color-coded by status
- **Filter tabs** — All / Driving / Alerts / Idle
- **Click to inspect** — side-by-side detail panel with speedometer
- **Add / Remove** vehicles dynamically
- **Per-vehicle controls** — speed, limit, mode, charging
- **Global alert banner** — pops for any overspeed event fleet-wide
- **Per-vehicle event log** — shown in detail panel
- **5 demo vehicles seeded** on startup (A–E)
- **WebSocket broadcast** — all clients stay in sync in real-time
"# EV-Dashboard" 
