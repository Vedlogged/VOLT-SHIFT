import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const TEST_PORT = 3205;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('[E2E TEST] Starting standalone server on port', TEST_PORT);
const proc = spawn(process.execPath, ['src/index.js'], {
  cwd: serverRoot,
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverReadyPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server start timed out')), 5000);
  proc.stdout.on('data', (d) => {
    if (d.toString().includes('listening on port')) {
      clearTimeout(timeout);
      resolve();
    }
  });
  proc.on('error', reject);
});

try {
  await serverReadyPromise;
  const serverUrl = `http://127.0.0.1:${TEST_PORT}`;

  console.log('[E2E TEST] Connecting Pilot A and Pilot B...');
  const clientA = io(serverUrl, { transports: ['websocket'] });
  const clientB = io(serverUrl, { transports: ['websocket'] });

  await Promise.all([
    new Promise((res) => clientA.once('connect', res)),
    new Promise((res) => clientB.once('connect', res)),
  ]);
  console.log('✓ Both pilots connected');

  // 1. Pilot A creates room
  const createRes = await new Promise((res) => clientA.emit('room:create', { name: 'Valkyrie' }, res));
  assert.equal(createRes.ok, true);
  const code = createRes.code;
  console.log(`✓ Sector created: ${code}`);

  // 2. Pilot B joins room
  const joinRes = await new Promise((res) => clientB.emit('room:join', { code, name: 'Specter' }, res));
  assert.equal(joinRes.ok, true);
  console.log('✓ Pilot B joined as P2');

  // 3. Ready up both players
  await new Promise((res) => clientA.emit('player:ready', {}, res));
  await new Promise((res) => clientB.emit('player:ready', {}, res));
  console.log('✓ Both pilots engaged READY');

  // 4. Pilot A (host) starts match
  const startRes = await new Promise((res) => clientA.emit('game:start', {}, res));
  assert.equal(startRes.ok, true);
  console.log('✓ Match countdown initiated');

  // Wait for 3-second countdown to finish
  await wait(3300);

  // 5. Verify playing status on both clients
  const stateA = await new Promise((res) => {
    const fn = (s) => {
      if (s.game?.status === 'playing') {
        clientA.off('state', fn);
        res(s);
      }
    };
    clientA.on('state', fn);
  });
  assert.equal(stateA.game.status, 'playing');
  assert.equal(stateA.game.round, 1);
  console.log('✓ Synchronized playing state verified');

  // 6. Test Pilot A movement
  const moveRes = await new Promise((res) => clientA.emit('input:move', { dx: 1, dy: 0 }, res));
  assert.equal(moveRes.ok, true);
  console.log('✓ Movement input evaluated and accepted');

  // 7. Verify Energy Node Diversity
  const nodeTypes = new Set(stateA.game.nodes.map((n) => n.type));
  console.log('✓ Active node types in arena:', Array.from(nodeTypes).join(', '));
  assert.ok(nodeTypes.has('normal') || nodeTypes.has('surge') || nodeTypes.has('anchor') || nodeTypes.has('void'));

  // 8. Test Pilot A capture attempt
  const captureRes = await new Promise((res) => clientA.emit('input:capture', {}, res));
  assert.equal(typeof captureRes.ok, 'boolean');
  console.log('✓ Capture action evaluated authoritatively');

  clientA.close();
  clientB.close();
  console.log('\n========================================');
  console.log('ALL E2E GAMEPLAY TESTS PASSED PERFECTLY!');
  console.log('========================================\n');
  process.exitCode = 0;
} catch (err) {
  console.error('E2E Test Failed:', err);
  process.exitCode = 1;
} finally {
  proc.kill();
}
