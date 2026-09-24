/**
 * VOLT//SHIFT Procedural Web Audio Engine
 * Zero external asset dependencies. High performance, zero latency,
 * cyberpunk-inspired procedural sound synthesis.
 */

let audioCtx = null;
let isMuted = localStorage.getItem('voltshift_muted') === 'true';

function getAudioContext() {
  if (isMuted) return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem('voltshift_muted', String(isMuted));
  return isMuted;
}

export function getMuteState() {
  return isMuted;
}

export function playCountdown(isGo = false) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = isGo ? 'sawtooth' : 'sine';
  osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
  if (isGo) {
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.3);
  }

  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.45 : 0.2));

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + (isGo ? 0.5 : 0.25));
}

export function playCapture() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(1040, now + 0.15);

  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.2);
}

export function playSteal() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(320, now);
  osc1.frequency.linearRampToValueAtTime(640, now + 0.08);
  osc1.frequency.linearRampToValueAtTime(320, now + 0.16);

  osc2.type = 'square';
  osc2.frequency.setValueAtTime(220, now);

  gain.gain.setValueAtTime(0.22, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.26);
  osc2.stop(now + 0.26);
}

export function playLock() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  [659.25, 830.61, 987.77].forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.05);

    gain.gain.setValueAtTime(0.12, now + idx * 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + idx * 0.05);
    osc.stop(now + idx * 0.05 + 0.45);
  });
}

export function playArenaShift() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(260, now);
  osc.frequency.exponentialRampToValueAtTime(65, now + 0.35);

  gain.gain.setValueAtTime(0.28, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.45);
}

export function playSuddenDeath() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.linearRampToValueAtTime(880, now + 0.2);
  osc.frequency.linearRampToValueAtTime(440, now + 0.4);

  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.55);
}

export function playWin() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.1);

    gain.gain.setValueAtTime(0.18, now + idx * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + idx * 0.1);
    osc.stop(now + idx * 0.1 + 0.7);
  });
}

export function playLose() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const notes = [440, 415.3, 392, 349.23];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now + idx * 0.12);

    gain.gain.setValueAtTime(0.14, now + idx * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + idx * 0.12);
    osc.stop(now + idx * 0.12 + 0.5);
  });
}

export function playClick() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, now);

  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.06);
}
