# VOLT//SHIFT Production Deployment & Verification Guide

## 1. Production Architecture Overview

```
 [ PLAYER A: Desktop (Wi-Fi) ]        [ PLAYER B: Mobile (Cellular) ]
                \                                  /
                 \                                /
                  ▼                              ▼
      [ VERCEL FRONTEND: https://volt-shift.vercel.app ]
                         │
                    HTTPS / WSS
                         │
                         ▼
  [ RENDER WEBSOCKET BACKEND: https://volt-shift-server.onrender.com ]
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
   20Hz Authoritative             /health Monitor
      Tick Loop                   Uptime & Metrics
```

---

## 2. Backend Deployment (Render)

1. Connect the GitHub repository `Vedlogged/VOLT-SHIFT` to Render.
2. Select **Web Service** using the root `render.yaml` or manual configuration:
   - **Root Directory:** `server`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
   - **Auto-Deploy:** `Yes`
3. Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: (Auto-assigned by Render, defaults to 10000 on Render or 3001 locally)
4. Verification:
   Open `https://<YOUR-RENDER-SERVICE>.onrender.com/health` in your browser.
   It should return:
   ```json
   {
     "ok": true,
     "status": "healthy",
     "service": "volt-shift-server",
     "version": "1.2.0",
     "uptimeSeconds": 42,
     "activeRooms": 0,
     "activePlayers": 0,
     "memoryUsageMB": 12,
     "timestamp": "2026-09-28T17:30:00.000Z"
   }
   ```

---

## 3. Frontend Deployment (Vercel)

1. Import the repository `Vedlogged/VOLT-SHIFT` into Vercel.
2. **Root Directory:** `./` or `client` (Both are supported by the universal build script and `vercel.json` rewrites).
3. **Build Command:** `npm run build`
4. **Output Directory:** `dist`
5. **Environment Variable:**
   - `VITE_SERVER_URL`: `https://<YOUR-RENDER-SERVICE>.onrender.com`
6. Deploy.

---

## 4. Dual-Device External Multiplayer Verification Protocol

To verify full production readiness across real network conditions:

### Devices Required:
- **Device 1 (Host):** Laptop or Desktop connected to home/office Wi-Fi.
- **Device 2 (Rival):** Smartphone connected via 4G/5G mobile cellular data (NOT on the same Wi-Fi).

### Step-by-Step Test Procedure:
1. **Launch:** Open the public Vercel URL on Device 1.
2. **Create Sector:** Enter callsign `"AlphaLeader"` and click **CREATE ROOM**.
3. **Code & Link:** Confirm a 4-letter room code (e.g. `K7PX`) is displayed. Click **COPY LINK**.
4. **Join:** On Device 2 (Mobile), open the copied link or enter code `K7PX` with callsign `"OmegaRival"`.
5. **Lobby Sync:**
   - Device 1 sees Player 2 arrive as `OmegaRival` [Shift Phantom].
   - Device 2 sees Player 1 as `AlphaLeader` [Volt Striker].
6. **Ready Up:** Click **PILOT READY** on both devices. Status changes to `● READY TO LAUNCH`.
7. **Host Start:** Device 1 clicks **ENGAGE MATCH**. Both devices trigger a synchronized 3-2-1 countdown.
8. **Movement Sync:**
   - Move Device 1 via WASD. Device 2 observes real-time craft movement with thruster trail.
   - Steer Device 2 via the virtual touch joystick. Device 1 observes smooth responsive movement.
9. **Capture & Arena Shift:**
   - Device 1 flies to an orange Surge Core and presses Space / CAPTURE.
   - Both devices simultaneously display the visual shockwave, floating text `+15 SURGE CAPTURE!`, and surrounding nodes physically shifting outwards.
10. **Steal & Intercept:**
    - Before the 2.5s contest timer elapses, Device 2 dives onto the same node and taps the big glowing CAPTURE button.
    - Power shifts to Device 2, audio plays the steal tritone warning, and points transfer authoritatively.
11. **Round & Match Resolution:**
    - Play until the 60s timer expires. The round victory overlay appears with accurate scores.
    - If tied at 60s, verify central Sudden Death Singularity spawns and resolves the round.
    - Advance to Round 2 and 3 until a pilot achieves 2 round wins.
12. **Rematch Verification:**
    - Both devices click **REQUEST REMATCH**.
    - The same sector immediately resets into Round 1 without requiring re-entry of the room code.
13. **Reconnection Verification:**
    - Refresh the browser on Device 2 during the lobby.
    - Within the 20-second grace period, Device 2 reconnects automatically using its resume token and restores slot P2.

---

## 5. Security & Fairness Assurance

- **Authoritative Calculations:** Scores, timers, node states, and winner determinations are strictly calculated by the Node.js server.
- **Input Sanitization:** Malformed coordinate objects, non-finite values (`NaN`, `Infinity`), and HTML tags in callsigns are sanitized.
- **Rate Limiting:** Movement input is throttled to prevent client speed hacks. Capture requests enforce an 80ms anti-spam interval.
- **DoS Protection:** Room capacity is capped at 500 active rooms with automatic cleanup for abandoned lobbies.
