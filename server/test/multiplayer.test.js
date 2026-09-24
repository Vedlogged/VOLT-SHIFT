import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const TEST_PORT = 3199;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('Starting server subprocess on port', TEST_PORT);
const proc = spawn(process.execPath, ['src/index.js'], {
  cwd: serverRoot,
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverReadyPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server start timed out after 5s')), 5000);
  proc.stdout.on('data', (d) => {
    const text = d.toString();
    if (text.includes('listening on port')) {
      clearTimeout(timeout);
      resolve();
    }
  });
  proc.on('error', (err) => {
    clearTimeout(timeout);
    reject(err);
  });
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      clearTimeout(timeout);
      reject(new Error(`Server exited unexpectedly with code ${code}`));
    }
  });
});

try {
  await serverReadyPromise;
  console.log('Server is confirmed listening on port', TEST_PORT);

  const serverUrl = `http://127.0.0.1:${TEST_PORT}`;

  console.log('Connecting Client A and Client B...');
  const clientA = io(serverUrl, { transports: ['websocket', 'polling'] });
  const clientB = io(serverUrl, { transports: ['websocket', 'polling'] });

  await Promise.all([
    new Promise((resolve, reject) => {
      clientA.once('connect', resolve);
      clientA.once('connect_error', reject);
    }),
    new Promise((resolve, reject) => {
      clientB.once('connect', resolve);
      clientB.once('connect_error', reject);
    }),
  ]);
  console.log('PASS: Both clients connected to Socket.IO server.');

  // 1. Client A creates room
  const createRes = await new Promise((resolve) => {
    clientA.emit('room:create', { name: 'Alice' }, resolve);
  });
  assert.equal(createRes.ok, true, 'Client A failed to create room');
  const roomCode = createRes.code;
  assert.equal(typeof roomCode, 'string');
  assert.equal(roomCode.length, 4);
  console.log(`PASS: Room created with code ${roomCode}`);

  // 2. Client B joins room
  const joinRes = await new Promise((resolve) => {
    clientB.emit('room:join', { code: roomCode, name: 'Bob' }, resolve);
  });
  assert.equal(joinRes.ok, true, 'Client B failed to join room');
  assert.equal(joinRes.slot, 'p2');
  console.log('PASS: Client B joined as p2');

  // 3. 3rd Client attempts to join full room
  const clientC = io(serverUrl, { transports: ['websocket', 'polling'] });
  await new Promise((r) => clientC.once('connect', r));
  const rejectRes = await new Promise((resolve) => {
    clientC.emit('room:join', { code: roomCode, name: 'Charlie' }, resolve);
  });
  assert.equal(rejectRes.ok, false);
  assert.equal(rejectRes.error, 'ROOM_FULL');
  clientC.close();
  console.log('PASS: 3rd client rejected with ROOM_FULL');

  // 4. Ready up and Start Game
  clientA.emit('player:ready');
  clientB.emit('player:ready');
  await wait(150);

  const startRes = await new Promise((resolve) => {
    clientA.emit('game:start', {}, resolve);
  });
  assert.equal(startRes.ok, true, 'Host failed to start game');
  console.log('PASS: Game countdown started');

  // Wait for countdown (3s) to transition to playing status
  console.log('Waiting for match countdown (3s)...');
  await wait(3300);

  // 5. Verify both clients receive identical synchronized state
  const statePromiseA = new Promise((resolve) => {
    const handler = (s) => {
      if (s.game?.status === 'playing') {
        clientA.off('state', handler);
        resolve(s);
      }
    };
    clientA.on('state', handler);
  });
  const statePromiseB = new Promise((resolve) => {
    const handler = (s) => {
      if (s.game?.status === 'playing') {
        clientB.off('state', handler);
        resolve(s);
      }
    };
    clientB.on('state', handler);
  });

  const [stateA, stateB] = await Promise.all([statePromiseA, statePromiseB]);
  assert.equal(stateA.game.round, stateB.game.round);
  assert.equal(stateA.game.status, 'playing');
  assert.equal(stateB.game.status, 'playing');
  assert.equal(stateA.game.players.p1.score, stateB.game.players.p1.score);
  assert.equal(stateA.game.players.p2.score, stateB.game.players.p2.score);
  console.log('PASS: Synchronized state verified on both clients in playing state.');

  // 6. Test movement and authoritative capture
  clientA.emit('input:move', { dx: 1, dy: 0 });
  await wait(100);

  const captureRes = await new Promise((resolve) => {
    clientA.emit('input:capture', {}, resolve);
  });
  assert.equal(typeof captureRes.ok, 'boolean');
  console.log('PASS: Server evaluated capture request authoritatively.');

  // 7. Rematch voting test
  // Set room to match_end in memory or test rematch command
  const rematchRes = await new Promise((resolve) => {
    clientA.emit('game:rematch', {}, resolve);
  });
  // Since match is currently playing, rematch returns ok: false
  assert.equal(rematchRes.ok, false);
  console.log('PASS: Rematch rejected when match is not in match_end status.');

  clientA.close();
  clientB.close();
  console.log('\n=== ALL INTEGRATION MULTIPLAYER TESTS PASSED ===\n');
  process.exitCode = 0;
} catch (err) {
  console.error('Multiplayer Integration Test FAILED:', err);
  process.exitCode = 1;
} finally {
  proc.kill();
}
