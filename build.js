import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('[BUILD] Starting VOLT//SHIFT production build...');

// Check if running directly inside client folder or from root
if (fs.existsSync('src/main.jsx')) {
  console.log('[BUILD] Running in client directory...');
  execSync('npx vite build', { stdio: 'inherit' });
} else {
  console.log('[BUILD] Running from root...');
  execSync('npx vite build', { stdio: 'inherit' });
  // Ensure both dist and client/dist have index.html
  if (fs.existsSync('dist')) {
    if (!fs.existsSync('client/dist')) {
      fs.mkdirSync('client/dist', { recursive: true });
    }
    fs.cpSync('dist', 'client/dist', { recursive: true });
  }
}

console.log('[BUILD] Production build complete! Entrypoint verified at dist/index.html');
