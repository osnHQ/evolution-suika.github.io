(() => {
  const {
    Engine,
    Render,
    Runner,
    World,
    Bodies,
    Events,
    Composite,
  } = Matter;

  const GAME_WIDTH = 360;
  const GAME_HEIGHT = 620;

  const LEVELS = [
    {
      name: "Cell",
      icon: "🧫",
      radius: 16,
      color: "#63e0ff",
      stroke: "#a9f3ff",
      score: 1,
    },
    {
      name: "Fish",
      icon: "🐟",
      radius: 20,
      color: "#4fd28f",
      stroke: "#a3f7c8",
      score: 3,
    },
    {
      name: "Reptile",
      icon: "🦎",
      radius: 24,
      color: "#b0e643",
      stroke: "#e9ff9b",
      score: 6,
    },
    {
      name: "Monkey",
      icon: "🐒",
      radius: 30,
      color: "#ffb347",
      stroke: "#ffe0aa",
      score: 10,
    },
    {
      name: "Human",
      icon: "🧑",
      radius: 34,
      color: "#ff7aa2",
      stroke: "#ffd2e3",
      score: 15,
    },
    {
      name: "Cyborg",
      icon: "🤖",
      radius: 40,
      color: "#7a7bff",
      stroke: "#c8c9ff",
      score: 25,
    },
    {
      name: "Superhuman",
      icon: "✨",
      radius: 46,
      color: "#ff6df2",
      stroke: "#ffd5fc",
      score: 40,
    },
    {
      name: "Godlike",
      icon: "💫",
      radius: 54,
      color: "#f8f36b",
      stroke: "#fff7c4",
      score: 100,
    },
  ];

  const SPAWN_WEIGHTS_EARLY = [6, 3, 2, 0.5, 0.2, 0, 0, 0];
  const SPAWN_WEIGHTS_LATE = [2, 3, 3, 1.5, 1, 0.5, 0.2, 0];

  const CEILING_Y = 60;

  const startScreen = document.getElementById("start-screen");
  const playButton = document.getElementById("play-button");
  const gameOverScreen = document.getElementById("game-over-screen");
  const restartButton = document.getElementById("restart-button");
  const scoreValueEl = document.getElementById("score-value");
  const finalScoreEl = document.getElementById("final-score");
  const finalHighestEl = document.getElementById("final-highest");
  const finalBestScoreEl = document.getElementById("final-best-score");
  const finalLifetimeHighestEl = document.getElementById("final-lifetime-highest");
  const bestValueEl = document.getElementById("best-value");
  const tutorialOverlay = document.getElementById("tutorial-overlay");
  const tutorialOkButton = document.getElementById("tutorial-ok");
  const soundToggleButton = document.getElementById("sound-toggle");
  const gameContainer = document.getElementById("game-container");
  const nextPreviewEl = document.getElementById("next-preview");
  const dropIndicator = document.getElementById("drop-indicator");
  const screenFlash = document.getElementById("screen-flash");

  let engine;
  let render;
  let runner;

  let currentPieceLevel = 0;
  let nextPieceLevel = 0;
  let score = 0;
  let highestLevelReached = 0;
  let lifetimeHighestLevel = 0;
  let bestScore = 0;
  let isDropping = false;
  let inputActive = false;
  let ghostX = GAME_WIDTH / 2;
  let currentPieceBody = null;

  let gameState = "start";

  const mergeCooldown = new Set();

  let ground;
  let leftWall;
  let rightWall;
  let ceilingSensor;

  const localStorageKey = "evo_suika_progress_v1";

  const settings = {
    soundEnabled: true,
  };

  const particleBursts = [];
  let timeScaleTarget = 1;
  let timeScaleCurrent = 1;
  let shakeTime = 0;
  let shakeIntensity = 0;

  let audioContext = null;

  function loadProgress() {
    try {
      const raw = localStorage.getItem(localStorageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bestScore === "number") bestScore = data.bestScore;
      if (typeof data.lifetimeHighestLevel === "number") {
        lifetimeHighestLevel = data.lifetimeHighestLevel;
      }
      if (typeof data.soundEnabled === "boolean") {
        settings.soundEnabled = data.soundEnabled;
      }
    } catch {
      // ignore parse errors
    }
  }

  function saveProgress() {
    try {
      const data = {
        bestScore,
        lifetimeHighestLevel,
        soundEnabled: settings.soundEnabled,
      };
      localStorage.setItem(localStorageKey, JSON.stringify(data));
    } catch {
      // ignore write errors
    }
  }

  function updateBestUI() {
    bestValueEl.textContent = bestScore.toString();
  }

  function ensureAudioContext() {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioContext = null;
    }
  }

  function playTone(frequency, duration, type = "sine", gain = 0.15) {
    if (!settings.soundEnabled) return;
    ensureAudioContext();
    if (!audioContext) return;

    const ctx = audioContext;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.value = frequency;
    gainNode.gain.value = gain;

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.start(now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.stop(now + duration + 0.02);
  }

  const Sound = {
    drop() {
      playTone(420, 0.1, "triangle", 0.08);
    },
    merge(levelIndex) {
      const baseFreq = 320;
      const freq = baseFreq + levelIndex * 55;
      playTone(freq, 0.12, "sine", 0.12);
    },
    godlike() {
      playTone(880, 0.25, "sawtooth", 0.18);
      setTimeout(() => playTone(220, 0.35, "sine", 0.12), 40);
    },
    uiClick() {
      playTone(600, 0.07, "square", 0.08);
    },
  };

  function createEngine() {
    engine = Engine.create({
      gravity: { x: 0, y: 1 },
    });

    render = Render.create({
      element: gameContainer,
      engine,
      options: {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        wireframes: false,
        background: "transparent",
      },
    });

    runner = Runner.create();

    const wallThickness = 40;
    const floorY = GAME_HEIGHT - 20;

    ground = Bodies.rectangle(
      GAME_WIDTH / 2,
      floorY,
      GAME_WIDTH + wallThickness * 2,
      wallThickness,
      {
        isStatic: true,
        friction: 0.4,
        restitution: 0.2,
        render: { visible: false },
      }
    );

    leftWall = Bodies.rectangle(
      -wallThickness / 2,
      GAME_HEIGHT / 2,
      wallThickness,
      GAME_HEIGHT,
      {
        isStatic: true,
        render: { visible: false },
      }
    );

    rightWall = Bodies.rectangle(
      GAME_WIDTH + wallThickness / 2,
      GAME_HEIGHT / 2,
      wallThickness,
      GAME_HEIGHT,
      {
        isStatic: true,
        render: { visible: false },
      }
    );

    ceilingSensor = Bodies.rectangle(
      GAME_WIDTH / 2,
      CEILING_Y,
      GAME_WIDTH,
      10,
      {
        isStatic: true,
        isSensor: true,
        render: { visible: false },
        label: "ceiling-sensor",
      }
    );

    World.add(engine.world, [ground, leftWall, rightWall, ceilingSensor]);

    setupCollisionHandlers();

    Events.on(engine, "beforeUpdate", () => {
      timeScaleCurrent += (timeScaleTarget - timeScaleCurrent) * 0.15;
      engine.timing.timeScale = timeScaleCurrent;

      if (shakeTime > 0) {
        shakeTime -= engine.timing.delta;
        if (shakeTime < 0) {
          shakeTime = 0;
          if (render && render.canvas) {
            render.canvas.style.transform = "";
          }
        } else if (render && render.canvas) {
          const intensity = (shakeTime / 200) * shakeIntensity;
          const dx = (Math.random() - 0.5) * intensity;
          const dy = (Math.random() - 0.5) * intensity;
          render.canvas.style.transform = `translate(${dx}px, ${dy}px)`;
        }
      }
    });

    Events.on(render, "afterRender", () => {
      drawCreatureIcons(render);
      drawParticles(render);
    });

    Render.run(render);
    Runner.run(runner, engine);
  }

  function resetWorld() {
    if (!engine) return;
    const allBodies = Composite.allBodies(engine.world);
    for (const body of allBodies) {
      if (!body.isStatic) {
        World.remove(engine.world, body);
      }
    }
    World.add(engine.world, [ground, leftWall, rightWall, ceilingSensor]);
  }

  function weightedRandomLevel() {
    const effectiveScore = score;
    const weights = effectiveScore > 800 ? SPAWN_WEIGHTS_LATE : SPAWN_WEIGHTS_EARLY;
    let total = 0;
    for (let i = 0; i < LEVELS.length - 1; i++) {
      total += weights[i];
    }
    const r = Math.random() * total;
    let acc = 0;
    for (let i = 0; i < LEVELS.length - 1; i++) {
      acc += weights[i];
      if (r <= acc) return i;
    }
    return 0;
  }

  function updateNextPreview() {
    nextPreviewEl.innerHTML = "";
    const lvl = LEVELS[nextPieceLevel];
    const bubble = document.createElement("div");
    bubble.className = "next-bubble";
    bubble.style.background = `radial-gradient(circle at 30% 20%, rgba(255,255,255,0.35), transparent 55%), ${lvl.color}`;
    bubble.style.boxShadow = `0 0 8px ${lvl.color}`;
    const span = document.createElement("div");
    span.className = "creature-icon-preview";
    span.textContent = lvl.icon;
    bubble.appendChild(span);
    nextPreviewEl.appendChild(bubble);
  }

  function spawnNewPieceAtTop() {
    currentPieceLevel = nextPieceLevel;
    nextPieceLevel = weightedRandomLevel();
    updateNextPreview();

    const lvl = LEVELS[currentPieceLevel];
    const x = Math.min(
      Math.max(ghostX, lvl.radius + 6),
      GAME_WIDTH - lvl.radius - 6
    );
    const y = CEILING_Y - 20;

    const body = Bodies.circle(x, y, lvl.radius, {
      restitution: 0.35,
      friction: 0.01,
      frictionAir: 0.002,
      label: "piece",
      render: {
        fillStyle: lvl.color,
        strokeStyle: lvl.stroke,
        lineWidth: 3,
      },
    });
    body.plugin = body.plugin || {};
    body.plugin.levelIndex = currentPieceLevel;
    body.plugin.justSpawned = true;

    World.add(engine.world, body);
    currentPieceBody = body;
    isDropping = true;

    Sound.drop();

    setTimeout(() => {
      if (body.plugin) body.plugin.justSpawned = false;
    }, 300);
  }

  function handleMerge(bodyA, bodyB) {
    const lvlIndex = bodyA.plugin.levelIndex;
    const nextIndex = lvlIndex + 1;
    const midX = (bodyA.position.x + bodyB.position.x) / 2;
    const midY = (bodyA.position.y + bodyB.position.y) / 2;

    const keyA = bodyA.id;
    const keyB = bodyB.id;
    if (mergeCooldown.has(keyA) || mergeCooldown.has(keyB)) {
      return;
    }
    mergeCooldown.add(keyA);
    mergeCooldown.add(keyB);
    setTimeout(() => {
      mergeCooldown.delete(keyA);
      mergeCooldown.delete(keyB);
    }, 150);

    World.remove(engine.world, bodyA);
    World.remove(engine.world, bodyB);

    const baseScore = LEVELS[nextIndex] ? LEVELS[nextIndex].score : LEVELS[lvlIndex].score;
    score += baseScore;
    scoreValueEl.textContent = score.toString();

    highestLevelReached = Math.max(highestLevelReached, nextIndex);
    lifetimeHighestLevel = Math.max(lifetimeHighestLevel, highestLevelReached);

    if (nextIndex >= LEVELS.length - 1) {
      score += LEVELS[LEVELS.length - 1].score * 3;
      scoreValueEl.textContent = score.toString();
      triggerGodlikeExplosion(midX, midY);
      Sound.godlike();
      return;
    }

    const lvl = LEVELS[nextIndex];
    const merged = Bodies.circle(midX, midY, lvl.radius, {
      restitution: 0.35,
      friction: 0.01,
      frictionAir: 0.002,
      label: "piece",
      render: {
        fillStyle: lvl.color,
        strokeStyle: lvl.stroke,
        lineWidth: 3,
      },
    });
    merged.plugin = merged.plugin || {};
    merged.plugin.levelIndex = nextIndex;

    World.add(engine.world, merged);

    triggerMergeGlow();
    triggerMergeBurst(midX, midY, nextIndex);
    Sound.merge(nextIndex);
  }

  function triggerMergeGlow() {
    if (!render || !render.canvas) return;
    const canvas = render.canvas;
    canvas.classList.add("bubble-glow");
    setTimeout(() => {
      canvas.classList.remove("bubble-glow");
    }, 120);
  }

  function triggerGodlikeExplosion() {
    screenFlash.classList.add("flash");
    timeScaleTarget = 0.4;
    shakeTime = 200;
    shakeIntensity = 6;
    setTimeout(() => {
      screenFlash.classList.remove("flash");
      timeScaleTarget = 1;
    }, 280);
  }

  function triggerMergeBurst(x, y, levelIndex) {
    const count = 12 + levelIndex * 2;
    const color = LEVELS[levelIndex]?.color || "#ffffff";
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 1.2 + Math.random() * 1.5;
      particleBursts.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 450,
        maxLife: 450,
        color,
      });
    }
  }

  function drawParticles(renderInstance) {
    const ctx = renderInstance.context;
    const dt = engine.timing.delta || 16.67;
    for (let i = particleBursts.length - 1; i >= 0; i--) {
      const p = particleBursts[i];
      p.life -= dt;
      if (p.life <= 0) {
        particleBursts.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02;

      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      const radius = 3 + alpha * 4;
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(1, p.color);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCreatureIcons(renderInstance) {
    const ctx = renderInstance.context;
    const bodies = Composite.allBodies(engine.world);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const body of bodies) {
      if (body.label !== "piece" || !body.plugin) continue;
      const levelIndex = body.plugin.levelIndex;
      if (typeof levelIndex !== "number" || levelIndex < 0 || levelIndex >= LEVELS.length) {
        continue;
      }
      const lvl = LEVELS[levelIndex];
      const { x, y } = body.position;

      const auraRadius = lvl.radius + 4 + levelIndex * 1.2;
      const gradient = ctx.createRadialGradient(
        x - lvl.radius * 0.4,
        y - lvl.radius * 0.4,
        0,
        x,
        y,
        auraRadius
      );
      gradient.addColorStop(0, "rgba(255,255,255,0.35)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, auraRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = lvl.color;
      ctx.strokeStyle = lvl.stroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, lvl.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const fontSize = Math.max(16, lvl.radius);
      ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif`;
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(lvl.icon, x, y - 1);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function setupCollisionHandlers() {
    Events.on(engine, "collisionStart", (event) => {
      const pairs = event.pairs;
      for (const pair of pairs) {
        const { bodyA, bodyB } = pair;

        if (bodyA === ceilingSensor || bodyB === ceilingSensor) {
          const other = bodyA === ceilingSensor ? bodyB : bodyA;
          if (other.label === "piece") {
            if (!other.plugin || other.plugin.justSpawned) continue;
            triggerGameOver();
          }
          continue;
        }

        if (bodyA.label === "piece" && bodyB.label === "piece") {
          const levelA = bodyA.plugin?.levelIndex;
          const levelB = bodyB.plugin?.levelIndex;
          if (
            typeof levelA === "number" &&
            levelA === levelB &&
            levelA >= 0 &&
            levelA < LEVELS.length
          ) {
            handleMerge(bodyA, bodyB);
          }
        }
      }
    });
  }

  function triggerGameOver() {
    if (gameState !== "playing") return;
    gameState = "gameover";
    inputActive = false;
    isDropping = false;
    currentPieceBody = null;
    dropIndicator.classList.remove("visible");

    finalScoreEl.textContent = score.toString();

    if (score > bestScore) {
      bestScore = score;
    }
    lifetimeHighestLevel = Math.max(lifetimeHighestLevel, highestLevelReached);
    saveProgress();
    updateBestUI();

    const highestThisRun =
      highestLevelReached >= 0 && highestLevelReached < LEVELS.length
        ? LEVELS[highestLevelReached].name
        : LEVELS[0].name;
    finalHighestEl.textContent = highestThisRun;

    finalBestScoreEl.textContent = bestScore.toString();
    const lifetimeName =
      lifetimeHighestLevel >= 0 && lifetimeHighestLevel < LEVELS.length
        ? LEVELS[lifetimeHighestLevel].name
        : LEVELS[0].name;
    finalLifetimeHighestEl.textContent = lifetimeName;

    gameOverScreen.classList.add("visible");
  }

  function updateGhostPositionFromClientX(clientX) {
    const rect = gameContainer.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const clamped = Math.max(20, Math.min(GAME_WIDTH - 20, (relativeX / rect.width) * GAME_WIDTH));
    ghostX = clamped;
    dropIndicator.style.left = `${(clamped / GAME_WIDTH) * 100}%`;
    if (!dropIndicator.classList.contains("visible")) {
      dropIndicator.classList.add("visible");
    }
  }

  function releaseCurrentPiece() {
    if (!currentPieceBody || !isDropping) return;
    isDropping = false;
    inputActive = false;

    setTimeout(() => {
      if (gameState === "playing") {
        inputActive = true;
        spawnNewPieceAtTop();
      }
    }, 280);
  }

  function setupInput() {
    let pointerDown = false;

    const handlePointerDown = (clientX) => {
      if (gameState !== "playing" || !inputActive) return;
      pointerDown = true;
      updateGhostPositionFromClientX(clientX);
    };

    const handlePointerMove = (clientX) => {
      if (!pointerDown || gameState !== "playing" || !inputActive) return;
      updateGhostPositionFromClientX(clientX);
    };

    const handlePointerUp = () => {
      if (!pointerDown || gameState !== "playing") return;
      pointerDown = false;
      releaseCurrentPiece();
      dropIndicator.classList.remove("visible");
    };

    gameContainer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handlePointerDown(e.clientX);
    });
    window.addEventListener("mousemove", (e) => {
      handlePointerMove(e.clientX);
    });
    window.addEventListener("mouseup", () => {
      handlePointerUp();
    });

    gameContainer.addEventListener(
      "touchstart",
      (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        handlePointerDown(touch.clientX);
      },
      { passive: true }
    );

    window.addEventListener(
      "touchmove",
      (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        handlePointerMove(touch.clientX);
      },
      { passive: true }
    );

    window.addEventListener(
      "touchend",
      () => {
        handlePointerUp();
      },
      { passive: true }
    );
  }

  function setStateStart() {
    gameState = "start";
    score = 0;
    highestLevelReached = 0;
    scoreValueEl.textContent = "0";
    startScreen.classList.add("visible");
    gameOverScreen.classList.remove("visible");
  }

  function startGame() {
    resetWorld();
    score = 0;
    highestLevelReached = 0;
    scoreValueEl.textContent = "0";
    currentPieceBody = null;
    isDropping = false;
    inputActive = true;
    mergeCooldown.clear();

    currentPieceLevel = weightedRandomLevel();
    nextPieceLevel = weightedRandomLevel();
    updateNextPreview();

    gameState = "playing";
    startScreen.classList.remove("visible");
    gameOverScreen.classList.remove("visible");

    ghostX = GAME_WIDTH / 2;
    dropIndicator.style.left = "50%";
    spawnNewPieceAtTop();
  }

  function restartGame() {
    startGame();
  }

  function init() {
    loadProgress();
    updateBestUI();
    createEngine();
    setupInput();
    setStateStart();

    if (!localStorage.getItem(`${localStorageKey}_seen_tutorial`)) {
      tutorialOverlay.classList.add("visible");
    }

    soundToggleButton.textContent = settings.soundEnabled ? "🔊" : "🔈";

    playButton.addEventListener("click", () => {
      if (gameState === "start") {
        Sound.uiClick();
        startGame();
      }
    });

    restartButton.addEventListener("click", () => {
      if (gameState === "gameover") {
        Sound.uiClick();
        restartGame();
      }
    });

    tutorialOkButton.addEventListener("click", () => {
      tutorialOverlay.classList.remove("visible");
      localStorage.setItem(`${localStorageKey}_seen_tutorial`, "1");
      Sound.uiClick();
    });

    soundToggleButton.addEventListener("click", () => {
      settings.soundEnabled = !settings.soundEnabled;
      soundToggleButton.textContent = settings.soundEnabled ? "🔊" : "🔈";
      saveProgress();
      Sound.uiClick();
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();


