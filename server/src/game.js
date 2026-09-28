/**
 * VOLT//SHIFT Authoritative Game Engine
 * Pure logic for arena simulation, movement validation, node captures,
 * stealing, locking, arena shifting, sudden death, and round/match lifecycle.
 */

const ARENA = {
  w: 100,
  h: 60,
  minX: 4,
  maxX: 96,
  minY: 4,
  maxY: 56,
  sectors: {
    alpha: { name: 'ALPHA SECTOR', minX: 4, maxX: 35 },
    core: { name: 'CORE NEXUS', minX: 35, maxX: 65 },
    omega: { name: 'OMEGA SECTOR', minX: 65, maxX: 96 },
  },
};

const ROUND_DURATION_MS = 60000;
const COUNTDOWN_DURATION_MS = 3000;
const CONTEST_DURATION_MS = 2500;
const NODE_RESPAWN_DELAY_MS = 1500;
const CAPTURE_RADIUS = 9.0;
const PLAYER_SPEED = 3.8;
const TOTAL_ACTIVE_NODES = 8;
const MIN_MOVE_INTERVAL_MS = 24; // Anti-spam rate limiting (~40Hz max)
const MIN_CAPTURE_INTERVAL_MS = 80; // Anti-spam capture rate limiting

const NODE_TYPES = {
  normal: {
    type: 'normal',
    value: 10,
    contestMs: 2500,
    lockBonus: 5,
    name: 'Volt Core',
    color: '#00f0ff',
  },
  surge: {
    type: 'surge',
    value: 15,
    contestMs: 2500,
    lockBonus: 5,
    shiftMultiplier: 1.8,
    name: 'Surge Core',
    color: '#ff9900',
  },
  anchor: {
    type: 'anchor',
    value: 10,
    contestMs: 1600, // Locks faster!
    lockBonus: 10,
    name: 'Anchor Core',
    color: '#05ffa1',
  },
  void: {
    type: 'void',
    value: 20, // High risk / high reward!
    contestMs: 2000,
    lockBonus: 10,
    stealPenalty: 5,
    name: 'Void Rift',
    color: '#bf55ec',
  },
  sudden_death: {
    type: 'sudden_death',
    value: 25,
    contestMs: 3000,
    lockBonus: 25,
    name: 'Omega Singularity',
    color: '#ffe600',
  },
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => Math.random() * (max - min) + min;

function getSector(x) {
  if (x < 35) return 'alpha';
  if (x > 65) return 'omega';
  return 'core';
}

function getRandomNodeType() {
  const r = Math.random();
  if (r < 0.50) return 'normal';
  if (r < 0.70) return 'surge';
  if (r < 0.85) return 'anchor';
  return 'void';
}

function generateNode(id, isSuddenDeath = false, forceType = null) {
  if (isSuddenDeath) {
    const config = NODE_TYPES.sudden_death;
    return {
      id: id || 'sd-1',
      x: 50,
      y: 30,
      type: 'sudden_death',
      state: 'available',
      owner: null,
      expiresAt: null,
      lockedAt: null,
      isSuddenDeath: true,
      value: config.value,
      sector: 'core',
      name: config.name,
      color: config.color,
    };
  }

  const selectedType = forceType || getRandomNodeType();
  const config = NODE_TYPES[selectedType] || NODE_TYPES.normal;
  const x = Math.round(rand(12, 88));
  const y = Math.round(rand(10, 50));

  return {
    id: id || Math.random().toString(36).slice(2, 9),
    x,
    y,
    type: selectedType,
    state: 'available',
    owner: null,
    expiresAt: null,
    lockedAt: null,
    isSuddenDeath: false,
    value: config.value,
    sector: getSector(x),
    name: config.name,
    color: config.color,
  };
}

function makeInitialNodes() {
  // Pre-seed an engaging, balanced distribution across the 3 sectors
  const presetTypes = ['normal', 'surge', 'anchor', 'void', 'normal', 'surge', 'normal', 'normal'];
  const nodes = [];
  for (let i = 0; i < TOTAL_ACTIVE_NODES; i++) {
    nodes.push(generateNode(i + 1, false, presetTypes[i]));
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
      p1: { x: 15, y: 30, score: 0, vx: 0, vy: 0, lastMoveAt: 0, lastCaptureAt: 0 },
      p2: { x: 85, y: 30, score: 0, vx: 0, vy: 0, lastMoveAt: 0, lastCaptureAt: 0 },
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
      p1: { x: 15, y: 30, score: 0, vx: 0, vy: 0, lastMoveAt: 0, lastCaptureAt: 0 },
      p2: { x: 85, y: 30, score: 0, vx: 0, vy: 0, lastMoveAt: 0, lastCaptureAt: 0 },
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
  // Clear regular nodes and place the central sudden death omega singularity
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

  const now = Date.now();
  // Anti-cheat rate limiting: ignore inputs fired faster than MIN_MOVE_INTERVAL_MS
  if (p.lastMoveAt && now - p.lastMoveAt < MIN_MOVE_INTERVAL_MS) {
    return false;
  }

  const dx = Number(rawDx);
  const dy = Number(rawDy);

  // Security validation: reject NaN, Infinity, or impossible coordinates
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return false;
  }

  // Normalize direction vector to prevent diagonal speed abuse
  const length = Math.hypot(dx, dy);
  const normDx = length > 0 ? dx / length : 0;
  const normDy = length > 0 ? dy / length : 0;

  const step = PLAYER_SPEED;
  p.x = clamp(p.x + normDx * step, ARENA.minX, ARENA.maxX);
  p.y = clamp(p.y + normDy * step, ARENA.minY, ARENA.maxY);
  p.vx = normDx;
  p.vy = normDy;
  p.lastMoveAt = now;

  room.pendingEmit = true;
  return true;
}

function triggerArenaShift(s, sourceX, sourceY, capturingSlot, nodeType = 'normal') {
  const isSurge = nodeType === 'surge';
  const isAnchor = nodeType === 'anchor';
  const shiftRadius = isSurge ? 36 : 22;
  const shiftForce = isSurge ? 9 : 5;
  let shiftedCount = 0;

  for (const node of s.nodes) {
    if (node.state === 'available') {
      const dist = Math.hypot(node.x - sourceX, node.y - sourceY);
      if (dist < shiftRadius && dist > 0.1) {
        // If anchor node, dampens displacement (stabilizes vicinity)
        const dampener = isAnchor ? 0.4 : 1.0;
        const dirX = (node.x - sourceX) / dist;
        const dirY = (node.y - sourceY) / dist;
        const biasX = (capturingSlot === 'p1' ? 4 : -4) * dampener;
        const biasY = (node.id % 2 === 0 ? 3 : -3) * dampener;

        node.x = clamp(node.x + dirX * shiftForce * dampener + biasX, ARENA.minX + 4, ARENA.maxX - 4);
        node.y = clamp(node.y + dirY * shiftForce * dampener + biasY, ARENA.minY + 4, ARENA.maxY - 4);
        node.sector = getSector(node.x);
        shiftedCount++;
      }
    }
  }

  s.arenaShift = {
    at: Date.now(),
    x: sourceX,
    y: sourceY,
    player: capturingSlot,
    nodeType,
    shiftedCount,
    isSurge,
  };
}

function capture(room, slot) {
  const s = room.game;
  if (!s || (s.status !== 'playing' && s.status !== 'sudden_death')) {
    return { ok: false, reason: 'game_not_active' };
  }

  const p = s.players[slot];
  if (!p) return { ok: false, reason: 'invalid_player' };

  const now = Date.now();
  // Anti-cheat rate limiting on capture trigger
  if (p.lastCaptureAt && now - p.lastCaptureAt < MIN_CAPTURE_INTERVAL_MS) {
    return { ok: false, reason: 'cooldown' };
  }

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

  p.lastCaptureAt = now;
  const isSteal = closestNode.state === 'contested' && closestNode.owner !== slot;
  const wasOwner = closestNode.owner;
  const nodeConfig = NODE_TYPES[closestNode.type] || NODE_TYPES.normal;

  closestNode.state = 'contested';
  closestNode.owner = slot;
  closestNode.expiresAt = now + (nodeConfig.contestMs || CONTEST_DURATION_MS);

  // Calculate points
  let points = nodeConfig.value || 10;
  p.score += points;

  // Handle Void Node Steal Penalty: if stolen, previous owner suffers penalty
  if (isSteal && closestNode.type === 'void' && wasOwner && s.players[wasOwner]) {
    s.players[wasOwner].score = Math.max(0, s.players[wasOwner].score - (nodeConfig.stealPenalty || 5));
  }

  s.lastEvent = {
    type: isSteal ? 'steal' : 'capture',
    nodeId: closestNode.id,
    nodeType: closestNode.type,
    player: slot,
    previousOwner: wasOwner,
    points,
    isSuddenDeath: closestNode.isSuddenDeath,
    at: now,
  };

  // Trigger arena shift with node type characteristics
  triggerArenaShift(s, closestNode.x, closestNode.y, slot, closestNode.type);

  room.pendingEmit = true;
  return {
    ok: true,
    nodeId: closestNode.id,
    nodeType: closestNode.type,
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

        const nodeConfig = NODE_TYPES[node.type] || NODE_TYPES.normal;
        const lockBonus = node.isSuddenDeath ? 25 : (nodeConfig.lockBonus || 5);
        if (node.owner && s.players[node.owner]) {
          s.players[node.owner].score += lockBonus;
        }

        s.lastEvent = {
          type: 'lock',
          nodeId: node.id,
          nodeType: node.type,
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
  NODE_TYPES,
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
  getSector,
};
