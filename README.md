# VOLT//SHIFT

A polished two-player real-time browser game. Create a four-letter room, invite a friend, capture unstable energy, and outscore them in a best-of-three match.

## Local development

Requirements: Node.js 20+.

```bash
npm install --workspaces
npm run dev
```

Frontend: http://localhost:5173  
Server: http://localhost:3001/health

For a second device on the same LAN during development, run Vite with `--host 0.0.0.0` and point `VITE_SERVER_URL` at the host machine's LAN IP. Production should use the Render/Vercel setup described below.

## Multiplayer test

```bash
npm run test:multiplayer
```

This starts the server and connects two independent Socket.IO clients, creates a room, joins it, starts a match, checks identical synchronized state, and verifies a capture score propagates.

## Production

Deploy `/server` to a WebSocket-capable Node host (Render configuration included in `render.yaml`). Deploy `/client` to Vercel and set `VITE_SERVER_URL` to the deployed server URL. The server permits Socket.IO cross-origin connections.
