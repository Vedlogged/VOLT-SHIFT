import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import * as Sound from './sound.js';
import './styles.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const RESUME_KEY = 'voltshift_resume_token';
const CALLSIGN_KEY = 'voltshift_callsign';

export function App() {
  const [screen, setScreen] = useState('home'); // 'home' | 'lobby' | 'game'
  const [callsign, setCallsign] = useState(() => localStorage.getItem(CALLSIGN_KEY) || 'Pilot');
  const [roomCode, setRoomCode] = useState('');
  const [serverState, setServerState] = useState(null);
  const [mySlot, setMySlot] = useState(null);
  const [connected, setConnected] = useState(false);
  const [errorToast, setErrorToast] = useState('');
  const [infoToast, setInfoToast] = useState('');
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(() => Sound.getMuteState());
  const [floatingTexts, setFloatingTexts] = useState([]);

  const socketRef = useRef(null);
  const keysRef = useRef({});
  const lastEventProcessedRef = useRef(null);
  const countdownAudioRef = useRef(null);

  // Initialize callsign persistence
  const updateCallsign = (name) => {
    const safe = name.slice(0, 16);
    setCallsign(safe);
    localStorage.setItem(CALLSIGN_KEY, safe);
  };

  const showToast = (msg, isError = true) => {
    if (isError) {
      setErrorToast(msg);
      setTimeout(() => setErrorToast(''), 4500);
    } else {
      setInfoToast(msg);
      setTimeout(() => setInfoToast(''), 3500);
    }
  };

  const toggleSound = () => {
    const muted = Sound.toggleMute();
    setIsMuted(muted);
  };

  // Connect to Socket.IO Server
  useEffect(() => {
    const storedToken = localStorage.getItem(RESUME_KEY);
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: { resumeToken: storedToken || undefined },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('resume', (res) => {
      if (res && res.ok) {
        setRoomCode(res.code);
        setMySlot(res.slot);
        showToast(`Reconnected to room ${res.code}`, false);
      }
    });

    socket.on('state', (state) => {
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
    });

    // Check URL search params for quick room join (?room=K7PX)
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && roomParam.length === 4) {
      setRoomCode(roomParam.toUpperCase());
    }

    return () => {
      socket.disconnect();
    };
  }, []);

  // Event Sound & Floating Effect Triggering
  useEffect(() => {
    if (!serverState?.game?.lastEvent) return;
    const evt = serverState.game.lastEvent;
    if (lastEventProcessedRef.current === evt.at) return;
    lastEventProcessedRef.current = evt.at;

    if (evt.type === 'capture') {
      Sound.playCapture();
      if (evt.player === mySlot) {
        addFloatingText('+10 CAPTURE!', 'cyan');
      } else {
        addFloatingText('OPPONENT CAPTURE', 'magenta');
      }
    } else if (evt.type === 'steal') {
      Sound.playSteal();
      if (evt.player === mySlot) {
        addFloatingText('+10 STEAL!', 'yellow');
      } else {
        addFloatingText('POWER STOLEN!', 'red');
      }
    } else if (evt.type === 'lock') {
      Sound.playLock();
      if (evt.player === mySlot) {
        addFloatingText(`+${evt.bonus || 5} SECURED!`, 'green');
      }
    } else if (evt.type === 'sudden_death') {
      Sound.playSuddenDeath();
      addFloatingText('⚡ SUDDEN DEATH ⚡', 'gold');
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
      Sound.playArenaShift();
    }
  }, [serverState?.game?.arenaShift?.at]);

  const addFloatingText = (text, color = 'cyan') => {
    const id = Date.now() + Math.random();
    setFloatingTexts((prev) => [...prev.slice(-4), { id, text, color }]);
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((item) => item.id !== id));
    }, 1800);
  };

  const emitPromise = (event, payload) => {
    return new Promise((resolve) => {
      if (!socketRef.current) return resolve({ ok: false });
      socketRef.current.emit(event, payload || {}, (res) => resolve(res || { ok: false }));
    });
  };

  // Actions
  const handleCreateRoom = async () => {
    Sound.playClick();
    const res = await emitPromise('room:create', { name: callsign });
    if (!res.ok) {
      showToast('Could not create room. Try again.');
      return;
    }
    if (res.token) localStorage.setItem(RESUME_KEY, res.token);
    setRoomCode(res.code);
    setMySlot(res.slot);
    setScreen('lobby');
  };

  const handleJoinRoom = async (codeToJoin = roomCode) => {
    Sound.playClick();
    const cleanCode = String(codeToJoin || '').trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 4) {
      showToast('Please enter a valid 4-character room code.');
      return;
    }

    const res = await emitPromise('room:join', { code: cleanCode, name: callsign });
    if (!res.ok) {
      const errorMessages = {
        ROOM_NOT_FOUND: 'Room not found. Check the code and try again.',
        ROOM_FULL: 'This room already has 2 players.',
        GAME_ALREADY_STARTED: 'That match is already in progress.',
      };
      showToast(errorMessages[res.error] || 'Unable to join room.');
      return;
    }

    if (res.token) localStorage.setItem(RESUME_KEY, res.token);
    setRoomCode(res.code);
    setMySlot(res.slot);
    setScreen('lobby');
  };

  const handleToggleReady = async () => {
    Sound.playClick();
    await emitPromise('player:ready');
  };

  const handleStartGame = async () => {
    Sound.playClick();
    const res = await emitPromise('game:start');
    if (!res.ok) {
      const errs = {
        NEED_TWO_PLAYERS: 'Waiting for a second player to join.',
        BOTH_MUST_BE_READY: 'Both players must click READY before starting.',
        NOT_HOST: 'Only the room host can start the match.',
      };
      showToast(errs[res.error] || 'Unable to start game.');
    }
  };

  const handleRematch = async () => {
    Sound.playClick();
    await emitPromise('game:rematch');
  };

  const handleLeaveRoom = async () => {
    Sound.playClick();
    localStorage.removeItem(RESUME_KEY);
    await emitPromise('room:leave');
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
        socketRef.current?.emit('input:move', { dx, dy });
      }
    }, 45); // ~22Hz dispatch rate

    return () => clearInterval(interval);
  }, [screen, serverState?.game?.status]);

  const handleCaptureAction = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('input:capture', {}, (res) => {
      if (res && !res.ok && res.reason === 'too_far') {
        showToast('Move closer to an energy node to capture!', false);
      }
    });
  }, []);

  const handleDirectionInput = useCallback((dx, dy) => {
    if (!socketRef.current) return;
    socketRef.current.emit('input:move', { dx, dy });
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
            onClick={() => setHowToPlayOpen(true)}
          >
            RULES
          </button>
          <div className="status-pill">
            <span className={`status-dot ${connected ? 'online' : 'connecting'}`} />
            {connected ? 'ONLINE' : 'CONNECTING...'}
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
          onOpenRules={() => setHowToPlayOpen(true)}
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
            const url = `${window.location.origin}${window.location.pathname}?room=${serverState?.roomCode || roomCode}`;
            navigator.clipboard?.writeText(url);
            showToast('Invite link copied to clipboard!', false);
          }}
        />
      )}

      {screen === 'game' && (
        <GameScreen
          gs={gs}
          roomCode={serverState?.roomCode}
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

      {/* How To Play Modal */}
      {howToPlayOpen && (
        <div className="modal-backdrop" onClick={() => setHowToPlayOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>HOW TO PLAY VOLT//SHIFT</h2>
              <button className="close-btn" onClick={() => setHowToPlayOpen(false)}>×</button>
            </div>
            <div className="rules-grid">
              <div className="rule-card">
                <span className="rule-num">1</span>
                <h3>CAPTURE POWER</h3>
                <p>Move onto unstable energy nodes ⚡ and trigger <b>CAPTURE</b> (+10 pts).</p>
              </div>
              <div className="rule-card">
                <span className="rule-num">2</span>
                <h3>ARENA SHIFTS</h3>
                <p>Capturing power creates a shockwave that displaces nearby energy nodes.</p>
              </div>
              <div className="rule-card">
                <span className="rule-num">3</span>
                <h3>STEAL & CONTEST</h3>
                <p>Captured power is vulnerable for 2.5s. Rush in to <b>STEAL</b> it (+10 pts) before it locks!</p>
              </div>
              <div className="rule-card">
                <span className="rule-num">4</span>
                <h3>LOCK & WIN</h3>
                <p>Holding power until it locks awards +5 lock bonus. Most points in 60s wins the round (Best of 3).</p>
              </div>
            </div>
            <div className="controls-guide">
              <h4>CONTROLS</h4>
              <p><b>Desktop:</b> WASD or Arrow Keys to move · Spacebar / E / Click to Capture.</p>
              <p><b>Mobile:</b> Virtual touch joystick / D-pad · Big glowing CAPTURE button.</p>
            </div>
            <button className="primary-btn full-width" onClick={() => setHowToPlayOpen(false)}>
              LET'S BATTLE
            </button>
          </div>
        </div>
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
  onOpenRules,
}) {
  return (
    <main className="screen home-screen">
      <div className="hero-section">
        <div className="hero-badge">FAST-PACED MULTIPLAYER ARENA</div>
        <h1 className="hero-title">
          TWO PLAYERS.<br />
          <span className="neon-text">ONE UNSTABLE ARENA.</span>
        </h1>
        <p className="hero-desc">
          Capture unstable energy nodes, trigger arena shockwaves, intercept rival power, and lock your voltage.
        </p>

        <div className="auth-card">
          <label className="input-label">
            YOUR CALLSIGN
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
                placeholder="ROOM CODE"
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
        </div>

        <div className="home-quick-rules" onClick={onOpenRules}>
          <span>⚡ 60s Round · Best of 3 · Real-time Socket Sync · Desktop & Mobile</span>
          <u>View Game Guide →</u>
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
          <div className="eyebrow">SECTOR READY ROOM</div>
          <h2 className="room-title">ARENA ACCESS CODE</h2>
          <div className="room-code-display" onClick={onCopyLink} title="Click to copy invite link">
            <span className="code-text">{roomCode}</span>
            <button className="copy-badge">📋 COPY LINK</button>
          </div>
          <p className="lobby-hint">Share this code with your opponent to enter the arena.</p>
        </div>

        <div className="players-grid">
          {/* Player 1 Card */}
          <div className={`player-card p1-card ${p1 ? 'active' : 'empty'}`}>
            <div className="player-avatar p1-avatar">
              {p1 ? p1.name.slice(0, 2).toUpperCase() : 'P1'}
            </div>
            <div className="player-info">
              <div className="player-name-row">
                <h3>{p1 ? p1.name : 'WAITING FOR PLAYER 1...'}</h3>
                {mySlot === 'p1' && <span className="you-tag">YOU</span>}
              </div>
              <div className={`ready-status ${p1?.ready ? 'ready' : 'not-ready'}`}>
                {p1 ? (p1.ready ? '● READY' : '○ NOT READY') : 'VACANT'}
              </div>
            </div>
          </div>

          {/* Player 2 Card */}
          <div className={`player-card p2-card ${p2 ? 'active' : 'empty'}`}>
            <div className="player-avatar p2-avatar">
              {p2 ? p2.name.slice(0, 2).toUpperCase() : 'P2'}
            </div>
            <div className="player-info">
              <div className="player-name-row">
                <h3>{p2 ? p2.name : 'WAITING FOR OPPONENT...'}</h3>
                {mySlot === 'p2' && <span className="you-tag">YOU</span>}
              </div>
              <div className={`ready-status ${p2?.ready ? 'ready' : 'not-ready'}`}>
                {p2 ? (p2.ready ? '● READY' : '○ NOT READY') : 'WAITING...'}
              </div>
            </div>
          </div>
        </div>

        <div className="lobby-actions">
          <button
            className={`action-btn ready-btn ${myPlayer?.ready ? 'cancel-ready' : 'confirm-ready'}`}
            onClick={onToggleReady}
          >
            {myPlayer?.ready ? 'CANCEL READY' : 'I AM READY'}
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
                ? 'WAITING FOR ALL READY'
                : 'START MATCH'}
            </button>
          ) : (
            <div className="waiting-host-note">
              Waiting for host to launch the match once both are ready...
            </div>
          )}

          <button className="secondary-btn leave-btn" onClick={onLeaveRoom}>
            LEAVE ROOM
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
  mySlot,
  me,
  opponent,
  otherSlot,
  rematchVotes,
  onDirectionInput,
  onCapture,
  onRematch,
  onLeave,
  floatingTexts,
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
          <h2>INITIALIZING ARENA CONNECTION...</h2>
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
          ⚠️ OPPONENT DISCONNECTED — Waiting for reconnect...
        </div>
      )}

      {/* Match HUD Topbar */}
      <div className="game-hud">
        {/* P1 Score Card */}
        <div className={`hud-player p1-hud ${mySlot === 'p1' ? 'is-me' : ''}`}>
          <div className="hud-player-meta">
            <span className="slot-badge p1-badge">P1</span>
            <span className="hud-callsign">{players?.p1?.name || 'P1'}</span>
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
              <span className="countdown-hud-text">GET READY</span>
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
            ROUND {gs.round} <span className="series-label">(BEST OF 3)</span>
          </div>
        </div>

        {/* P2 Score Card */}
        <div className={`hud-player p2-hud ${mySlot === 'p2' ? 'is-me' : ''}`}>
          <div className="hud-player-meta">
            <span className="slot-badge p2-badge">P2</span>
            <span className="hud-callsign">{players?.p2?.name || 'P2'}</span>
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
          className={`arena-viewport ${gs.arenaShift ? 'arena-pulse-active' : ''}`}
        >
          {/* Animated Grid Lines */}
          <div className="arena-grid-overlay" />

          {/* Energy Nodes */}
          {gs.nodes?.map((node) => {
            const isContested = node.state === 'contested';
            const isLocked = node.state === 'locked';
            const isSudden = node.isSuddenDeath;
            const contestTimeLeft = node.expiresAt
              ? Math.max(0, ((node.expiresAt - now) / 2500) * 100)
              : 0;

            return (
              <div
                key={node.id}
                className={`arena-node node-${node.state} owner-${node.owner || 'none'} ${
                  isSudden ? 'node-sudden-death' : ''
                }`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
              >
                {/* Node Core Icon */}
                <div className="node-core">
                  <span>{isSudden ? '⚡⚡' : isLocked ? '🔒' : '⚡'}</span>
                </div>

                {/* Contested Circular Timer Progress */}
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

          {/* Player Avatars */}
          {['p1', 'p2'].map((slot) => {
            const p = gs.players?.[slot];
            if (!p) return null;
            const isMe = slot === mySlot;
            const playerMeta = players?.[slot];

            return (
              <div
                key={slot}
                className={`player-ship ship-${slot} ${isMe ? 'ship-me' : 'ship-rival'}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div className="ship-model">
                  <div className="ship-aura" />
                  <div className="ship-thruster" />
                </div>
                <div className="ship-label">
                  {isMe ? 'YOU' : playerMeta?.name?.slice(0, 6).toUpperCase() || slot.toUpperCase()}
                </div>
              </div>
            );
          })}

          {/* COUNTDOWN OVERLAY */}
          {isCountdown && (
            <div className="game-overlay countdown-overlay">
              <div className="countdown-box">
                <div className="countdown-big-num">{countdownSeconds}</div>
                <div className="countdown-sub">INITIALIZING ARENA</div>
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
                <p className="overlay-next-note">Preparing next round...</p>
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
                    LEAVE ROOM
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
          ⌨️ Desktop: WASD / Arrows to Move · Spacebar / E to Capture
        </span>
        <span className="room-ref-tag">ROOM: {roomCode}</span>
      </footer>
    </main>
  );
}

// Render root
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
