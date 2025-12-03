(() => {
  const {
    Engine,
    Render,
    Runner,
    World,
    Bodies,
    Events,
    Body,
    Composite,
  } = Matter;

  const GAME_WIDTH = 360;
  const GAME_HEIGHT = 620;

  const LEVELS = [
    {
      name: "Cell",
      radius: 16,
      color: "#63e0ff",
      stroke: "#a9f3ff",
      score: 1,
    },
    {
      name: "Fish",
      radius: 20,
      color: "#4fd28f",
      stroke: "#a3f7c8",
      score: 3,
    },
    {
      name: "Reptile",
      radius: 24,
      color: "#b0e643",
      stroke: "#e9ff9b",
      score: 6,
    },
    {
      name: "Monkey",
      radius: 30,
      color: "#ffb347",
      stroke: "#ffe0aa",
      score: 10,
    },
    {
      name: "Human",
      radius: 34,
      color: "#ff7aa2",
      stroke: "#ffd2e3",
      score: 15,
    },
    {
      name: "Cyborg",
      radius: 40,
      color: "#7a7bff",
      stroke: "#c8c9ff",
      score: 25,
    },
    {
      name: "Superhuman",
      radius: 46,
      color: "#ff6df2",
      stroke: "#ffd5fc",
      score: 40,
    },
    {
      name: "Godlike",
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
    bubble.textContent = lvl.name[0];
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

    if (nextIndex >= LEVELS.length - 1) {
      score += LEVELS[LEVELS.length - 1].score * 3;
      scoreValueEl.textContent = score.toString();
      triggerGodlikeExplosion(midX, midY);
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
    setTimeout(() => {
      screenFlash.classList.remove("flash");
    }, 280);
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
    const highest =
      highestLevelReached >= 0 && highestLevelReached < LEVELS.length
        ? LEVELS[highestLevelReached].name
        : LEVELS[0].name;
    finalHighestEl.textContent = highest;

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
    }, 300);
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
    createEngine();
    setupInput();
    setStateStart();

    playButton.addEventListener("click", () => {
      if (gameState === "start") {
        startGame();
      }
    });

    restartButton.addEventListener("click", () => {
      if (gameState === "gameover") {
        restartGame();
      }
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();


