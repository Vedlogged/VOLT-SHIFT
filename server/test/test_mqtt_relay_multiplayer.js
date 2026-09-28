import mqtt from 'mqtt';
import * as Engine from '../../client/src/gameEngine.js';

const BROKER = 'wss://broker.emqx.io:8084/mqtt';
const code = 'TEST' + Math.floor(Math.random() * 899 + 100);

console.log(`Testing 2-Player Global Relay over ${BROKER} with Sector Code: ${code}...`);

async function run() {
  const hostClient = mqtt.connect(BROKER, { clientId: 'host_' + Math.random().toString(36).slice(2) });
  const guestClient = mqtt.connect(BROKER, { clientId: 'guest_' + Math.random().toString(36).slice(2) });

  await Promise.all([
    new Promise((resolve) => hostClient.on('connect', resolve)),
    new Promise((resolve) => guestClient.on('connect', resolve)),
  ]);

  console.log('[PASS] Both devices connected to Global WSS Relay');

  // Host initializes local authoritative room
  const localRoom = {
    code,
    hostId: 'p1',
    status: 'lobby',
    players: {
      p1: { id: 'p1', name: 'AlphaLeader', slot: 'p1', connected: true, ready: false },
    },
    game: null,
    rematch: null,
    createdAt: Date.now(),
  };

  const hostTopic = `voltshift/room/${code}/host`;
  const stateTopic = `voltshift/room/${code}/state`;

  await new Promise((resolve) => hostClient.subscribe(hostTopic, resolve));
  await new Promise((resolve) => guestClient.subscribe(stateTopic, resolve));

  // Host handles incoming actions from guest
  hostClient.on('message', (topic, payload) => {
    const data = JSON.parse(payload.toString());
    if (data.type === 'join') {
      localRoom.players.p2 = {
        id: 'p2',
        name: data.callsign || 'OmegaRival',
        slot: 'p2',
        connected: true,
        ready: false,
      };
      hostClient.publish(stateTopic, JSON.stringify(Engine.publicState(localRoom)));
    } else if (data.type === 'ready') {
      if (localRoom.players.p2) {
        localRoom.players.p2.ready = true;
        hostClient.publish(stateTopic, JSON.stringify(Engine.publicState(localRoom)));
      }
    }
  });

  // Guest receives state
  const statePromise = new Promise((resolve) => {
    guestClient.on('message', (topic, payload) => {
      const state = JSON.parse(payload.toString());
      if (state.players?.p2) {
        console.log('[PASS] Guest received lobby synchronization! Players:', Object.keys(state.players));
        resolve(state);
      }
    });
  });

  // Guest sends join request
  guestClient.publish(hostTopic, JSON.stringify({ type: 'join', callsign: 'OmegaRival' }));

  await statePromise;

  // Guest readies up
  guestClient.publish(hostTopic, JSON.stringify({ type: 'ready' }));

  // Host starts game
  localRoom.players.p1.ready = true;
  localRoom.game = Engine.newMatch();
  localRoom.status = 'countdown';

  const countdownPromise = new Promise((resolve) => {
    guestClient.on('message', (topic, payload) => {
      const state = JSON.parse(payload.toString());
      if (state.game?.status === 'countdown') {
        console.log('[PASS] Guest received countdown match start!');
        resolve();
      }
    });
  });

  hostClient.publish(stateTopic, JSON.stringify(Engine.publicState(localRoom)));
  await countdownPromise;

  hostClient.end();
  guestClient.end();

  console.log('====================================================');
  console.log('>>> 2-PLAYER GLOBAL WSS RELAY TEST 100% PASSED! <<<');
  console.log('====================================================');
  process.exit(0);
}

run().catch((e) => {
  console.error('[FAIL]', e);
  process.exit(1);
});
