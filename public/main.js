// Rooftop Runner — point d'entrée : canvas, boucle requestAnimationFrame,
// entrées (clavier / souris / tactile), rendu et écrans (menu / jeu / game over).
// Toute la logique pure vit dans logic.js ; ce fichier ne fait que l'orchestrer
// et dessiner (aucune dépendance, aucun appel réseau, aucun traceur).

import {
  Game,
  STORAGE_KEY,
  updateHighscore,
} from './logic.js';

// --- PRNG déterministe (mulberry32) pour un décor reproductible. ---
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

// --- Références DOM. ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const hudScore = document.getElementById('hud-score');
const hudBest = document.getElementById('hud-best');
const menuScreen = document.getElementById('menu-screen');
const menuBest = document.getElementById('menu-best');
const gameoverScreen = document.getElementById('gameover-screen');
const gameoverScore = document.getElementById('gameover-score');
const gameoverBest = document.getElementById('gameover-best');
const gameoverCause = document.getElementById('gameover-cause');
const newRecord = document.getElementById('new-record');

// --- État d'affichage. ---
let viewW = window.innerWidth;
let viewH = window.innerHeight;
let farSkyline = null;   // immeubles lointains (parallaxe lente)
let nearSkyline = null;  // immeubles proches (parallaxe rapide)
let stars = [];          // étoiles fixes du ciel
let moon = { x: 0, y: 0 };

// --- Jeu et meilleur score. ---
const game = new Game({ rng: Math.random });
let best = readBest();
let gameoverAt = 0; // horodatage du game over (évite un rejeu accidentel immédiat)

// --- Lecture / écriture du meilleur score (localStorage, préfixé). ---
function readBest() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? 0 : parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  } catch {
    return 0; // stockage indisponible (navigation privée, etc.)
  }
}

function writeBest(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // sans effet : le score reste en mémoire pour la session.
  }
}

// --- Décor procédural. ---
function buildSkyline(rngSeed, minH, maxH, width) {
  const rng = mulberry32(rngSeed);
  const span = width + 400;
  const buildings = [];
  let x = 0;
  while (x < span) {
    let w = 40 + rng() * 90;
    if (x + w > span) w = span - x; // dernière colonne ajustée : pas de débordement ni de trou
    const h = minH + rng() * (maxH - minH);
    buildings.push({ x, w, h });
    x += w + 6 + rng() * 26;
  }
  return { buildings, span };
}

function buildStars(rngSeed, width, height) {
  const rng = mulberry32(rngSeed);
  const list = [];
  const count = Math.round((width * height) / 22000);
  for (let i = 0; i < count; i++) {
    list.push({ x: rng() * width, y: rng() * height * 0.5, r: 0.6 + rng() * 1.4 });
  }
  return list;
}

function rebuildDecor() {
  farSkyline = buildSkyline(11, 40, 150, viewW + 400);
  nearSkyline = buildSkyline(23, 70, 230, viewW + 400);
  stars = buildStars(37, viewW, viewH);
  moon = { x: viewW * 0.82, y: viewH * 0.16 };
}

// --- Redimensionnement (devicePixelRatio). ---
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // plafonné pour la perf mobile
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.setViewport(viewW, viewH);
  rebuildDecor();
}

// --- Rendu. ---
function drawSky(ctx, t) {
  // Ciel neutre, très sombre : pas de dégradé néon, on reste dans la palette du hub.
  const g = ctx.createLinearGradient(0, 0, 0, viewH);
  g.addColorStop(0, '#05060a');
  g.addColorStop(0.7, '#080b12');
  g.addColorStop(1, '#0c1018');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);

  // Lune (disque procédural, monochrome).
  const glow = ctx.createRadialGradient(moon.x, moon.y, 4, moon.x, moon.y, 54);
  glow.addColorStop(0, 'rgba(242, 242, 242, 0.8)');
  glow.addColorStop(0.4, 'rgba(242, 242, 242, 0.22)');
  glow.addColorStop(1, 'rgba(242, 242, 242, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(moon.x - 54, moon.y - 54, 108, 108);
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9cdd4';
  ctx.beginPath();
  ctx.arc(moon.x - 6, moon.y - 4, 4, 0, Math.PI * 2);
  ctx.arc(moon.x + 5, moon.y + 6, 3, 0, Math.PI * 2);
  ctx.fill();

  // Étoiles (scintillement léger).
  ctx.fillStyle = 'rgba(242, 242, 242, 0.8)';
  for (const s of stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(t * 0.002 + s.x);
    ctx.globalAlpha = 0.3 + 0.5 * twinkle;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSkyline(skyline, offset, color) {
  const span = skyline.span;
  const off = ((offset % span) + span) % span;
  const baseY = color.baseY;
  ctx.fillStyle = color.fill;
  for (const b of skyline.buildings) {
    const bx = b.x - off;
    for (const dx of [bx, bx + span, bx - span]) {
      if (dx + b.w > 0 && dx < viewW) {
        const top = baseY - b.h;
        ctx.fillRect(dx, top, b.w, viewH - top);
      }
    }
  }
}

function drawRoofs() {
  const groundY = game.groundY;
  const thickness = Math.max(28, viewH * 0.06);
  for (const r of game.rooftops) {
    const x = r.x;
    const w = r.w;
    if (x + w < 0 || x > viewW) continue;
    ctx.fillStyle = '#161a24';
    ctx.fillRect(x, groundY, w, thickness);
    // Liseré fin du toit (accent gameplay cyan, sans halo néon).
    ctx.strokeStyle = '#4bd5ee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, groundY + 0.5);
    ctx.lineTo(x + w, groundY + 0.5);
    ctx.stroke();
  }
}

function drawObstacles() {
  for (const o of game.obstacles) {
    if (o.x + o.w < 0 || o.x > viewW) continue;
    ctx.fillStyle = '#201a08';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = '#FFE81F';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    ctx.strokeStyle = 'rgba(255, 232, 31, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x + 4, o.y + 4);
    ctx.lineTo(o.x + o.w - 4, o.y + o.h - 4);
    ctx.moveTo(o.x + o.w - 4, o.y + 4);
    ctx.lineTo(o.x + 4, o.y + o.h - 4);
    ctx.stroke();
  }
}

function drawRunner(t) {
  const p = game.player;
  const x = p.x;
  const y = p.y;
  const w = p.w;
  const h = p.h;
  const cx = x + w / 2;
  const headR = w * 0.3;
  const headY = y + headR;
  const neckY = y + headR * 2;
  const hipY = y + h * 0.52;
  const footY = y + h;
  const airborne = !p.grounded;

  // Phase de course basée sur la distance ; posé statique au menu.
  const phase = airborne ? 0 : game.distance * 0.09 + (game.state === 'menu' ? t * 0.003 : 0);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f2f2f2';
  ctx.fillStyle = '#f2f2f2';
  ctx.lineWidth = Math.max(2, w * 0.13);

  // Tête.
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  // Torse.
  ctx.beginPath();
  ctx.moveTo(cx, neckY);
  ctx.lineTo(cx, hipY);
  ctx.stroke();

  // Bras.
  const armSwing = airborne ? 0.6 : Math.sin(phase) * 0.7;
  const armLen = h * 0.28;
  const shoulderY = neckY + h * 0.1;
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx + armLen * Math.sin(armSwing), shoulderY + armLen * Math.cos(armSwing));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY);
  ctx.lineTo(cx - armLen * Math.sin(armSwing), shoulderY + armLen * Math.cos(armSwing));
  ctx.stroke();

  // Jambes.
  if (airborne) {
    ctx.beginPath();
    ctx.moveTo(cx, hipY);
    ctx.lineTo(cx + w * 0.38, hipY + (footY - hipY) * 0.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, hipY);
    ctx.lineTo(cx - w * 0.2, hipY + (footY - hipY) * 0.9);
    ctx.stroke();
  } else {
    const legLen = footY - hipY;
    const s1 = Math.sin(phase) * legLen * 0.82;
    const s2 = Math.sin(phase + Math.PI) * legLen * 0.82;
    ctx.beginPath();
    ctx.moveTo(cx, hipY);
    ctx.lineTo(cx + s1, footY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, hipY);
    ctx.lineTo(cx + s2, footY);
    ctx.stroke();
  }
}

function render(t) {
  drawSky(ctx, t);

  // Parallaxe : lointain (lent) puis proche (rapide).
  const farOffset = game.distance * 0.25;
  const nearOffset = game.distance * 0.55;
  drawSkyline(farSkyline, farOffset, { baseY: game.groundY + 60, fill: '#0b0e14' });
  drawSkyline(nearSkyline, nearOffset, { baseY: game.groundY + 18, fill: '#12161f' });

  drawRoofs();
  drawObstacles();
  drawRunner(t);
}

// --- Boucle de jeu. ---
let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const prevState = game.state;
  game.update(dt);

  if (game.state === 'playing') {
    hudScore.textContent = game.score();
  }
  if (game.state === 'gameover' && prevState === 'playing') {
    onGameOver();
  }

  render(now);
  requestAnimationFrame(frame);
}

// --- Transitions d'écran. ---
function startGame() {
  game.start();
  menuScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  hudBest.textContent = 'Record : ' + best;
}

function onGameOver() {
  const score = game.score();
  const r = updateHighscore(best, score);
  best = r.best;
  writeBest(best);

  gameoverScore.textContent = score;
  gameoverBest.textContent = 'Record : ' + best;
  menuBest.textContent = 'Record : ' + best;
  newRecord.classList.toggle('hidden', !r.isNew);
  gameoverCause.textContent =
    game.deathCause === 'fall'
      ? 'Vous êtes tombé dans le vide.'
      : 'Vous avez percuté un obstacle.';

  hud.classList.add('hidden');
  gameoverScreen.classList.remove('hidden');
  gameoverAt = performance.now();
}

// --- Entrées (clavier / souris / tactile). ---
function onPress() {
  if (game.state === 'menu') {
    startGame();
    return;
  }
  if (game.state === 'gameover') {
    // Petit délai pour ne pas relancer sur l'appui qui vient de mourir.
    if (performance.now() - gameoverAt < 300) return;
    startGame();
    return;
  }
  game.jump();
}

function onRelease() {
  game.releaseJump();
}

function onKeyDown(e) {
  // Évite le défilement de la page avec Espace / flèches.
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) onPress();
  } else if (e.code === 'Enter') {
    e.preventDefault();
    if (game.state === 'menu' || game.state === 'gameover') onPress();
  }
}

function onKeyUp(e) {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    onRelease();
  }
}

// --- Initialisation. ---
function init() {
  resize();
  menuBest.textContent = 'Record : ' + best;

  // Poignée de débogage / QA : permet d'inspecter l'état du jeu dans la console.
  window.__game = game;

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  // Souris + tactile : pointerdown/up couvre les deux.
  const shell = document.getElementById('game-shell');
  shell.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onPress();
  });
  window.addEventListener('pointerup', onRelease);
  window.addEventListener('pointercancel', onRelease);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  requestAnimationFrame(frame);
}

init();
