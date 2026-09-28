/**
 * VOLT//SHIFT Unified Network & Session Layer
 * Seamlessly manages:
 * 1. Cloud Authoritative Socket.IO (when dedicated server available)
 * 2. WebRTC Peer-to-Peer DataChannel (zero-server cross-device multiplayer)
 * 3. Solo Combat Simulation (instant autonomous AI bot arena)
 */

import { io } from 'socket.io-client';
import { Peer } from 'peerjs';
import * as Engine from './gameEngine.js';

export class NetworkManager {
  constructor({ onState, onConnectStatus, onToast }) {
    this.onState = onState;
    this.onConnectStatus = onConnectStatus;
    this.onToast = onToast;

    this.mode = 'idle'; // 'cloud' | 'peer_host' | 'peer_client' | 'solo'
    this.socket = null;
    this.peer = null;
    this.peerConn = null;
    this.localRoom = null;
    this.tickInterval = null;
    this.aiInterval = null;

    this.mySlot = 'p1';
    this.roomCode = '';
  }

  // ----------------- CLOUD SOCKET.IO -----------------
  connectCloud(serverUrl) {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    if (!serverUrl || serverUrl === 'none' || serverUrl.includes('.lhr.life')) {
      // Don't attempt to connect to expired temporary tunnels
      this.onConnectStatus({ connected: true, mode: 'ready', label: 'READY' });
      return;
    }

    try {
      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        timeout: 4000,
      });

      this.socket.on('connect', () => {
        this.mode = 'cloud';
        this.onConnectStatus({ connected: true, mode: 'cloud', label: 'CLOUD SYNC' });
      });

      this.socket.on('state', (state) => {
        if (this.mode === 'cloud') {
          this.onState(state);
        }
      });

      this.socket.on('disconnect', () => {
        if (this.mode === 'cloud') {
          this.onConnectStatus({ connected: true, mode: 'peer', label: 'PEER MESH READY' });
        }
      });

      this.socket.on('connect_error', () => {
        // Silently fall back to Peer / Local mode without showing red errors
        this.onConnectStatus({ connected: true, mode: 'peer', label: 'PEER MESH READY' });
      });
    } catch (_) {
      this.onConnectStatus({ connected: true, mode: 'peer', label: 'PEER MESH READY' });
    }
  }

  // ----------------- CREATE ROOM -----------------
  async createRoom({ callsign, preferCloud = false }) {
    this.cleanupLocalSession();

    // 1. Try cloud if connected
    if (preferCloud && this.socket && this.socket.connected) {
      return new Promise((resolve) => {
        this.socket.emit('room:create', { callsign }, (res) => {
          if (res?.ok) {
            this.mode = 'cloud';
            this.mySlot = res.slot || 'p1';
            this.roomCode = res.code;
            resolve({ ok: true, code: res.code, slot: res.slot, mode: 'cloud' });
          } else {
            resolve(this.createPeerRoom({ callsign }));
          }
        });
      });
    }

    // 2. Default to seamless Authoritative Peer Host
    return this.createPeerRoom({ callsign });
  }

  async createPeerRoom({ callsign }) {
    this.cleanupLocalSession();

    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }

    this.roomCode = code;
    this.mySlot = 'p1';
    this.mode = 'peer_host';

    const safeName = String(callsign || 'Pilot Alpha').trim().slice(0, 16);
    this.localRoom = {
      code,
      hostId: 'p1-host',
      status: 'lobby',
      players: {
        p1: { id: 'p1-host', name: safeName, slot: 'p1', connected: true, ready: false },
      },
      game: null,
      rematch: null,
      createdAt: Date.now(),
      pendingEmit: true,
    };

    // Initialize WebRTC signaling for incoming players
    try {
      const peerId = `voltshift-${code.toLowerCase()}`;
      this.peer = new Peer(peerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });

      this.peer.on('connection', (conn) => {
        this.peerConn = conn;
        conn.on('open', () => {
          // Send current state
          conn.send({ type: 'sync', state: Engine.publicState(this.localRoom) });
        });

        conn.on('data', (data) => {
          this.handlePeerDataAsHost(data);
        });

        conn.on('close', () => {
          if (this.localRoom?.players?.p2) {
            this.localRoom.players.p2.connected = false;
            this.broadcastLocalState();
          }
        });
      });
    } catch (e) {
      console.warn('WebRTC peer signaling notice:', e);
    }

    this.startHostLoop();
    this.broadcastLocalState();

    return { ok: true, code, slot: 'p1', mode: 'peer' };
  }

  // ----------------- JOIN ROOM -----------------
  async joinRoom({ code, callsign }) {
    const cleanCode = String(code || '').trim().toUpperCase();

    // 1. Try cloud if connected
    if (this.socket && this.socket.connected) {
      const cloudRes = await new Promise((resolve) => {
        this.socket.emit('room:join', { code: cleanCode, callsign }, (res) => {
          resolve(res || { ok: false });
        });
      });
      if (cloudRes.ok) {
        this.mode = 'cloud';
        this.mySlot = cloudRes.slot || 'p2';
        this.roomCode = cleanCode;
        return cloudRes;
      }
    }

    // 2. Connect via WebRTC Peer
    return new Promise((resolve) => {
      this.cleanupLocalSession();
      this.mode = 'peer_client';
      this.mySlot = 'p2';
      this.roomCode = cleanCode;

      try {
        const clientPeer = new Peer({
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
        });

        this.peer = clientPeer;

        clientPeer.on('open', () => {
          const targetId = `voltshift-${cleanCode.toLowerCase()}`;
          const conn = clientPeer.connect(targetId);
          this.peerConn = conn;

          const timeout = setTimeout(() => {
            resolve({ ok: false, error: 'ROOM_NOT_FOUND', reason: 'Sector host not found. Verify the code.' });
          }, 6000);

          conn.on('open', () => {
            clearTimeout(timeout);
            conn.send({
              type: 'join',
              callsign: callsign || 'Pilot Omega',
            });
            resolve({ ok: true, code: cleanCode, slot: 'p2', mode: 'peer' });
          });

          conn.on('data', (data) => {
            if (data.type === 'sync' && data.state) {
              this.onState(data.state);
            }
          });

          conn.on('error', (err) => {
            clearTimeout(timeout);
            resolve({ ok: false, error: 'CONNECTION_FAILED', reason: err.message });
          });
        });

        clientPeer.on('error', (err) => {
          resolve({ ok: false, error: 'ROOM_NOT_FOUND', reason: 'Sector code unavailable.' });
        });
      } catch (err) {
        resolve({ ok: false, error: 'CLIENT_ERROR', reason: err.message });
      }
    });
  }

  // ----------------- SOLO / BOT COMBAT MODE -----------------
  startSoloMode({ callsign }) {
    this.cleanupLocalSession();
    this.mode = 'solo';
    this.mySlot = 'p1';
    this.roomCode = 'SOLO';

    const safeName = String(callsign || 'Pilot').trim().slice(0, 16);
    this.localRoom = {
      code: 'SOLO',
      hostId: 'p1',
      status: 'countdown',
      players: {
        p1: { id: 'p1', name: safeName, slot: 'p1', connected: true, ready: true },
        p2: { id: 'p2-ai', name: 'VECTOR-AI', slot: 'p2', connected: true, ready: true },
      },
      game: Engine.newMatch(),
      rematch: null,
      createdAt: Date.now(),
      pendingEmit: true,
    };

    // Autonomous AI Bot loop (every 70ms)
    this.aiInterval = setInterval(() => {
      if (this.localRoom?.game) {
        Engine.updateAiPilot(this.localRoom, 'p2');
      }
    }, 70);

    this.startHostLoop();
    this.broadcastLocalState();

    return { ok: true, code: 'SOLO', slot: 'p1', mode: 'solo' };
  }

  // ----------------- IN-GAME ACTIONS -----------------
  toggleReady() {
    if (this.mode === 'cloud' && this.socket) {
      this.socket.emit('player:ready');
      return;
    }

    if (this.mode === 'peer_host' || this.mode === 'solo') {
      const p = this.localRoom?.players?.[this.mySlot];
      if (p) {
        p.ready = !p.ready;
        this.broadcastLocalState();
      }
    } else if (this.mode === 'peer_client' && this.peerConn) {
      this.peerConn.send({ type: 'ready' });
    }
  }

  startGame() {
    if (this.mode === 'cloud' && this.socket) {
      return new Promise((res) => this.socket.emit('game:start', {}, res));
    }

    if (this.mode === 'peer_host' || this.mode === 'solo') {
      if (!this.localRoom) return { ok: false };
      const players = Object.values(this.localRoom.players || {});
      if (players.length < 2) return { ok: false, error: 'NEED_TWO_PLAYERS' };

      this.localRoom.game = Engine.newMatch();
      this.localRoom.status = 'countdown';
      this.broadcastLocalState();
      return { ok: true };
    }

    return { ok: false };
  }

  sendMove(dx, dy) {
    if (this.mode === 'cloud' && this.socket) {
      this.socket.emit('player:move', { dx, dy });
      return;
    }

    if (this.mode === 'peer_host' || this.mode === 'solo') {
      if (this.localRoom) {
        Engine.move(this.localRoom, this.mySlot, dx, dy);
      }
    } else if (this.mode === 'peer_client' && this.peerConn) {
      this.peerConn.send({ type: 'move', dx, dy });
    }
  }

  sendCapture() {
    if (this.mode === 'cloud' && this.socket) {
      this.socket.emit('player:capture');
      return;
    }

    if (this.mode === 'peer_host' || this.mode === 'solo') {
      if (this.localRoom) {
        Engine.capture(this.localRoom, this.mySlot);
      }
    } else if (this.mode === 'peer_client' && this.peerConn) {
      this.peerConn.send({ type: 'capture' });
    }
  }

  sendRematch() {
    if (this.mode === 'cloud' && this.socket) {
      this.socket.emit('match:rematch');
      return;
    }

    if (this.mode === 'peer_host' || this.mode === 'solo') {
      if (!this.localRoom?.game) return;
      this.localRoom.game = Engine.newMatch();
      this.localRoom.status = 'countdown';
      this.localRoom.rematch = null;
      this.broadcastLocalState();
    } else if (this.mode === 'peer_client' && this.peerConn) {
      this.peerConn.send({ type: 'rematch' });
    }
  }

  // ----------------- HOST SIMULATION LOOP -----------------
  startHostLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      if (!this.localRoom) return;
      const changed = Engine.tickRoom(this.localRoom);
      if (changed || this.localRoom.game?.status === 'playing') {
        this.broadcastLocalState();
      }
    }, 50); // 20Hz
  }

  handlePeerDataAsHost(data) {
    if (!this.localRoom) return;

    if (data.type === 'join') {
      this.localRoom.players.p2 = {
        id: 'p2-peer',
        name: String(data.callsign || 'Pilot 2').trim().slice(0, 16),
        slot: 'p2',
        connected: true,
        ready: false,
      };
      this.broadcastLocalState();
    } else if (data.type === 'ready') {
      if (this.localRoom.players.p2) {
        this.localRoom.players.p2.ready = !this.localRoom.players.p2.ready;
        this.broadcastLocalState();
      }
    } else if (data.type === 'move') {
      Engine.move(this.localRoom, 'p2', data.dx, data.dy);
    } else if (data.type === 'capture') {
      Engine.capture(this.localRoom, 'p2');
    } else if (data.type === 'rematch') {
      if (this.localRoom.game?.status === 'match_end') {
        this.localRoom.game = Engine.newMatch();
        this.localRoom.status = 'countdown';
        this.broadcastLocalState();
      }
    }
  }

  broadcastLocalState() {
    if (!this.localRoom) return;
    const pub = Engine.publicState(this.localRoom);
    this.onState(pub);
    if (this.peerConn && this.peerConn.open) {
      this.peerConn.send({ type: 'sync', state: pub });
    }
  }

  cleanupLocalSession() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.aiInterval) {
      clearInterval(this.aiInterval);
      this.aiInterval = null;
    }
    if (this.peerConn) {
      try { this.peerConn.close(); } catch (_) {}
      this.peerConn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
    this.localRoom = null;
  }
}
