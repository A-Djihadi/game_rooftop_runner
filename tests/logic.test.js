// Tests de la logique pure du Rooftop Runner (aucune dépendance).
// Exécution : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG,
  STORAGE_KEY,
  aabbCollide,
  speedAt,
  jumpReach,
  maxJumpHeight,
  generateRooftop,
  generateObstacle,
  updateHighscore,
  Game,
} from '../public/logic.js';

// PRNG déterministe (mulberry32) pour des générations reproductibles en test.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('aabbCollide détecte un chevauchement et ignore les bords qui se touchent', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const overlapping = { x: 5, y: 5, w: 10, h: 10 };
  assert.equal(aabbCollide(a, overlapping), true);

  const apart = { x: 20, y: 0, w: 10, h: 10 };
  assert.equal(aabbCollide(a, apart), false);

  // Contact exact sur une arête : pas de collision (strictement disjoint).
  const touching = { x: 10, y: 0, w: 10, h: 10 };
  assert.equal(aabbCollide(a, touching), false);
});

test('speedAt augmente avec la distance puis est plafonné à maxSpeed', () => {
  assert.equal(speedAt(0), CONFIG.baseSpeed);
  assert.ok(speedAt(10000) > CONFIG.baseSpeed);
  assert.equal(speedAt(1e9), CONFIG.maxSpeed);
});

test('jumpReach augmente avec la vitesse (portée de saut croissante)', () => {
  const low = jumpReach(CONFIG.baseSpeed);
  const high = jumpReach(CONFIG.maxSpeed);
  assert.ok(high > low);
});

test('les obstacles et les trous restent franchissables par conception', () => {
  assert.ok(CONFIG.maxObstacleHeight < maxJumpHeight(CONFIG));
  assert.ok(CONFIG.maxGapRatio < 1, 'marge de sécurité sur la portée de saut');
});

test('generateRooftop ne crée jamais de trou infranchissable (gap toujours borné)', () => {
  const rng = mulberry32(42);
  let endX = 0;
  for (let i = 0; i < 500; i++) {
    // La vitesse balaye tout le spectre baseSpeed → maxSpeed.
    const speed = CONFIG.baseSpeed + (CONFIG.maxSpeed - CONFIG.baseSpeed) * (i / 499);
    const roof = generateRooftop(rng, endX, speed, CONFIG);
    const gap = roof.x - endX;
    const maxGap = CONFIG.maxGapRatio * jumpReach(speed, CONFIG);

    assert.ok(gap >= CONFIG.minGap - 1e-9, `gap ${gap} < minGap`);
    assert.ok(gap <= maxGap + 1e-9, `gap ${gap} > maxGap ${maxGap} (speed ${speed})`);
    assert.ok(roof.w >= CONFIG.minRoofWidth && roof.w <= CONFIG.maxRoofWidth);

    endX = roof.x + roof.w;
  }
});

test('generateObstacle reste posé sur son toit (marges respectées)', () => {
  const rng = mulberry32(7);
  const roof = { x: 100, w: 400 };
  for (let i = 0; i < 200; i++) {
    const o = generateObstacle(rng, roof, CONFIG);
    assert.ok(o.x >= roof.x + CONFIG.obstacleEdgeMargin);
    assert.ok(o.x + o.w <= roof.x + roof.w - CONFIG.obstacleEdgeMargin);
    assert.ok(o.h >= CONFIG.minObstacleHeight && o.h <= CONFIG.maxObstacleHeight);
  }
});

test('updateHighscore met à jour le meilleur score et signale un nouveau record', () => {
  assert.deepEqual(updateHighscore(0, 120), { best: 120, isNew: true });
  assert.deepEqual(updateHighscore(120, 90), { best: 120, isNew: false });
  assert.deepEqual(updateHighscore(120, 150), { best: 150, isNew: true });
});

test('la clé de stockage respecte le préfixe odg.game_rooftop_runner', () => {
  assert.ok(STORAGE_KEY.startsWith('odg.game_rooftop_runner.'));
});

test('le saut fait monter le stickman puis il retombe au sol (grounded)', () => {
  const g = new Game({ groundY: 400, screenWidth: 800 });
  g.start();
  assert.equal(g.state, 'playing');
  assert.equal(g.player.grounded, true);

  const groundTop = g.groundY - g.cfg.playerH;
  g.jump();
  assert.equal(g.player.grounded, false);

  let rose = false;
  let landed = false;
  for (let i = 0; i < 300; i++) {
    g.update(1 / 60);
    if (g.player.y < groundTop - 10) rose = true;
    if (g.player.grounded) {
      landed = true;
      break;
    }
  }
  assert.equal(rose, true, 'le joueur doit s’être élevé au-dessus du sol');
  assert.equal(landed, true, 'le joueur doit être retombé au sol');
  assert.equal(g.player.y, groundTop);
});

test('tomber dans un trou déclenche le game over (cause « fall »)', () => {
  const g = new Game({ groundY: 400, screenWidth: 800 });
  g.state = 'playing';
  // Un seul toit court sous le joueur : en courant il finit par en sortir.
  g.rooftops = [{ x: 0, w: 150 }];
  g.obstacles = [];
  g.player.x = 120;
  g.player.y = 400 - g.cfg.playerH;
  g.player.vy = 0;
  g.player.grounded = true;

  for (let i = 0; i < 400 && g.state === 'playing'; i++) {
    g.update(1 / 60);
  }
  assert.equal(g.state, 'gameover');
  assert.equal(g.deathCause, 'fall');
});

test('heurter un obstacle déclenche le game over (cause « obstacle »)', () => {
  const g = new Game({ groundY: 400, screenWidth: 800 });
  g.state = 'playing';
  g.rooftops = [{ x: 0, w: 1000 }];
  g.obstacles = [{ x: g.player.x + g.player.w + 5, y: 400 - 40, w: 26, h: 40 }];
  g.player.x = 120;
  g.player.y = 400 - g.cfg.playerH;
  g.player.vy = 0;
  g.player.grounded = true;

  for (let i = 0; i < 400 && g.state === 'playing'; i++) {
    g.update(1 / 60);
  }
  assert.equal(g.state, 'gameover');
  assert.equal(g.deathCause, 'obstacle');
});

test('setViewport recadre le joueur au niveau des toits après un resize', () => {
  const g = new Game({ screenWidth: 800 }); // groundY calculé (non figé)
  const before = g.groundY;
  g.setViewport(400, 800);
  assert.notEqual(g.groundY, before, 'le niveau des toits doit suivre la hauteur');
  assert.equal(g.player.y, g.groundY - g.cfg.playerH);
  assert.equal(g.player.grounded, true);
});

test('la distance s’accumule et la vitesse augmente pendant la course', () => {
  const g = new Game({ groundY: 400, screenWidth: 800 });
  g.start();
  const initialSpeed = g.speed;
  for (let i = 0; i < 60 && g.state === 'playing'; i++) {
    g.update(1 / 60);
  }
  assert.ok(g.distance > 0, 'la distance doit progresser');
  assert.ok(g.speed > initialSpeed, 'la vitesse doit augmenter avec la distance');
  assert.ok(g.score() > 0, 'le score (distance) doit progresser');
});
