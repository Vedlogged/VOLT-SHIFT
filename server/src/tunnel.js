import { spawn } from 'node:child_process';
import fs from 'node:fs';

console.log('[TUNNEL] Establishing public HTTPS/WSS tunnel to port 3001...');

function run() {
  const proc = spawn('ssh', ['-o', 'StrictHostKeyChecking=no', '-R', '80:localhost:3001', 'nokey@localhost.run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (d) => {
    const text = d.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/);
    if (match) {
      const url = match[0];
      console.log('\n======================================================');
      console.log('>>> LIVE PUBLIC MULTIPLAYER BACKEND ACTIVE AT: <<<');
      console.log(url);
      console.log('Health Check: ' + url + '/health');
      console.log('======================================================\n');
      try {
        fs.writeFileSync('public-backend-url.txt', url);
      } catch (_) {}
    }
  });

  proc.stderr.on('data', () => {});

  proc.on('close', () => {
    console.log('[TUNNEL] Reconnecting in 3s...');
    setTimeout(run, 3000);
  });
}

run();
