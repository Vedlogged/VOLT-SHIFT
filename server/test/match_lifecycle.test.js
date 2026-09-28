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
} from '../src/game.js';

describe('VOLT//SHIFT Full Match Lifecycle & Replayability Suite', () => {
  function makeMockRoom() {
    return {
      code: 'LIFE',
      hostId: 'sock_p1',
      status: 'lobby',
      players: {
        p1: { id: 'sock_p1', name: 'Ace', slot: 'p1', connected: true, ready: true },
        p2: { id: 'sock_p2', name: 'Blitz', slot: 'p2', connected: true, ready: true },
      },
      game: null,
      rematch: null,
      pendingEmit: false,
    };
  }

  test('Complete Best-of-3 Series with Sudden Death and Rematch', async () => {
    const room = makeMockRoom();

    // 1. Initialize Match (Round 1)
    room.game = newMatch();
    room.status = 'countdown';
    assert.equal(room.game.round, 1);
    assert.equal(room.game.roundWins.p1, 0);
    assert.equal(room.game.roundWins.p2, 0);

    // Countdown expires -> Round 1 starts
    room.game.countdownEndsAt = Date.now() - 10;
    tickRoom(room);
    assert.equal(room.game.status, 'playing');

    // P1 captures a node to gain lead
    room.game.players.p1.x = room.game.nodes[0].x;
    room.game.players.p1.y = room.game.nodes[0].y;
    capture(room, 'p1');
    assert.ok(room.game.players.p1.score > 0);

    // End Round 1
    endRound(room);
    assert.equal(room.game.status, 'round_end');
    assert.equal(room.game.roundWins.p1, 1);
    assert.equal(room.game.roundWins.p2, 0);

    // 2. Advance to Round 2
    room.game = newRound(2, room.game.roundWins);
    room.status = 'playing';
    room.game.status = 'playing';
    assert.equal(room.game.round, 2);

    // In Round 2, both players have equal scores -> timer expires -> SUDDEN DEATH
    room.game.players.p1.score = 20;
    room.game.players.p2.score = 20;
    room.game.roundEndsAt = Date.now() - 10;
    tickRoom(room);

    assert.equal(room.game.status, 'sudden_death');
    assert.equal(room.game.nodes.length, 1);
    assert.equal(room.game.nodes[0].isSuddenDeath, true);

    // P2 captures and locks sudden death core
    room.game.players.p2.x = 50;
    room.game.players.p2.y = 30;
    const sdCapture = capture(room, 'p2');
    assert.equal(sdCapture.ok, true);

    // Sudden death node locks -> resolves round for P2!
    room.game.nodes[0].expiresAt = Date.now() - 10;
    tickRoom(room);

    assert.equal(room.game.status, 'round_end');
    assert.equal(room.game.roundWins.p1, 1);
    assert.equal(room.game.roundWins.p2, 1);

    // 3. Advance to Round 3 (Decider)
    room.game = newRound(3, room.game.roundWins);
    room.status = 'playing';
    room.game.status = 'playing';
    assert.equal(room.game.round, 3);

    // P1 scores more in Round 3
    room.game.players.p1.score = 40;
    room.game.players.p2.score = 25;
    endRound(room);

    assert.equal(room.game.roundWins.p1, 2);
    assert.equal(room.game.roundWins.p2, 1);

    // Wait for the scheduled transition to match_end
    await new Promise((r) => setTimeout(r, 4100));
    assert.equal(room.game.status, 'match_end');
    assert.equal(room.game.lastEvent.winner, 'p1');

    // 4. Rematch voting
    room.rematch = new Set();
    room.rematch.add('p1');
    assert.equal(room.rematch.size, 1);

    room.rematch.add('p2');
    assert.equal(room.rematch.size, 2);

    // Reset into a fresh match
    room.rematch = null;
    room.game = newMatch();
    room.status = 'countdown';
    assert.equal(room.game.round, 1);
    assert.equal(room.game.roundWins.p1, 0);
    assert.equal(room.game.roundWins.p2, 0);
  });
});
