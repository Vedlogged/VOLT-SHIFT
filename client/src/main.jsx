import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sound from './sound.js';
import { NetworkManager } from './network.js';
import './styles.css';

function getInitialServerUrl() {
  if (typeof window === 'undefined') return 'http://localhost:3001';

  // 1. Check URL query parameter: ?server=https://...
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get('server');
  if (serverParam && (serverParam.startsWith('http://') || serverParam.startsWith('https://'))) {
    localStorage.setItem('voltshift_server_url', serverParam);
    return serverParam;
  }

  // 2. Check saved custom server URL in localStorage (ignore dead temporary tunnels)
  const saved = localStorage.getItem('voltshift_server_url');
  if (saved && (saved.startsWith('http://') || saved.startsWith('https://')) && !saved.includes('.lhr.life')) {
    return saved;
  }

  // 3. Check Vite build-time environment variable
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }

  // 4. Default for local development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }

  // 5. Default: Peer Mesh (standalone / serverless ready)
  return '';
}

const RESUME_KEY = 'voltshift_resume_token';
const CALLSIGN_KEY = 'voltshift_callsign';

export function App() {
  const [serverUrl, setServerUrl] = useState(getInitialServerUrl);
  const [screen, setScreen] = useState('home'); // 'home' | 'lobby' | 'game'
  const [callsign, setCallsign] = useState(() => localStorage.getItem(CALLSIGN_KEY) || 'Pilot');
  const [roomCode, setRoomCode] = useState('');
  const [serverState, setServerState] = useState(null);
  const [mySlot, setMySlot] = useState(null);
  const [netStatus, setNetStatus] = useState({ connected: true, mode: 'ready', label: 'ONLINE' });
  const [errorToast, setErrorToast] = useState('');
  const [infoToast, setInfoToast] = useState('');
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [serverConfigOpen, setServerConfigOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(() => Sound.getMuteState());
  const [floatingTexts, setFloatingTexts] = useState([]);

  const netRef = useRef(null);
  const keysRef = useRef({});
  const lastEventProcessedRef = useRef(null);

  // Initialize callsign persistence
  const updateCallsign = (name) => {
    const safe = name.replace(/[<>]/g, '').slice(0, 16);
    setCallsign(safe);
    localStorage.setItem(CALLSIGN_KEY, safe);
  };

  const showToast = (msg, isError = true) => {
    if (isError) {
      setErrorToast(msg);
      setTimeout(() => setErrorToast(''), 5000);
    } else {
      setInfoToast(msg);
      setTimeout(() => setInfoToast(''), 3500);
    }
  };

  const toggleSound = () => {
    const muted = Sound.toggleMute();
    setIsMuted(muted);
  };

  // Initialize Unified Networking Layer
  useEffect(() => {
    const net = new NetworkManager({
      onState: (state) => {
        setServerState(state);
        if (!state) {
          setScreen('home');
          return;
        }

        if (state.status === 'lobby') {
          setScreen('lobby');
        } else if (state.status) {
          setScreen('game');
        }
      },
      onConnectStatus: (status) => {
        setNetStatus(status);
      },
      onToast: showToast,
    });

    netRef.current = net;

    if (serverUrl && !serverUrl.includes('.lhr.life')) {
      net.connectCloud(serverUrl);
    } else {
      setNetStatus({ connected: true, mode: 'peer', label: 'READY' });
    }

    // Check URL search params for quick room join (?room=K7PX)
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && roomParam.length === 4) {
      setRoomCode(roomParam.toUpperCase());
    }

    return () => {
      net.cleanupLocalSession();
      if (net.socket) net.socket.disconnect();
    };
  }, [serverUrl]);

  // Event Sound & Floating Feedback Triggering
  useEffect(() => {
    if (!serverState?.game?.lastEvent) return;
    const evt = serverState.game.lastEvent;
    if (lastEventProcessedRef.current === evt.at) return;
    lastEventProcessedRef.current = evt.at;

    const isMe = evt.player === mySlot;
    const nodeTypeName = evt.nodeType ? evt.nodeType.toUpperCase() : 'CORE';

    if (evt.type === 'capture') {
      Sound.playCapture(evt.nodeType);
      if (isMe) {
        addFloatingText(`+${evt.points} ${nodeTypeName} CAPTURE!`, evt.nodeType === 'void' ? 'violet' : evt.nodeType === 'surge' ? 'amber' : 'cyan');
      } else {
        addFloatingText(`RIVAL CAPTURED ${nodeTypeName}`, 'magenta');
      }
    } else if (evt.type === 'steal') {
      Sound.playSteal();
      if (isMe) {
        addFloatingText(`+${evt.points} ${nodeTypeName} STOLEN!`, 'yellow');
      } else {
        addFloatingText(`ENERGY INTERCEPTED!`, 'red');
      }
    } else if (evt.type === 'lock') {
      Sound.playLock();
      if (isMe) {
        addFloatingText(`+${evt.bonus || 5} LOCKED IN!`, 'green');
      }
    } else if (evt.type === 'sudden_death') {
      Sound.playSuddenDeath();
      addFloatingText('⚡ SUDDEN DEATH SINGULARITY ⚡', 'gold');
    } else if (evt.type === 'round_end') {
      if (evt.winner === mySlot) {
        Sound.playWin();
      } else if (evt.winner) {
        Sound.playLose();
      }
    } else if (evt.type === 'match_end') {
      if (evt.winner === mySlot) {
        Sound.playWin();
      } else {
        Sound.playLose();
      }
    }
  }, [serverState?.game?.lastEvent, mySlot]);

  // Audio trigger for arena shifts
  useEffect(() => {
    if (serverState?.game?.arenaShift) {
      Sound.playArenaShift(serverState.game.arenaShift.isSurge);
    }
  }, [serverState?.game?.arenaShift?.at]);

  const addFloatingText = (text, color = 'cyan') => {
    const id = Date.now() + Math.random();
    setFloatingTexts((prev) => [...prev.slice(-4), { id, text, color }]);
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((item) => item.id !== id));
    }, 1800);
  };

  // User Actions
  const handleCreateRoom = async () => {
    Sound.playClick();
    const res = await netRef.current?.createRoom({
      callsign,
      preferCloud: netStatus.mode === 'cloud',
    });
    if (res?.ok) {
      setRoomCode(res.code);
      setMySlot(res.slot);
      setScreen('lobby');
      showToast(`Sector ${res.code} created!`, false);
    } else {
      showToast('Could not create room. Try again.');
    }
  };

  const handleJoinRoom = async (codeToJoin = roomCode) => {
    Sound.playClick();
    const cleanCode = String(codeToJoin || '').trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 4) {
      showToast('Please enter a valid 4-character room code.');
      return;
    }

    const res = await netRef.current?.joinRoom({ code: cleanCode, callsign });
    if (res?.ok) {
      setRoomCode(res.code);
      setMySlot(res.slot);
      setScreen('lobby');
      showToast(`Joined Sector ${res.code}!`, false);
    } else {
      showToast(res?.reason || 'Sector host not found. Verify the code.');
    }
  };

  const handleSoloMode = () => {
    Sound.playClick();
    const res = netRef.current?.startSoloMode({ callsign });
    if (res?.ok) {
      setRoomCode('SOLO');
      setMySlot('p1');
      setScreen('game');
      showToast('Combat Simulation Active! Rival: VECTOR-AI', false);
    }
  };

  const handleToggleReady = () => {
    Sound.playClick();
    netRef.current?.toggleReady();
  };

  const handleStartGame = async () => {
    Sound.playClick();
    const res = await netRef.current?.startGame();
    if (res && !res.ok) {
      const errs = {
        NEED_TWO_PLAYERS: 'Waiting for a second pilot to connect.',
        BOTH_MUST_BE_READY: 'Both pilots must engage READY before starting.',
        NOT_HOST: 'Only the sector host can launch the match.',
      };
      showToast(errs[res.error] || 'Unable to launch match.');
    }
  };

  const handleRematch = () => {
    Sound.playClick();
    netRef.current?.sendRematch();
  };

  const handleLeaveRoom = () => {
    Sound.playClick();
    localStorage.removeItem(RESUME_KEY);
    netRef.current?.cleanupLocalSession();
    setScreen('home');
    setServerState(null);
    setMySlot(null);
  };

  // Keyboard Movement & Capture Listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      const k = e.key.toLowerCase();
      keysRef.current[k] = true;

      if (e.code === 'Space' || k === 'e' || k === 'enter') {
        if (screen === 'game' && serverState?.game?.status === 'playing') {
          e.preventDefault();
          handleCaptureAction();
        }
      }
    };

    const handleKeyUp = (e) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [screen, serverState]);

  // Movement Dispatch Loop (Desktop Keyboard)
  useEffect(() => {
    if (screen !== 'game' || !serverState?.game) return;
    const status = serverState.game.status;
    if (status !== 'playing' && status !== 'sudden_death') return;

    const interval = setInterval(() => {
      let dx = 0;
      let dy = 0;
      const k = keysRef.current;

      if (k['w'] || k['arrowup']) dy -= 1;
      if (k['s'] || k['arrowdown']) dy += 1;
      if (k['a'] || k['arrowleft']) dx -= 1;
      if (k['d'] || k['arrowright']) dx += 1;

      if (dx !== 0 || dy !== 0) {
        netRef.current?.sendMove(dx, dy);
      }
    }, 45); // ~22Hz dispatch rate

    return () => clearInterval(interval);
  }, [screen, serverState?.game?.status]);

  const handleCaptureAction = useCallback(() => {
    netRef.current?.sendCapture();
  }, []);

  const handleDirectionInput = useCallback((dx, dy) => {
    netRef.current?.sendMove(dx, dy);
  }, []);

  const players = serverState?.players || {};
  const me = players[mySlot];
  const otherSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const opponent = players[otherSlot];
  const gs = serverState?.game;

  return (
    <div className="app-container">
      {/* Background Cyber Grid */}
      <div className="cyber-grid-bg" />

      {/* Global Header Bar */}
      <header className="global-header">
        <div className="brand" onClick={() => screen === 'home' && null}>
          VOLT<span>//</span>SHIFT
        </div>
        <div className="header-controls">
          <button
            className="icon-btn"
            onClick={toggleSound}
            title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
            aria-label="Toggle Sound"
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
          <button
            className="secondary-btn small-btn"
            onClick={() => {
              Sound.playClick();
              setHowToPlayOpen(true);
            }}
          >
            HOW TO PLAY
          </button>
          <div
            className="status-pill clickable"
            onClick={() => setServerConfigOpen(true)}
            title="Click to view network configuration"
          >
            <span className="status-dot online" />
            {netStatus.label || 'ONLINE'}
          </div>
        </div>
      </header>

      {/* Floating Notifications / Toasts */}
      {errorToast && (
        <div className="toast error-toast">
          <span>⚠️ {errorToast}</span>
          <button onClick={() => setErrorToast('')}>×</button>
        </div>
      )}
      {infoToast && (
        <div className="toast info-toast">
          <span>ℹ️ {infoToast}</span>
          <button onClick={() => setInfoToast('')}>×</button>
        </div>
      )}

      {/* Screen Routing */}
      {screen === 'home' && (
        <HomeScreen
          callsign={callsign}
          onCallsignChange={updateCallsign}
          roomCode={roomCode}
          onRoomCodeChange={setRoomCode}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onSoloMode={handleSoloMode}
          onOpenRules={() => {
            Sound.playClick();
            setHowToPlayOpen(true);
          }}
        />
      )}

      {screen === 'lobby' && (
        <LobbyScreen
          roomCode={serverState?.roomCode || roomCode}
          players={players}
          mySlot={mySlot}
          isHost={serverState?.hostSlot === mySlot}
          onToggleReady={handleToggleReady}
          onStartGame={handleStartGame}
          onLeaveRoom={handleLeaveRoom}
          onCopyLink={() => {
            Sound.playCopy();
            const url = `${window.location.origin}${window.location.pathname}?room=${serverState?.roomCode || roomCode}`;
            navigator.clipboard?.writeText(url);
            showToast('Direct invite link copied to clipboard!', false);
          }}
        />
      )}

      {screen === 'game' && (
        <GameScreen
          gs={gs}
          roomCode={serverState?.roomCode}
          players={players}
          mySlot={mySlot}
          me={me}
          opponent={opponent}
          otherSlot={otherSlot}
          rematchVotes={serverState?.rematchVotes || []}
          onDirectionInput={handleDirectionInput}
          onCapture={handleCaptureAction}
          onRematch={handleRematch}
          onLeave={handleLeaveRoom}
          floatingTexts={floatingTexts}
        />
      )}

      {/* Interactive How To Play Mini-Tutorial Modal */}
      {howToPlayOpen && (
        <HowToPlayModal onClose={() => setHowToPlayOpen(false)} />
      )}

      {/* Server Uplink Configuration Modal */}
      {serverConfigOpen && (
        <ServerConfigModal
          currentUrl={serverUrl}
          onSaveUrl={(newUrl) => {
            localStorage.setItem('voltshift_server_url', newUrl);
            setServerUrl(newUrl);
            showToast(newUrl ? `Backend target updated to ${newUrl}` : 'Operating in Standalone Peer Mesh mode', false);
          }}
          onClose={() => setServerConfigOpen(false)}
        />
      )}
    </div>
  );
}

// ----------------- HOME SCREEN -----------------
function HomeScreen({
  callsign,
  onCallsignChange,
  roomCode,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  onSoloMode,
  onOpenRules,
}) {
  return (
    <main className="screen home-screen">
      <div className="hero-section">
        <div className="hero-badge">FAST 2-PLAYER COMPETITIVE CYBER ARENA</div>
        <h1 className="hero-title">
          CAPTURE ENERGY.<br />
          <span className="neon-text">SHIFT THE ARENA.</span><br />
          <span className="highlight-text">STEAL THE ADVANTAGE.</span>
        </h1>
        <p className="hero-desc">
          Unstable energy nodes alter the shared arena every time they are captured. Intercept rival power before it locks, master dynamic sector shifts, and dominate the best-of-three match.
        </p>

        <div className="auth-card">
          <label className="input-label">
            PILOT CALLSIGN
            <input
              type="text"
              className="cyber-input"
              value={callsign}
              maxLength={16}
              onChange={(e) => onCallsignChange(e.target.value)}
              placeholder="Pilot Name"
            />
          </label>

          <div className="action-buttons">
            <button className="primary-btn glow-btn" onClick={onCreateRoom}>
              CREATE ROOM
            </button>

            <div className="join-container">
              <input
                type="text"
                className="cyber-input code-input"
                placeholder="4-LETTER CODE"
                maxLength={4}
                value={roomCode}
                onChange={(e) => onRoomCodeChange(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && onJoinRoom()}
              />
              <button className="secondary-btn" onClick={() => onJoinRoom()}>
                JOIN
              </button>
            </div>
          </div>

          {/* Instant Solo Practice vs Autonomous AI Pilot */}
          <div className="solo-action-container" style={{ marginTop: '14px', width: '100%' }}>
            <button
              type="button"
              className="secondary-btn glow-btn"
              style={{
                width: '100%',
                borderColor: 'var(--amber)',
                color: '#ffc04d',
                padding: '12px',
                fontSize: '13px',
                letterSpacing: '1px',
                background: 'rgba(255, 153, 0, 0.08)',
              }}
              onClick={onSoloMode}
            >
              ⚡ SOLO COMBAT SIMULATION (VS AI BOT)
            </button>
          </div>
        </div>

        {/* Energy Nodes Showcase Strip */}
        <div className="energy-strip">
          <div className="energy-pill energy-normal">
            <span className="pill-dot">⚡</span>
            <span>VOLT CORE (+10)</span>
          </div>
          <div className="energy-pill energy-surge">
            <span className="pill-dot">💥</span>
            <span>SURGE CORE (+15 SHOCKWAVE)</span>
          </div>
          <div className="energy-pill energy-anchor">
            <span className="pill-dot">🛡️</span>
            <span>ANCHOR CORE (+10 FAST LOCK)</span>
          </div>
          <div className="energy-pill energy-void">
            <span className="pill-dot">🌀</span>
            <span>VOID RIFT (+20 HIGH STAKES)</span>
          </div>
        </div>

        <div className="home-quick-rules" onClick={onOpenRules}>
          <span>⚡ 60s Rounds · Best of 3 · Sudden Death Decider · Pure Server Authority</span>
          <u>Interactive Field Manual →</u>
        </div>
      </div>
    </main>
  );
}

// ----------------- LOBBY SCREEN -----------------
function LobbyScreen({
  roomCode,
  players,
  mySlot,
  isHost,
  onToggleReady,
  onStartGame,
  onLeaveRoom,
  onCopyLink,
}) {
  const p1 = players.p1;
  const p2 = players.p2;
  const myPlayer = players[mySlot];
  const bothConnected = p1?.connected && p2?.connected;
  const bothReady = p1?.ready && p2?.ready;

  return (
    <main className="screen lobby-screen">
      <div className="lobby-card">
        <div className="lobby-header">
          <div className="eyebrow">SECTOR BRIEFING ROOM</div>
          <h2 className="room-title">ARENA ACCESS CODE</h2>
          <div className="room-code-display" onClick={onCopyLink} title="Click to copy direct join link">
            <span className="code-text">{roomCode}</span>
            <button className="copy-badge">📋 COPY LINK</button>
          </div>
          <p className="lobby-hint">Share this 4-letter access code with your rival to initiate arena link.</p>
        </div>

        <div className="players-grid">
          {/* Player 1 Card (Cyan Volt Strike) */}
          <div className={`player-card p1-card ${p1 ? 'active' : 'empty'}`}>
            <div className="player-avatar p1-avatar">
              <svg viewBox="0 0 40 40" className="pilot-icon-svg">
                <polygon points="20,4 34,34 20,26 6,34" fill="#00f0ff" stroke="#fff" strokeWidth="1.5" />
                <circle cx="20" cy="20" r="3" fill="#fff" />
              </svg>
            </div>
            <div className="player-info">
              <div className="player-name-row">
                <h3>{p1 ? p1.name : 'WAITING FOR PILOT 1...'}</h3>
                {mySlot === 'p1' && <span className="you-tag">YOU</span>}
              </div>
              <div className="ship-callout">CRAFT: VOLT STRIKER [CYAN]</div>
              <div className={`ready-status ${p1?.ready ? 'ready' : 'not-ready'}`}>
                {p1 ? (p1.ready ? '● READY TO LAUNCH' : '○ SYSTEM STANDBY') : 'VACANT'}
              </div>
            </div>
          </div>

          {/* Player 2 Card (Magenta Shift Phantom) */}
          <div className={`player-card p2-card ${p2 ? 'active' : 'empty'}`}>
            <div className="player-avatar p2-avatar">
              <svg viewBox="0 0 40 40" className="pilot-icon-svg">
                <polygon points="20,36 34,6 20,14 6,6" fill="#ff2a6d" stroke="#fff" strokeWidth="1.5" />
                <circle cx="20" cy="20" r="3" fill="#fff" />
              </svg>
            </div>
            <div className="player-info">
              <div className="player-name-row">
                <h3>{p2 ? p2.name : 'WAITING FOR OPPONENT...'}</h3>
                {mySlot === 'p2' && <span className="you-tag">YOU</span>}
              </div>
              <div className="ship-callout">CRAFT: SHIFT PHANTOM [MAGENTA]</div>
              <div className={`ready-status ${p2?.ready ? 'ready' : 'not-ready'}`}>
                {p2 ? (p2.ready ? '● READY TO LAUNCH' : '○ SYSTEM STANDBY') : 'AWAITING CONNECTION...'}
              </div>
            </div>
          </div>
        </div>

        <div className="lobby-actions">
          <button
            className={`action-btn ready-btn ${myPlayer?.ready ? 'cancel-ready' : 'confirm-ready'}`}
            onClick={onToggleReady}
          >
            {myPlayer?.ready ? 'CANCEL READY' : 'PILOT READY'}
          </button>

          {isHost ? (
            <button
              className={`primary-btn start-match-btn ${bothConnected && bothReady ? 'pulse-ready' : 'disabled'}`}
              disabled={!bothConnected || !bothReady}
              onClick={onStartGame}
            >
              {!p2
                ? 'WAITING FOR OPPONENT...'
                : !bothReady
                ? 'WAITING FOR BOTH PILOTS'
                : 'ENGAGE MATCH'}
            </button>
          ) : (
            <div className="waiting-host-note">
              Waiting for host to launch the match once both pilots are ready...
            </div>
          )}

          <button className="secondary-btn leave-btn" onClick={onLeaveRoom}>
            LEAVE SECTOR
          </button>
        </div>
      </div>
    </main>
  );
}

// ----------------- GAME SCREEN -----------------
function GameScreen({
  gs,
  roomCode,
  players = {},
  mySlot,
  me,
  opponent,
  otherSlot,
  rematchVotes = [],
  onDirectionInput,
  onCapture,
  onRematch,
  onLeave,
  floatingTexts = [],
}) {
  const [now, setNow] = useState(Date.now());
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const joystickBaseRef = useRef(null);
  const joystickTouchIdRef = useRef(null);
  const joystickIntervalRef = useRef(null);
  const joystickVectorRef = useRef({ dx: 0, dy: 0 });

  // 10Hz UI clock ticker
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  if (!gs) {
    return (
      <main className="screen game-screen">
        <div className="loading-container">
          <div className="loading-spinner" />
          <h2>INITIALIZING ARENA UPLINK...</h2>
        </div>
      </main>
    );
  }

  const myPlayer = gs.players?.[mySlot];
  const otherPlayer = gs.players?.[otherSlot];
  const isPlaying = gs.status === 'playing' || gs.status === 'sudden_death';
  const isCountdown = gs.status === 'countdown';
  const isRoundEnd = gs.status === 'round_end';
  const isMatchEnd = gs.status === 'match_end';

  // Timer Calculation
  const secondsRemaining = gs.roundEndsAt
    ? Math.max(0, Math.ceil((gs.roundEndsAt - now) / 1000))
    : 60;
  const countdownSeconds = gs.countdownEndsAt
    ? Math.max(1, Math.ceil((gs.countdownEndsAt - now) / 1000))
    : 3;

  const opponentDisconnected = opponent && !opponent.connected;
  const iVotedRematch = rematchVotes.includes(mySlot);

  // Virtual Touch Joystick Handling
  const handleJoystickStart = (e) => {
    const touch = e.touches[0];
    joystickTouchIdRef.current = touch.identifier;
    setJoystickActive(true);
    updateJoystickPosition(touch);

    if (!joystickIntervalRef.current) {
      joystickIntervalRef.current = setInterval(() => {
        const { dx, dy } = joystickVectorRef.current;
        if (dx !== 0 || dy !== 0) {
          onDirectionInput(dx, dy);
        }
      }, 45);
    }
  };

  const updateJoystickPosition = (touch) => {
    if (!joystickBaseRef.current) return;
    const rect = joystickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = touch.clientX - centerX;
    const deltaY = touch.clientY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    const maxRadius = rect.width / 2 - 10;

    let clampedX = deltaX;
    let clampedY = deltaY;

    if (distance > maxRadius) {
      clampedX = (deltaX / distance) * maxRadius;
      clampedY = (deltaY / distance) * maxRadius;
    }

    setJoystickPos({ x: clampedX, y: clampedY });
    joystickVectorRef.current = {
      dx: clampedX / maxRadius,
      dy: clampedY / maxRadius,
    };
  };

  const handleJoystickMove = (e) => {
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === joystickTouchIdRef.current) {
        updateJoystickPosition(e.touches[i]);
        break;
      }
    }
  };

  const handleJoystickEnd = () => {
    setJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
    joystickVectorRef.current = { dx: 0, dy: 0 };
    if (joystickIntervalRef.current) {
      clearInterval(joystickIntervalRef.current);
      joystickIntervalRef.current = null;
    }
  };

  // D-Pad Pointer Hold Handlers
  const dpadIntervalRef = useRef(null);
  const startDpadHold = (dx, dy) => {
    onDirectionInput(dx, dy);
    if (dpadIntervalRef.current) clearInterval(dpadIntervalRef.current);
    dpadIntervalRef.current = setInterval(() => onDirectionInput(dx, dy), 50);
  };
  const stopDpadHold = () => {
    if (dpadIntervalRef.current) {
      clearInterval(dpadIntervalRef.current);
      dpadIntervalRef.current = null;
    }
  };

  return (
    <main className="screen game-screen">
      {/* Opponent Disconnected Banner */}
      {opponentDisconnected && (
        <div className="disconnect-banner">
          ⚠️ RIVAL LINK LOST — Waiting 20s for reconnection...
        </div>
      )}

      {/* Match HUD Topbar */}
      <div className="game-hud">
        {/* P1 Score Card */}
        <div className={`hud-player p1-hud ${mySlot === 'p1' ? 'is-me' : ''}`}>
          <div className="hud-player-meta">
            <span className="slot-badge p1-badge">P1</span>
            <span className="hud-callsign">{players?.p1?.name || 'Pilot 1'}</span>
            {mySlot === 'p1' && <span className="hud-you">(YOU)</span>}
          </div>
          <div className="hud-score-val">{gs.players?.p1?.score || 0}</div>
          <div className="round-pips">
            <span className={`pip ${gs.roundWins?.p1 >= 1 ? 'filled' : ''}`} />
            <span className={`pip ${gs.roundWins?.p1 >= 2 ? 'filled' : ''}`} />
          </div>
        </div>

        {/* Center Timer & Round Info */}
        <div className="hud-center">
          <div className="timer-badge">
            {isCountdown ? (
              <span className="countdown-hud-text">STANDBY</span>
            ) : gs.status === 'sudden_death' ? (
              <span className="sudden-death-hud-text">⚡ SUDDEN DEATH</span>
            ) : (
              <span className="timer-text">
                {String(Math.floor(secondsRemaining / 60)).padStart(2, '0')}:
                {String(secondsRemaining % 60).padStart(2, '0')}
              </span>
            )}
          </div>
          <div className="round-label">
            ROUND {gs.round} <span className="series-label">(FIRST TO 2)</span>
          </div>
        </div>

        {/* P2 Score Card */}
        <div className={`hud-player p2-hud ${mySlot === 'p2' ? 'is-me' : ''}`}>
          <div className="hud-player-meta">
            <span className="slot-badge p2-badge">P2</span>
            <span className="hud-callsign">{players?.p2?.name || 'Pilot 2'}</span>
            {mySlot === 'p2' && <span className="hud-you">(YOU)</span>}
          </div>
          <div className="hud-score-val">{gs.players?.p2?.score || 0}</div>
          <div className="round-pips">
            <span className={`pip ${gs.roundWins?.p2 >= 1 ? 'filled' : ''}`} />
            <span className={`pip ${gs.roundWins?.p2 >= 2 ? 'filled' : ''}`} />
          </div>
        </div>
      </div>

      {/* Floating Action Text Feedback */}
      <div className="floating-text-container">
        {floatingTexts.map((item) => (
          <div key={item.id} className={`floating-msg msg-${item.color}`}>
            {item.text}
          </div>
        ))}
      </div>

      {/* Arena Viewport */}
      <div className="arena-outer-frame">
        <div
          className={`arena-viewport ${gs.arenaShift ? (gs.arenaShift.isSurge ? 'arena-pulse-surge' : 'arena-pulse-active') : ''}`}
        >
          {/* Animated Grid Lines & Sector Dividers */}
          <div className="arena-grid-overlay" />
          <div className="arena-sectors-overlay">
            <div className="sector-zone sector-alpha">
              <span className="sector-tag">ALPHA ZONE</span>
            </div>
            <div className="sector-zone sector-core">
              <span className="sector-tag">CORE NEXUS</span>
            </div>
            <div className="sector-zone sector-omega">
              <span className="sector-tag">OMEGA ZONE</span>
            </div>
          </div>

          {/* Energy Nodes */}
          {gs.nodes?.map((node) => {
            const isContested = node.state === 'contested';
            const isLocked = node.state === 'locked';
            const isSudden = node.isSuddenDeath;
            const nodeType = node.type || 'normal';
            const maxDuration = nodeType === 'anchor' ? 1600 : nodeType === 'void' ? 2000 : 2500;
            const contestTimeLeft = node.expiresAt
              ? Math.max(0, ((node.expiresAt - now) / maxDuration) * 100)
              : 0;

            const iconMap = {
              normal: '⚡',
              surge: '💥',
              anchor: '🛡️',
              void: '🌀',
              sudden_death: '⚡⚡',
            };

            return (
              <div
                key={node.id}
                className={`arena-node node-${node.state} node-type-${nodeType} owner-${node.owner || 'none'} ${
                  isSudden ? 'node-sudden-death' : ''
                }`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
              >
                {/* Node Holographic Core */}
                <div className="node-core">
                  <div className="node-ring" />
                  <span className="node-icon">{isSudden ? '⚡⚡' : isLocked ? '🔒' : iconMap[nodeType] || '⚡'}</span>
                </div>

                {/* Contested Radial/Bar Timer Progress */}
                {isContested && (
                  <div className="contest-indicator">
                    <div
                      className="contest-timer-bar"
                      style={{ width: `${contestTimeLeft}%` }}
                    />
                    <span className="contest-owner-tag">
                      {node.owner === mySlot ? 'SECURE' : 'STEAL!'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Player Cyber Craft Avatars */}
          {['p1', 'p2'].map((slot) => {
            const p = gs.players?.[slot];
            if (!p) return null;
            const isMe = slot === mySlot;
            const playerMeta = players?.[slot];

            // Calculate rotation angle from velocity vector
            const angle = (p.vx || p.vy)
              ? Math.atan2(p.vy || 0, p.vx || 0) * (180 / Math.PI) + 90
              : slot === 'p1' ? 90 : -90;

            return (
              <div
                key={slot}
                className={`player-ship ship-${slot} ${isMe ? 'ship-me' : 'ship-rival'}`}
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                }}
              >
                <div className="ship-body">
                  <svg viewBox="0 0 32 32" className="craft-svg">
                    {slot === 'p1' ? (
                      // P1 Volt Striker: Forward delta wing with cyan aura
                      <g>
                        <polygon points="16,3 29,28 16,21 3,28" fill="#00f0ff" stroke="#ffffff" strokeWidth="1.5" />
                        <polygon points="16,9 24,24 16,19 8,24" fill="#052840" />
                        <circle cx="16" cy="15" r="2.5" fill="#ffffff" />
                      </g>
                    ) : (
                      // P2 Shift Phantom: Stealth razor wing with magenta aura
                      <g>
                        <polygon points="16,3 29,26 22,23 16,28 10,23 3,26" fill="#ff2a6d" stroke="#ffffff" strokeWidth="1.5" />
                        <polygon points="16,8 23,21 16,17 9,21" fill="#400518" />
                        <circle cx="16" cy="14" r="2.5" fill="#ffffff" />
                      </g>
                    )}
                  </svg>
                  <div className="ship-thruster-flame" />
                </div>
                <div
                  className="ship-label"
                  style={{ transform: `rotate(${-angle}deg)` }}
                >
                  {isMe ? 'YOU' : playerMeta?.name?.slice(0, 8).toUpperCase() || slot.toUpperCase()}
                </div>
              </div>
            );
          })}

          {/* COUNTDOWN OVERLAY */}
          {isCountdown && (
            <div className="game-overlay countdown-overlay">
              <div className="countdown-box">
                <div className="countdown-big-num">{countdownSeconds}</div>
                <div className="countdown-sub">SYNCHRONIZING ARENA SECTORS</div>
              </div>
            </div>
          )}

          {/* ROUND END OVERLAY */}
          {isRoundEnd && (
            <div className="game-overlay round-end-overlay">
              <div className="overlay-card">
                <span className="overlay-eyebrow">ROUND {gs.round} COMPLETED</span>
                <h2 className="overlay-title">
                  {gs.lastEvent?.winner === mySlot
                    ? '⚡ ROUND VICTORY ⚡'
                    : gs.lastEvent?.winner
                    ? 'ROUND DEFEAT'
                    : 'ROUND TIED'}
                </h2>
                <div className="overlay-score-summary">
                  <div className="score-col">
                    <span>YOU</span>
                    <b>{myPlayer?.score || 0}</b>
                  </div>
                  <div className="score-divider">—</div>
                  <div className="score-col">
                    <span>RIVAL</span>
                    <b>{otherPlayer?.score || 0}</b>
                  </div>
                </div>
                <p className="overlay-next-note">Calibrating next round...</p>
              </div>
            </div>
          )}

          {/* MATCH END OVERLAY */}
          {isMatchEnd && (
            <div className="game-overlay match-end-overlay">
              <div className="overlay-card match-win-card">
                <span className="overlay-eyebrow">MATCH COMPLETED</span>
                <h1 className="match-outcome-title">
                  {gs.lastEvent?.winner === mySlot ? '🏆 VICTORY!' : 'MATCH DEFEAT'}
                </h1>
                <div className="series-final-tally">
                  <span>FINAL SERIES: {gs.roundWins?.p1} — {gs.roundWins?.p2}</span>
                </div>
                <div className="match-end-actions">
                  <button
                    className={`primary-btn rematch-btn ${iVotedRematch ? 'voted' : ''}`}
                    onClick={onRematch}
                  >
                    {iVotedRematch
                      ? `REMATCH REQUESTED (${rematchVotes.length}/2)...`
                      : 'REQUEST REMATCH'}
                  </button>
                  <button className="secondary-btn" onClick={onLeave}>
                    LEAVE SECTOR
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control Area (Dual Desktop & Mobile Touch Controls) */}
      <div className="game-controls-container">
        {/* Virtual Touch Joystick (Mobile) */}
        <div
          className="virtual-joystick-wrap"
          ref={joystickBaseRef}
          onTouchStart={handleJoystickStart}
          onTouchMove={handleJoystickMove}
          onTouchEnd={handleJoystickEnd}
          onTouchCancel={handleJoystickEnd}
        >
          <div className="joystick-base">
            <div
              className={`joystick-stick ${joystickActive ? 'active' : ''}`}
              style={{
                transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`,
              }}
            />
          </div>
          <span className="joystick-hint">TOUCH & DRAG JOYSTICK</span>
        </div>

        {/* D-Pad Fallback Controls */}
        <div className="dpad-grid">
          <button
            className="dpad-btn dpad-up"
            onPointerDown={() => startDpadHold(0, -1)}
            onPointerUp={stopDpadHold}
            onPointerLeave={stopDpadHold}
          >
            ▲
          </button>
          <div className="dpad-middle-row">
            <button
              className="dpad-btn dpad-left"
              onPointerDown={() => startDpadHold(-1, 0)}
              onPointerUp={stopDpadHold}
              onPointerLeave={stopDpadHold}
            >
              ◀
            </button>
            <button
              className="dpad-btn dpad-down"
              onPointerDown={() => startDpadHold(0, 1)}
              onPointerUp={stopDpadHold}
              onPointerLeave={stopDpadHold}
            >
              ▼
            </button>
            <button
              className="dpad-btn dpad-right"
              onPointerDown={() => startDpadHold(1, 0)}
              onPointerUp={stopDpadHold}
              onPointerLeave={stopDpadHold}
            >
              ▶
            </button>
          </div>
        </div>

        {/* Big Tactile Action / Capture Button */}
        <div className="action-button-wrap">
          <button
            className="big-capture-btn"
            onClick={onCapture}
            title="Capture Energy Node (Space / E / Enter)"
          >
            <span className="btn-lightning">⚡</span>
            <span className="btn-text">CAPTURE</span>
          </button>
        </div>
      </div>

      {/* Footer Info Bar */}
      <footer className="game-footer">
        <span className="desktop-shortcut-tip">
          ⌨️ Desktop: WASD / Arrow Keys to Steer · Spacebar / E / Enter to Capture
        </span>
        <span className="room-ref-tag">SECTOR: {roomCode}</span>
      </footer>
    </main>
  );
}

// ----------------- INTERACTIVE MINI-TUTORIAL MODAL -----------------
function HowToPlayModal({ onClose }) {
  const [activeTab, setActiveTab] = useState(0);

  const steps = [
    {
      title: '1. MANEUVER & SEEK',
      text: 'Pilot your craft into proximity with unstable energy nodes across the Alpha, Core, and Omega sectors.',
      badge: 'MOVE',
      demo: 'move',
    },
    {
      title: '2. CAPTURE & ARENA SHIFT',
      text: 'Trigger CAPTURE (Space / Enter / Button). Absorbing energy fires a shockwave that displaces surrounding nodes!',
      badge: 'SHIFT',
      demo: 'shift',
    },
    {
      title: '3. INTERCEPT & STEAL',
      text: 'Captured power is vulnerable for 2.5s. Rush into opponent nodes before the countdown expires to STEAL their voltage!',
      badge: 'STEAL',
      demo: 'steal',
    },
    {
      title: '4. LOCK IN & SUDDEN DEATH',
      text: 'Holding power until the timer expires awards lock bonus points. If tied at 60s, central Sudden Death Core resolves the round!',
      badge: 'LOCK',
      demo: 'lock',
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content tutorial-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">PILOT MANUAL</div>
            <h2>HOW TO PLAY VOLT//SHIFT</h2>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Step Indicator Tabs */}
        <div className="tutorial-tabs">
          {steps.map((s, idx) => (
            <button
              key={idx}
              className={`tutorial-tab ${activeTab === idx ? 'active' : ''}`}
              onClick={() => {
                Sound.playClick();
                setActiveTab(idx);
              }}
            >
              <span className="tab-num">{idx + 1}</span>
              <span className="tab-label">{s.badge}</span>
            </button>
          ))}
        </div>

        {/* Step Content Card with Animated Interactive Simulation */}
        <div className="tutorial-body">
          <div className="tutorial-text-block">
            <h3>{steps[activeTab].title}</h3>
            <p>{steps[activeTab].text}</p>
          </div>

          <div className={`tutorial-demo-stage demo-${steps[activeTab].demo}`}>
            <div className="demo-canvas">
              <div className="demo-craft" />
              <div className="demo-node demo-node-primary" />
              <div className="demo-node demo-node-secondary" />
              <div className="demo-shockwave" />
            </div>
            <div className="demo-caption">
              {activeTab === 0 && '▲ Use WASD or touch joystick to close in on nodes'}
              {activeTab === 1 && '▲ Capturing power triggers an arena-wide kinetic shockwave'}
              {activeTab === 2 && '▲ Contest countdown ring: dive in to steal rival power'}
              {activeTab === 3 && '▲ 60-second timer: first pilot to win 2 rounds wins the series'}
            </div>
          </div>
        </div>

        {/* Energy Types Quick Reference */}
        <div className="energy-legend-grid">
          <div className="legend-item">
            <span className="legend-icon" style={{ color: '#00f0ff' }}>⚡</span>
            <div><b>VOLT CORE</b><span>+10 pts · Standard Shift</span></div>
          </div>
          <div className="legend-item">
            <span className="legend-icon" style={{ color: '#ff9900' }}>💥</span>
            <div><b>SURGE CORE</b><span>+15 pts · Super Shockwave</span></div>
          </div>
          <div className="legend-item">
            <span className="legend-icon" style={{ color: '#05ffa1' }}>🛡️</span>
            <div><b>ANCHOR CORE</b><span>+10 pts · 1.6s Fast Lock</span></div>
          </div>
          <div className="legend-item">
            <span className="legend-icon" style={{ color: '#bf55ec' }}>🌀</span>
            <div><b>VOID RIFT</b><span>+20 pts · High Risk & Steal Penalty</span></div>
          </div>
        </div>

        <div className="tutorial-footer">
          {activeTab < steps.length - 1 ? (
            <button
              className="primary-btn full-width"
              onClick={() => {
                Sound.playClick();
                setActiveTab((prev) => prev + 1);
              }}
            >
              NEXT: {steps[activeTab + 1].badge} →
            </button>
          ) : (
            <button className="primary-btn full-width" onClick={onClose}>
              READY FOR COMBAT — ENTER ARENA
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------- SERVER CONFIG MODAL -----------------
function ServerConfigModal({ currentUrl, onSaveUrl, onClose }) {
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  const testHealth = async (urlToTest = inputUrl) => {
    setTesting(true);
    setTestStatus(null);
    const cleanUrl = urlToTest.trim().replace(/\/+$/, '');

    // WebRTC Peer Mesh mode requires no external server
    if (!cleanUrl || cleanUrl === 'peer') {
      setTestStatus({
        ok: true,
        latency: 0,
        data: {
          service: 'WebRTC Peer Mesh',
          version: '2.0.0 (Autonomous)',
          activeRooms: 'Serverless P2P Active',
        },
      });
      return;
    }

    setTesting(true);
    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${cleanUrl}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);
      if (res.ok) {
        const data = await res.json();
        setTestStatus({ ok: true, latency, data });
      } else {
        setTestStatus({ ok: false, error: `HTTP ${res.status} ${res.statusText}` });
      }
    } catch (err) {
      setTestStatus({
        ok: false,
        error: err.name === 'AbortError' ? 'Connection timed out (4s)' : (err.message || 'Network error'),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const cleanUrl = inputUrl.trim().replace(/\/+$/, '');
    onSaveUrl(cleanUrl);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content server-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">NETWORK UPLINK CONFIGURATION</div>
            <h2>MULTIPLAYER BACKEND TARGET</h2>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="config-body">
          <p className="config-desc">
            VOLT//SHIFT features hybrid networking: WebRTC Peer Mesh is active for instant zero-server 2-player cross-device multiplayer, or connect a custom Node.js server anytime.
          </p>

          <label className="input-label">
            SERVER URL (OPTIONAL)
            <input
              type="text"
              className="cyber-input"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value);
                setTestStatus(null);
              }}
              placeholder="Leave blank for Peer Mesh or enter https://..."
            />
          </label>

          {/* Quick Presets */}
          <div className="preset-buttons">
            <span className="preset-label">QUICK TARGETS:</span>
            <button
              type="button"
              className="secondary-btn small-btn"
              onClick={() => {
                setInputUrl('');
                testHealth('');
              }}
            >
              ⚡ WebRTC Peer Mesh (Standalone)
            </button>
            <button
              type="button"
              className="secondary-btn small-btn"
              onClick={() => {
                const u = 'http://localhost:3001';
                setInputUrl(u);
                testHealth(u);
              }}
            >
              💻 Localhost (3001)
            </button>
            <button
              type="button"
              className="secondary-btn small-btn"
              onClick={() => {
                const u = 'https://volt-shift-server.onrender.com';
                setInputUrl(u);
                testHealth(u);
              }}
            >
              🌐 Render Service
            </button>
          </div>

          {/* Health Check Test Result */}
          {testStatus && (
            <div className={`health-result-card ${testStatus.ok ? 'health-ok' : 'health-fail'}`}>
              <div className="health-header">
                <b>{testStatus.ok ? '✓ NETWORK ONLINE & HEALTHY' : '✗ CONNECTION FAILED'}</b>
                {testStatus.ok && <span className="latency-badge">{testStatus.latency}ms ping</span>}
              </div>
              {testStatus.ok ? (
                <div className="health-details">
                  <span>Service: {testStatus.data?.service || 'volt-shift-server'}</span>
                  <span>Version: {testStatus.data?.version || '1.2.0'}</span>
                  <span>Active Rooms: {testStatus.data?.activeRooms ?? 0}</span>
                </div>
              ) : (
                <div className="health-error-text">
                  {testStatus.error}. Check that the backend is running and permits CORS.
                </div>
              )}
            </div>
          )}

          <div className="config-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => testHealth(inputUrl)}
              disabled={testing}
            >
              {testing ? 'TESTING...' : '🔍 TEST HEALTH'}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handleSave}
            >
              SAVE & CONNECT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Production UI Crash Guard
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('VOLT//SHIFT UI Crash Caught by ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#050711', color: '#f0f4ff', fontFamily: 'Space Grotesk, sans-serif', padding: '20px', textAlign: 'center' }}>
          <h1 style={{ color: '#00f0ff', letterSpacing: '2px', marginBottom: '12px' }}>VOLT<span>//</span>SHIFT</h1>
          <div style={{ background: 'rgba(12, 17, 34, 0.85)', border: '1px solid #ff2a6d', borderRadius: '8px', padding: '24px', maxWidth: '480px', width: '100%', boxShadow: '0 0 20px rgba(255, 42, 109, 0.3)' }}>
            <h3 style={{ color: '#ff2a6d', marginBottom: '8px' }}>SESSION INTERRUPTED</h3>
            <p style={{ color: '#8b95b5', fontSize: '13px', marginBottom: '20px' }}>
              {this.state.error?.message || 'A visual render error occurred.'}
            </p>
            <button
              style={{ background: '#00f0ff', color: '#050711', border: 'none', padding: '12px 24px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => {
                localStorage.removeItem(RESUME_KEY);
                window.location.href = window.location.origin + window.location.pathname;
              }}
            >
              RETURN TO BASE
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Render root
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
