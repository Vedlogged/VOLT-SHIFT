# VOLT//SHIFT

> **"Capture the Energy. Shift the Arena. Steal the Advantage."**

A fast-paced, server-authoritative, two-player competitive cyber arena game built for the **Handshake AI Skills Studio × OpenAI Multiplayer Game Challenge**.

Two pilots compete in high-voltage neon sectors. Capturing unstable energy nodes causes the shared arena to shift and displaces surrounding power. Captured nodes remain vulnerable to rival interception for a critical window before locking in for permanent victory points.

---

## ⚡ Core Game Mechanics

```
   MOVE (WASD / Touch)
        ↓
   FIND ENERGY (Alpha · Core · Omega Sectors)
        ↓
   CAPTURE (+10 to +20 pts)
        ↓
   ARENA SHIFT (Kinetic shockwave displaces nearby nodes)
        ↓
   CONTEST & STEAL (Vulnerable countdown before lock)
        ↓
   LOCK IN (+5 to +25 bonus)
        ↓
   BEST OF 3 (Sudden Death Singularity if tied at 60s)
```

### Strategic Energy Types
- **⚡ VOLT CORE (`normal`):** +10 pts. Standard kinetic displacement shockwave.
- **💥 SURGE CORE (`surge`):** +15 pts. Massive high-energy shockwave (radius 36) that propels surrounding nodes across sectors.
- **🛡️ ANCHOR CORE (`anchor`):** +10 pts. Ultra-fast lock (1.6s vs 2.5s) that dampens local arena turbulence.
- **🌀 VOID RIFT (`void`):** +20 pts. High-stakes contested energy. If stolen by a rival, the victim suffers a -5 pt penalty!
- **⚡⚡ OMEGA SINGULARITY (`sudden_death`):** +25 pts. Spawns in Core Nexus when a 60s round ends in a tie. First pilot to capture and lock wins the round immediately!

---

## 🏆 Competition Criteria Alignment

| Dimension | Weight | Production Implementation |
|---|---|---|
| **Execution** | 25% | 100% server-authoritative simulation, sub-50ms tick rate, zero client-trusted score logic, anti-cheat coordinate clamping & rate limiting, 20s disconnect grace period, host migration. |
| **Creativity** | 25% | Unique *"Capturing energy changes the battlefield"* mechanic with 4 tactical node archetypes, directional sector shockwaves, and high-tension contest/steal dynamics. |
| **Usefulness / Value** | 25% | Frictionless zero-account matchmaking via 4-character room codes, direct invite links (`?room=CODE`), interactive in-game field manual, and responsive dual controls (desktop WASD + mobile touch joystick). |
| **Polish & Thoughtfulness** | 25% | Directional vector SVG craft with plasma thruster flickers, procedural Web Audio synthesis (zero external audio asset latency or 404s), synchronized screen shockwaves, and distinct accessibility contrast. |

---

## 🛠️ Architecture

- **Authoritative Backend (`/server`):** Node.js ES Modules, Express 5, Socket.IO 4.8.
  - Rate-limited movement and capture actions.
  - Server-authoritative timer, scoring, and state machine.
  - Lightweight `/health` monitoring endpoint reporting uptime, active rooms, players, and memory usage.
- **Responsive Frontend (`/client`):** React 19, Vite 6, Vanilla CSS design tokens.
  - Procedural Web Audio Engine (`sound.js`) with zero audio assets to load.
  - High-performance 60fps CSS animations and dynamic SVG craft rendering.
  - Seamless dual desktop/mobile UX with virtual touch joystick and tactile CAPTURE button.

---

## 🧪 Automated QA Matrix

All tests run autonomously via `npm test --workspace server`:

| Test Suite | Description | Status |
|---|---|---|
| `game.test.js` | Unit tests: board initialization, movement clamping, anti-cheat validation, capture radius, surge radius, void penalty | **PASS** |
| `match_lifecycle.test.js` | Full Best-of-3 simulation, round transitions, tied-round sudden death trigger, match victory, rematch reset | **PASS** |
| `multiplayer.test.js` | Two independent Socket.IO clients over subprocess server: room creation, joining, full room rejection, countdown sync | **PASS** |
| `full_e2e_gameplay.test.js` | End-to-end multi-client gameplay: movement dispatch, node type diversity, authoritative capture evaluation | **PASS** |
| `npm run build` | Production Vite bundle optimization & CSS compilation | **PASS** |

---

## 🚀 Local Quickstart

### Prerequisites
Node.js 20+

```bash
# 1. Install dependencies
npm run install:all

# 2. Run automated test suites
npm test --workspace server

# 3. Start local development
# Terminal A (Backend):
cd server && npm run dev

# Terminal B (Frontend):
cd client && npm run dev
```

Frontend: `http://localhost:5173`  
Backend Health Check: `http://localhost:3001/health`

---

## 🌐 Production Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full step-by-step instructions for:
- **Backend on Render:** Auto-deploy via `render.yaml` with health checks on `/health`.
- **Frontend on Vercel:** Root or `/client` deployment with `VITE_SERVER_URL` environment variable.
