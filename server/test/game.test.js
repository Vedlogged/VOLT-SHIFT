import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  newMatch,
  newRound,
  startRound,
  startSuddenDeath,
  endRound,
  move,
  capture,
  tickRoom,
  publicState,
  ARENA,
  CAPTURE_RADIUS,
} from '../src/game.js';

describe('VOLT//SHIFT Game Engine Unit Tests', () => {
  function makeMockRoom() {
    return {
      code: 'TEST',
      hostId: 'sock_p1',
      status: 'lobby',
      players: {
        p1: { id: 'sock_p1', name: 'Player 1', slot: 'p1', connected: true, ready: true },
        p2: { id: 'sock_p2', name: 'Player 2', slot: 'p2', connected: true, ready: true },
      },
      game: null,
      pendingEmit: false,
    };
  }

  test('newMatch initializes standard board and player slots', () => {
    const game = newMatch();
    assert.equal(game.round, 1);
    assert.equal(game.status, 'countdown');
    assert.equal(game.roundWins.p1, 0);
    assert.equal(game.roundWins.p2, 0);
    assert.equal(game.players.p1.score, 0);
    assert.equal(game.players.p2.score, 0);
    assert.equal(game.players.p1.x, 15);
    assert.equal(game.players.p2.x, 85);
    assert.equal(game.nodes.length, 8);
  });

  test('startRound sets playing status and 60-second round duration', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    startRound(room);
    assert.equal(room.game.status, 'playing');
    assert.equal(room.status, 'playing');
    assert.ok(room.game.roundEndsAt > Date.now() + 50000);
  });

  test('move validates boundaries and clamps player position', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';

    // Move left continuously beyond minX
    for (let i = 0; i < 30; i++) {
      move(room, 'p1', -1, 0);
    }
    assert.ok(room.game.players.p1.x >= ARENA.minX, `x was ${room.game.players.p1.x}`);

    // Move up beyond minY
    for (let i = 0; i < 30; i++) {
      move(room, 'p1', 0, -1);
    }
    assert.ok(room.game.players.p1.y >= ARENA.minY, `y was ${room.game.players.p1.y}`);

    // Diagonal movement normalized
    const prevX = room.game.players.p1.x;
    const prevY = room.game.players.p1.y;
    move(room, 'p1', 1, 1);
    const stepDist = Math.hypot(room.game.players.p1.x - prevX, room.game.players.p1.y - prevY);
    assert.ok(stepDist <= 4.0, `Step dist was ${stepDist}`);
  });

  test('capture fails when out of range', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';
    room.game.players.p1.x = 10;
    room.game.players.p1.y = 10;
    // Set node far away
    room.game.nodes[0] = { id: 1, x: 80, y: 50, state: 'available', owner: null };

    const res = capture(room, 'p1');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'too_far');
  });

  test('capture succeeds when close, grants 10 points and sets contested state', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';
    room.game.players.p1.x = 20;
    room.game.players.p1.y = 20;
    room.game.nodes = [
      { id: 1, x: 22, y: 20, state: 'available', owner: null, expiresAt: null },
      { id: 2, x: 25, y: 20, state: 'available', owner: null, expiresAt: null },
    ];

    const res = capture(room, 'p1');
    assert.equal(res.ok, true);
    assert.equal(res.nodeId, 1);
    assert.equal(res.stolen, false);
    assert.equal(room.game.players.p1.score, 10);
    assert.equal(room.game.nodes[0].state, 'contested');
    assert.equal(room.game.nodes[0].owner, 'p1');
    assert.ok(room.game.nodes[0].expiresAt > Date.now());
  });

  test('stealing opponent contested node grants 10 points and shifts ownership', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';
    // Node is contested by P1
    room.game.nodes = [
      { id: 1, x: 50, y: 30, state: 'contested', owner: 'p1', expiresAt: Date.now() + 2000 },
    ];
    room.game.players.p2.x = 52;
    room.game.players.p2.y = 30;

    const res = capture(room, 'p2');
    assert.equal(res.ok, true);
    assert.equal(res.stolen, true);
    assert.equal(res.nodeId, 1);
    assert.equal(room.game.players.p2.score, 10);
    assert.equal(room.game.nodes[0].owner, 'p2');
    assert.equal(room.game.nodes[0].state, 'contested');
  });

  test('tickRoom locks contested node upon expiration and awards +5 lock bonus', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';
    room.game.players.p1.score = 10;
    room.game.nodes = [
      { id: 1, x: 30, y: 30, state: 'contested', owner: 'p1', expiresAt: Date.now() - 10, lockedAt: null },
    ];

    const changed = tickRoom(room);
    assert.equal(changed, true);
    assert.equal(room.game.nodes[0].state, 'locked');
    assert.equal(room.game.players.p1.score, 15); // 10 + 5 bonus
  });

  test('arenaShift displaces nearby available nodes on capture', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';
    room.game.players.p1.x = 30;
    room.game.players.p1.y = 30;
    room.game.nodes = [
      { id: 1, x: 32, y: 30, state: 'available', owner: null },
      { id: 2, x: 36, y: 30, state: 'available', owner: null }, // nearby (distance 4)
    ];

    const prevX = room.game.nodes[1].x;
    capture(room, 'p1');
    assert.notEqual(room.game.nodes[1].x, prevX, 'Nearby node position shifted');
    assert.ok(room.game.arenaShift !== null);
  });

  test('sudden death triggered on tied round', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    room.game.status = 'playing';
    room.game.players.p1.score = 20;
    room.game.players.p2.score = 20;
    room.game.roundEndsAt = Date.now() - 10; // timer expired

    tickRoom(room);
    assert.equal(room.game.status, 'sudden_death');
    assert.equal(room.game.nodes.length, 1);
    assert.equal(room.game.nodes[0].isSuddenDeath, true);
    assert.equal(room.game.nodes[0].x, 50);
    assert.equal(room.game.nodes[0].y, 30);
  });

  test('publicState serializes room without exposing private socket IDs', () => {
    const room = makeMockRoom();
    room.game = newMatch();
    const pub = publicState(room);

    assert.equal(pub.roomCode, 'TEST');
    assert.equal(pub.hostSlot, 'p1');
    assert.equal(pub.players.p1.name, 'Player 1');
    assert.equal(pub.players.p1.slot, 'p1');
    assert.equal(pub.players.p1.id, undefined); // socket id is private
  });
});
