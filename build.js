import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('[BUILD] Starting VOLT//SHIFT production build...');

// Check if running directly inside client folder or from root
if (fs.existsSync('src/main.jsx')) {
  console.log('[BUILD] Building directly inside client folder...');
  execSync('npm run build', { stdio: 'inherit' });
} else {
  console.log('[BUILD] Building workspace client from root...');
  execSync('npm run build --workspace client', { stdio: 'inherit' });

  // Mirror client/dist to root dist so Vercel finds the bundle regardless of outputDirectory setting
  if (fs.existsSync('client/dist')) {
    fs.cpSync('client/dist', 'dist', { recursive: true });
    console.log('[BUILD] Mirrored client/dist -> root dist');
  }
}

console.log('[BUILD] Production build complete!');
