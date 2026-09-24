# VOLT//SHIFT deployment

## 1. Backend (Render)

Create a Render Web Service from the `server` directory.

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Health check: `/health`
- Port: Render provides `PORT` automatically.

The included `render.yaml` can be used as the starting configuration.

After deployment, verify:

`https://YOUR-SERVER.onrender.com/health`

It should return JSON containing `"ok":true`.

## 2. Frontend (Vercel)

Import the repository into Vercel and set the project root to `client`.

Build command: `npm run build`

Environment variable:

`VITE_SERVER_URL=https://YOUR-SERVER.onrender.com`

Deploy. The included `client/vercel.json` keeps the SPA route working on refresh.

## 3. External multiplayer verification

Use a laptop on Wi-Fi and a phone on mobile data.

1. Open the Vercel URL on both.
2. Create a room on the laptop.
3. Join using the four-character code on the phone.
4. Ready both players.
5. Start the match.
6. Move one player and confirm the other device sees the movement.
7. Capture a node and confirm the score/node/arena state changes on both devices.
8. Complete the match and press Rematch.
9. Refresh one device during the lobby and verify it reconnects within the grace period.

Do not call the game production-ready until this external-network test passes.
