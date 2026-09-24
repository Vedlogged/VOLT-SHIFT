/**
 * VOLT//SHIFT Authoritative Game Engine
 * Pure logic for arena simulation, movement validation, node captures,
 * stealing, locking, arena shifting, sudden death, and round/match lifecycle.
 */

const ARENA = { w: 100, h: 60, minX: 4, maxX: 96, minY: 4, maxY: 56 };
const ROUND_DURATION_MS = 60000;
const COUNTDOWN_DURATION_MS = 3000;
const CONTEST_DURATION_MS = 2500;
const NODE_RESPAWN_DELAY_MS = 1500;
const CAPTURE_RADIUS = 9.0;
const PLAYER_SPEED = 3.8;
const TOTAL_ACTIVE_NODES = 8;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => Math.random() * (max - min) + min;

function generateNode(id, isSuddenDeath = false) {
  if (isSuddenDeath) {
    return {
      id: id || 'sd-1',
      x: 50,
      y: 30,
      state: 'available',
      owner: null,
      expiresAt: null,
      lockedAt: null,
      isSuddenDeath: true,
      value: 25,
    };
  }

  // Generate node in safe playable bounds away from immediate player spawns
  return {
    id: id || Math.random().toString(36).slice(2, 9),
    x: Math.round(rand(12, 88)),
    y: Math.round(rand(10, 50)),
    state: 'available',
    owner: null,
    expiresAt: null,
    lockedAt: null,
    isSuddenDeath: false,
    value: 10,
  };
}

function makeInitialNodes() {
  const nodes = [];
  for (let i = 1; i <= TOTAL_ACTIVE_NODES; i++) {
    nodes.push(generateNode(i));
  }
  return nodes;
}

function newMatch() {
  return {
    round: 1,
    roundWins: { p1: 0, p2: 0 },
    status: 'countdown',
    countdownEndsAt: Date.now() + COUNTDOWN_DURATION_MS,
    roundEndsAt: null,
    players: {
      p1: { x: 15, y: 30, score: 0 },
      p2: { x: 85, y: 30, score: 0 },
    },
    nodes: makeInitialNodes(),
    lastEvent: { type: 'match_init', at: Date.now() },
    arenaShift: null,
  };
}

function newRound(roundNumber, currentWins) {
  return {
    round: roundNumber,
    roundWins: { p1: currentWins.p1 || 0, p2: currentWins.p2 || 0 },
    status: 'countdown',
    countdownEndsAt: Date.now() + COUNTDOWN_DURATION_MS,
    roundEndsAt: null,
    players: {
      p1: { x: 15, y: 30, score: 0 },
      p2: { x: 85, y: 30, score: 0 },
    },
    nodes: makeInitialNodes(),
    lastEvent: { type: 'round_init', round: roundNumber, at: Date.now() },
    arenaShift: null,
  };
}

function startRound(room) {
  if (!room.game) return;
  room.game.status = 'playing';
  room.status = 'playing';
  room.game.roundEndsAt = Date.now() + ROUND_DURATION_MS;
  room.game.countdownEndsAt = null;
  room.game.lastEvent = { type: 'round_start', round: room.game.round, at: Date.now() };
  room.pendingEmit = true;
}

function startSuddenDeath(room) {
  const s = room.game;
  if (!s) return;
  s.status = 'sudden_death';
  room.status = 'sudden_death';
  s.roundEndsAt = null;
  // Clear regular nodes and place the sudden death core
  s.nodes = [generateNode('sudden-core', true)];
  s.lastEvent = { type: 'sudden_death', at: Date.now() };
  room.pendingEmit = true;
}

function endRound(room, forcedWinner = null) {
  const s = room.game;
  if (!s || (s.status !== 'playing' && s.status !== 'sudden_death')) return;

  const score1 = s.players.p1.score;
  const score2 = s.players.p2.score;

  let winner = forcedWinner;
  if (!winner) {
    if (score1 > score2) winner = 'p1';
    else if (score2 > score1) winner = 'p2';
    else winner = null; // Tie
  }

  // If scores tied and this is a normal round end, trigger sudden death!
  if (winner === null && s.status === 'playing') {
    startSuddenDeath(room);
    return;
  }

  // If winner is determined (either normal round or sudden death resolved)
  if (winner) {
    s.roundWins[winner] = (s.roundWins[winner] || 0) + 1;
  }

  s.status = 'round_end';
  room.status = 'round_end';
  s.lastEvent = {
    type: 'round_end',
    winner,
    score: { p1: score1, p2: score2 },
    roundWins: { ...s.roundWins },
    at: Date.now(),
  };
  room.pendingEmit = true;

  // Schedule next round or match end
  const currentRoundInstance = s;
  setTimeout(() => {
    if (room.game !== currentRoundInstance) return;

    if (s.roundWins.p1 >= 2 || s.roundWins.p2 >= 2) {
      const matchWinner = s.roundWins.p1 >= 2 ? 'p1' : 'p2';
      s.status = 'match_end';
      room.status = 'match_end';
      s.lastEvent = {
        type: 'match_end',
        winner: matchWinner,
        roundWins: { ...s.roundWins },
        at: Date.now(),
      };
    } else {
      room.game = newRound(s.round + 1, s.roundWins);
      room.status = 'countdown';
    }
    room.pendingEmit = true;
  }, 4000);
}

function move(room, slot, rawDx, rawDy) {
  const s = room.game;
  if (!s || (s.status !== 'playing' && s.status !== 'sudden_death')) return false;

  const p = s.players[slot];
  if (!p) return false;

  const dx = Number(rawDx) || 0;
  const dy = Number(rawDy) || 0;

  if (dx === 0 && dy === 0) return false;

  // Normalize direction vector to prevent diagonal speed abuse
  const length = Math.hypot(dx, dy);
  const normDx = length > 0 ? dx / length : 0;
  const normDy = length > 0 ? dy / length : 0;

  const step = PLAYER_SPEED;
  p.x = clamp(p.x + normDx * step, ARENA.minX, ARENA.maxX);
  p.y = clamp(p.y + normDy * step, ARENA.minY, ARENA.maxY);

  room.pendingEmit = true;
  return true;
}

function triggerArenaShift(s, sourceX, sourceY, capturingSlot) {
  const SHIFT_RADIUS = 22;
  let shiftedCount = 0;

  for (const node of s.nodes) {
    if (node.state === 'available') {
      const dist = Math.hypot(node.x - sourceX, node.y - sourceY);
      if (dist < SHIFT_RADIUS && dist > 0.1) {
        // Shift outward with bias based on player side
        const dirX = (node.x - sourceX) / dist;
        const dirY = (node.y - sourceY) / dist;
        const biasX = capturingSlot === 'p1' ? 4 : -4;
        const biasY = (node.id % 2 === 0 ? 3 : -3);

        node.x = clamp(node.x + dirX * 5 + biasX, ARENA.minX + 4, ARENA.maxX - 4);
        node.y = clamp(node.y + dirY * 5 + biasY, ARENA.minY + 4, ARENA.maxY - 4);
        shiftedCount++;
      }
    }
  }

  s.arenaShift = {
    at: Date.now(),
    x: sourceX,
    y: sourceY,
    player: capturingSlot,
    shiftedCount,
  };
}

function capture(room, slot) {
  const s = room.game;
  if (!s || (s.status !== 'playing' && s.status !== 'sudden_death')) {
    return { ok: false, reason: 'game_not_active' };
  }

  const p = s.players[slot];
  if (!p) return { ok: false, reason: 'invalid_player' };

  let closestNode = null;
  let minDistance = Infinity;

  for (const node of s.nodes) {
    // Can capture if available OR if contested by opponent
    if (node.state === 'available' || (node.state === 'contested' && node.owner !== slot)) {
      const dist = Math.hypot(node.x - p.x, node.y - p.y);
      if (dist < minDistance) {
        minDistance = dist;
        closestNode = node;
      }
    }
  }

  if (!closestNode || minDistance > CAPTURE_RADIUS) {
    return { ok: false, reason: 'too_far', distance: minDistance };
  }

  const now = Date.now();
  const isSteal = closestNode.state === 'contested' && closestNode.owner !== slot;
  const wasOwner = closestNode.owner;

  closestNode.state = 'contested';
  closestNode.owner = slot;
  closestNode.expiresAt = now + CONTEST_DURATION_MS;

  // Immediate capture points
  const points = isSteal ? 10 : 10;
  p.score += points;

  s.lastEvent = {
    type: isSteal ? 'steal' : 'capture',
    nodeId: closestNode.id,
    player: slot,
    previousOwner: wasOwner,
    points,
    isSuddenDeath: closestNode.isSuddenDeath,
    at: now,
  };

  // Trigger arena shift
  triggerArenaShift(s, closestNode.x, closestNode.y, slot);

  room.pendingEmit = true;
  return {
    ok: true,
    nodeId: closestNode.id,
    stolen: isSteal,
    points,
  };
}

function tickRoom(room) {
  if (!room || !room.game) return false;
  const s = room.game;
  const now = Date.now();
  let stateChanged = Boolean(room.pendingEmit);
  room.pendingEmit = false;

  // Countdown timer
  if (s.status === 'countdown' && now >= s.countdownEndsAt) {
    startRound(room);
    stateChanged = true;
  }

  // Active round logic
  if (s.status === 'playing' || s.status === 'sudden_death') {
    // Check contested nodes expiration -> LOCK
    for (let i = 0; i < s.nodes.length; i++) {
      const node = s.nodes[i];

      if (node.state === 'contested' && now >= node.expiresAt) {
        node.state = 'locked';
        node.lockedAt = now;
        node.expiresAt = null;

        const lockBonus = node.isSuddenDeath ? 25 : 5;
        if (node.owner && s.players[node.owner]) {
          s.players[node.owner].score += lockBonus;
        }

        s.lastEvent = {
          type: 'lock',
          nodeId: node.id,
          player: node.owner,
          bonus: lockBonus,
          isSuddenDeath: node.isSuddenDeath,
          at: now,
        };
        stateChanged = true;

        // If sudden death node locked -> round ends immediately!
        if (node.isSuddenDeath) {
          endRound(room, node.owner);
          return true;
        }
      }

      // Check locked nodes -> replenish with new available node
      if (node.state === 'locked' && !node.isSuddenDeath && now >= node.lockedAt + NODE_RESPAWN_DELAY_MS) {
        s.nodes[i] = generateNode(node.id);
        stateChanged = true;
      }
    }

    // Check round timer expiration
    if (s.status === 'playing' && s.roundEndsAt && now >= s.roundEndsAt) {
      endRound(room);
      stateChanged = true;
    }
  }

  return stateChanged;
}

function publicState(room) {
  if (!room) return null;
  const now = Date.now();
  const s = room.game;

  // Map public player information
  const players = {};
  for (const [slot, p] of Object.entries(room.players || {})) {
    players[slot] = {
      name: p.name,
      slot: p.slot,
      connected: Boolean(p.connected),
      ready: Boolean(p.ready),
      disconnectedAt: p.disconnectedAt || null,
    };
  }

  let hostSlot = null;
  for (const p of Object.values(room.players || {})) {
    if (p.id === room.hostId) {
      hostSlot = p.slot;
      break;
    }
  }

  return {
    roomCode: room.code,
    status: room.status,
    hostSlot,
    players,
    rematchVotes: room.rematch ? Array.from(room.rematch) : [],
    game: s
      ? {
          round: s.round,
          roundWins: s.roundWins,
          status: s.status,
          countdownEndsAt: s.countdownEndsAt,
          roundEndsAt: s.roundEndsAt,
          players: s.players,
          nodes: s.nodes,
          lastEvent: s.lastEvent,
          arenaShift: s.arenaShift,
          serverNow: now,
        }
      : null,
  };
}

export {
  ARENA,
  ROUND_DURATION_MS,
  COUNTDOWN_DURATION_MS,
  CONTEST_DURATION_MS,
  CAPTURE_RADIUS,
  PLAYER_SPEED,
  newMatch,
  newRound,
  startRound,
  startSuddenDeath,
  endRound,
  move,
  capture,
  tickRoom,
  publicState,
};
