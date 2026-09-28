import { io } from 'socket.io-client';

const PUBLIC_URL = 'https://a1b896a8c2ec61.lhr.life';

console.log(`Connecting two pilots over PUBLIC URL: ${PUBLIC_URL}...`);

async function run() {
  const clientA = io(PUBLIC_URL, { transports: ['polling', 'websocket'], timeout: 10000 });
  const clientB = io(PUBLIC_URL, { transports: ['polling', 'websocket'], timeout: 10000 });

  await Promise.all([
    new Promise((resolve, reject) => {
      clientA.on('connect', () => {
        console.log(`[PASS] Pilot A connected: ${clientA.id}`);
        resolve();
      });
      clientA.on('connect_error', reject);
    }),
    new Promise((resolve, reject) => {
      clientB.on('connect', () => {
        console.log(`[PASS] Pilot B connected: ${clientB.id}`);
        resolve();
      });
      clientB.on('connect_error', reject);
    }),
  ]);

  // Pilot A creates room
  const createRes = await new Promise((resolve) => {
    clientA.emit('room:create', { callsign: 'AlphaHost' }, resolve);
  });
  console.log('[PASS] Room create response:', createRes);
  if (!createRes.ok) throw new Error('Create room failed');
  const code = createRes.code;

  // Pilot B joins room
  const joinRes = await new Promise((resolve) => {
    clientB.emit('room:join', { roomCode: code, callsign: 'OmegaRival' }, resolve);
  });
  console.log('[PASS] Room join response:', joinRes);
  if (!joinRes.ok) throw new Error('Join room failed');

  // Both pilots toggle ready
  await new Promise((resolve) => clientA.emit('player:ready', {}, resolve));
  await new Promise((resolve) => clientB.emit('player:ready', {}, resolve));
  console.log('[PASS] Both pilots toggled ready');

  // Host starts game
  const startRes = await new Promise((resolve) => {
    clientA.emit('game:start', {}, resolve);
  });
  console.log('[PASS] Game start response:', startRes);
  if (!startRes.ok) throw new Error('Start game failed');

  console.log('Waiting for authoritative countdown sync...');
  await new Promise((resolve) => {
    clientB.on('state', (room) => {
      if (room.game && (room.game.status === 'countdown' || room.game.status === 'playing')) {
        console.log(`[PASS] Pilot B synchronized authoritative state: status=${room.game.status}`);
        resolve();
      }
    });
  });

  clientA.disconnect();
  clientB.disconnect();
  console.log('=== PUBLIC CLOUD MULTIPLAYER VERIFICATION PASSED 100% ===');
  process.exit(0);
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
