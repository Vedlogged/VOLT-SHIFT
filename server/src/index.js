import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { randomBytes } from 'crypto';
import {
  newMatch,
  publicState,
  tickRoom,
  move,
  capture,
} from './game.js';

const app = express();
app.use(cors({ origin: true }));
app.get('/health', (_, res) => res.json({ ok: true, service: 'volt-shift-server', uptime: process.uptime() }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

const rooms = new Map();
const socketSessions = new Map(); // socket.id -> { roomCode, slot, token }
const tokenSessions = new Map(); // token -> { roomCode, slot, disconnectedAt }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode() {
  let result = '';
  const bytes = randomBytes(4);
  for (let i = 0; i < 4; i++) {
    result += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return result;
}

function emitRoomState(room) {
  if (!room) return;
  io.to(room.code).emit('state', publicState(room));
}

function cleanEmptyRooms(room) {
  if (!room) return;
  const hasConnected = Object.values(room.players || {}).some(p => p.connected);
  if (!hasConnected && room.status === 'lobby') {
    rooms.delete(room.code);
  }
}

function assignSlot(room) {
  if (!room.players.p1) return 'p1';
  if (!room.players.p2) return 'p2';
  return null;
}

io.on('connection', (socket) => {
  // Check for reconnection token in handshake auth
  const resumeToken = socket.handshake.auth?.resumeToken;
  if (resumeToken && tokenSessions.has(resumeToken)) {
    const saved = tokenSessions.get(resumeToken);
    const room = rooms.get(saved.roomCode);
    const player = room?.players?.[saved.slot];

    if (room && player) {
      // Re-link player to this new socket
      player.id = socket.id;
      player.connected = true;
      delete player.disconnectedAt;

      socketSessions.set(socket.id, {
        roomCode: room.code,
        slot: saved.slot,
        token: resumeToken,
      });

      socket.join(room.code);
      socket.emit('resume', { ok: true, code: room.code, slot: saved.slot });
      emitRoomState(room);
    }
  }

  // Create a new room
  socket.on('room:create', ({ name = 'Player' } = {}, ack) => {
    let roomCode;
    let attempts = 0;
    do {
      roomCode = generateRoomCode();
      attempts++;
    } while (rooms.has(roomCode) && attempts < 100);

    const safeName = String(name || '').trim().slice(0, 16) || 'Player 1';
    const slot = 'p1';
    const token = randomBytes(16).toString('hex');

    const room = {
      code: roomCode,
      hostId: socket.id,
      status: 'lobby',
      players: {
        [slot]: {
          id: socket.id,
          name: safeName,
          slot,
          connected: true,
          ready: false,
        },
      },
      game: null,
      rematch: null,
    };

    rooms.set(roomCode, room);
    tokenSessions.set(token, { roomCode, slot });
    socketSessions.set(socket.id, { roomCode, slot, token });

    socket.join(roomCode);
    ack?.({ ok: true, code: roomCode, slot, token });
    emitRoomState(room);
  });

  // Join an existing room
  socket.on('room:join', ({ code: rawCode, name = 'Player' } = {}, ack) => {
    const roomCode = String(rawCode || '').trim().toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      return ack?.({ ok: false, error: 'ROOM_NOT_FOUND' });
    }

    if (room.status !== 'lobby') {
      return ack?.({ ok: false, error: 'GAME_ALREADY_STARTED' });
    }

    const slot = assignSlot(room);
    if (!slot) {
      return ack?.({ ok: false, error: 'ROOM_FULL' });
    }

    const safeName = String(name || '').trim().slice(0, 16) || (slot === 'p2' ? 'Player 2' : 'Player 1');
    const token = randomBytes(16).toString('hex');

    room.players[slot] = {
      id: socket.id,
      name: safeName,
      slot,
      connected: true,
      ready: false,
    };

    tokenSessions.set(token, { roomCode, slot });
    socketSessions.set(socket.id, { roomCode, slot, token });

    socket.join(roomCode);
    ack?.({ ok: true, code: roomCode, slot, token });
    emitRoomState(room);
  });

  // Player ready toggle
  socket.on('player:ready', (_, ack) => {
    const session = socketSessions.get(socket.id);
    const room = rooms.get(session?.roomCode);
    if (!room || !room.players[session.slot]) return;

    const player = room.players[session.slot];
    player.ready = !player.ready;

    ack?.({ ok: true, ready: player.ready });
    emitRoomState(room);
  });

  // Host starts game
  socket.on('game:start', (_, ack) => {
    const session = socketSessions.get(socket.id);
    const room = rooms.get(session?.roomCode);

    if (!room || room.hostId !== socket.id) {
      return ack?.({ ok: false, error: 'NOT_HOST' });
    }

    const players = Object.values(room.players || {});
    if (players.length < 2) {
      return ack?.({ ok: false, error: 'NEED_TWO_PLAYERS' });
    }

    if (!players.every((p) => p.ready)) {
      return ack?.({ ok: false, error: 'BOTH_MUST_BE_READY' });
    }

    room.game = newMatch();
    room.status = 'countdown';
    room.rematch = null;

    ack?.({ ok: true });
    emitRoomState(room);
  });

  // Player movement input
  socket.on('input:move', ({ dx = 0, dy = 0 } = {}, ack) => {
    const session = socketSessions.get(socket.id);
    const room = rooms.get(session?.roomCode);
    if (!room) return ack?.({ ok: false });

    const ok = move(room, session.slot, Number(dx), Number(dy));
    ack?.({ ok });
  });

  // Player capture action
  socket.on('input:capture', (_, ack) => {
    const session = socketSessions.get(socket.id);
    const room = rooms.get(session?.roomCode);
    if (!room) return ack?.({ ok: false });

    const result = capture(room, session.slot);
    ack?.(result);
    if (result && result.ok) {
      emitRoomState(room);
    }
  });

  // Rematch request
  socket.on('game:rematch', (_, ack) => {
    const session = socketSessions.get(socket.id);
    const room = rooms.get(session?.roomCode);
    if (!room || room.status !== 'match_end') return ack?.({ ok: false });

    room.rematch = room.rematch || new Set();
    room.rematch.add(session.slot);

    // If both players voted rematch, start a fresh match!
    if (room.rematch.size === 2) {
      room.rematch = null;
      room.game = newMatch();
      room.status = 'countdown';
    }

    ack?.({ ok: true, votes: Array.from(room.rematch || []) });
    emitRoomState(room);
  });

  // Player leaves room explicitly
  socket.on('room:leave', (_, ack) => {
    const session = socketSessions.get(socket.id);
    if (!session) return ack?.({ ok: true });

    const room = rooms.get(session.roomCode);
    socketSessions.delete(socket.id);
    if (session.token) tokenSessions.delete(session.token);

    if (room) {
      delete room.players[session.slot];
      socket.leave(room.code);

      // Reassign host if needed
      if (room.hostId === socket.id) {
        const nextHost = Object.values(room.players).find((p) => p.connected);
        if (nextHost) room.hostId = nextHost.id;
      }

      // If game was active, reset to lobby
      if (room.game && room.status !== 'lobby') {
        room.status = 'lobby';
        room.game = null;
      }

      emitRoomState(room);
      cleanEmptyRooms(room);
    }

    ack?.({ ok: true });
  });

  // Disconnect handling with grace period
  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    if (!session) return;

    const room = rooms.get(session.roomCode);
    socketSessions.delete(socket.id);
    if (!room) return;

    const player = room.players[session.slot];
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();

      if (session.token) {
        tokenSessions.set(session.token, {
          roomCode: session.roomCode,
          slot: session.slot,
          disconnectedAt: Date.now(),
        });
      }

      // Host migration if host drops
      if (room.hostId === socket.id) {
        const next = Object.values(room.players).find((x) => x.id !== socket.id && x.connected);
        if (next) room.hostId = next.id;
      }
    }

    emitRoomState(room);

    // 20-second grace period for reconnection
    const disconnectTime = Date.now();
    setTimeout(() => {
      const currentRoom = rooms.get(session.roomCode);
      if (!currentRoom) return;

      const p = currentRoom.players[session.slot];
      if (p && !p.connected && p.disconnectedAt === disconnectTime) {
        delete currentRoom.players[session.slot];

        if (session.token) {
          tokenSessions.delete(session.token);
        }

        if (currentRoom.hostId === socket.id) {
          const next = Object.values(currentRoom.players).find((x) => x.connected);
          if (next) currentRoom.hostId = next.id;
        }

        if (currentRoom.game && currentRoom.status !== 'lobby') {
          currentRoom.status = 'lobby';
          currentRoom.game = null;
        }

        emitRoomState(currentRoom);
        cleanEmptyRooms(currentRoom);
      }
    }, 20000);
  });
});

// Authoritative tick loop at 20Hz (every 50ms)
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.game) {
      const stateChanged = tickRoom(room);
      // In active gameplay states, broadcast state regularly for positional sync
      if (stateChanged || room.status === 'playing' || room.status === 'countdown' || room.status === 'sudden_death') {
        emitRoomState(room);
      }
    }
  }
}, 50);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`VOLT//SHIFT server listening on port ${PORT}`);
});

export { app, server, io, rooms };
