// Logique pure du Rooftop Runner — aucune dépendance au DOM ni au rendu.
// Exposée en ESM pour être testée par `node --test` et consommée par main.js.

// Constantes de gameplay. Les commentaires sont en français ; les identifiants
// et clés en anglais.
export const CONFIG = {
  // Physique du saut (pixels et secondes).
  gravity: 2600,        // accélération de la gravité (px/s²)
  jumpVelocity: 940,    // vitesse verticale initiale au saut (px/s, vers le haut)
  jumpCutFactor: 0.45,  // saut variable : coupe la montée au relâchement de l'appui
  maxDt: 0.05,          // pas de temps maximal (anti-tunneling)
  // Vitesse horizontale.
  baseSpeed: 330,       // vitesse initiale (px/s)
  maxSpeed: 900,        // vitesse plafonnée (px/s)
  speedAccel: 0.035,    // accélération par unité de distance (px/s par px parcouru)
  // Joueur (stickman).
  playerX: 120,         // position horizontale fixe à l'écran (px)
  playerW: 34,
  playerH: 62,
  groundRatio: 0.66,    // niveau des toits en fraction de la hauteur d'écran
  fallDeathOffset: 2.2, // profondeur de chute fatale, en multiples de la hauteur du joueur
  // Toits (plateformes).
  startRoofWidth: 420,  // largeur du premier toit (sous le point de départ)
  minGap: 36,           // largeur minimale d'un trou
  maxGapRatio: 0.7,     // trou maximal = 70 % de la portée de saut (jamais infranchissable)
  minRoofWidth: 200,
  maxRoofWidth: 470,
  // Obstacles.
  obstacleWidth: 26,
  minObstacleHeight: 26,
  maxObstacleHeight: 50,
  obstacleEdgeMargin: 34, // marge intérieure pour poser l'obstacle sur le toit
  obstacleChance: 0.34,   // probabilité qu'un toit porte un obstacle
  // Génération / rendu.
  generateBuffer: 700,    // distance de génération au-delà du bord droit
  scoreDivisor: 10,       // score = distance / 10 (mètres)
  screenWidth: 800,
};

// Clé de sauvegarde du meilleur score (préfixe imposé).
export const STORAGE_KEY = 'odg.game_rooftop_runner.highscore';

// Collision AABB stricte : des bords qui se touchent exactement ne comptent pas.
export function aabbCollide(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// Vitesse courante en fonction de la distance parcourue (croissante, plafonnée).
export function speedAt(distance, cfg = CONFIG) {
  return Math.min(cfg.maxSpeed, cfg.baseSpeed + distance * cfg.speedAccel);
}

// Portée horizontale d'un saut complet (appui maintenu) à une vitesse donnée.
export function jumpReach(speed, cfg = CONFIG) {
  return speed * ((2 * cfg.jumpVelocity) / cfg.gravity);
}

// Hauteur maximale atteinte par un saut complet.
export function maxJumpHeight(cfg = CONFIG) {
  return (cfg.jumpVelocity * cfg.jumpVelocity) / (2 * cfg.gravity);
}

// Génère le prochain toit après prevEndX. Le trou (gap) est borné pour rester
// franchissable à la vitesse courante.
export function generateRooftop(rng, prevEndX, speed, cfg = CONFIG) {
  const maxGap = cfg.maxGapRatio * jumpReach(speed, cfg);
  const gap = cfg.minGap + rng() * Math.max(0, maxGap - cfg.minGap);
  const w = cfg.minRoofWidth + rng() * (cfg.maxRoofWidth - cfg.minRoofWidth);
  return { x: prevEndX + gap, w };
}

// Génère un obstacle posé sur un toit, à l'intérieur des marges. La hauteur est
// choisie pour rester franchissable (inférieure à la hauteur de saut).
export function generateObstacle(rng, roof, cfg = CONFIG) {
  const h = cfg.minObstacleHeight + rng() * (cfg.maxObstacleHeight - cfg.minObstacleHeight);
  const w = cfg.obstacleWidth;
  const span = roof.w - w - 2 * cfg.obstacleEdgeMargin;
  const x = roof.x + cfg.obstacleEdgeMargin + rng() * Math.max(0, span);
  return { x, w, h };
}

// Met à jour le meilleur score et signale si c'est un nouveau record.
export function updateHighscore(best, score) {
  const isNew = score > best;
  return { best: isNew ? score : best, isNew };
}

// État d'une partie (menu / jeu / game over) et simulation pure du runner.
export class Game {
  constructor(cfg = {}) {
    this.cfg = { ...CONFIG, ...cfg };
    this.rng = this.cfg.rng ?? Math.random;
    this.screenWidth = this.cfg.screenWidth ?? CONFIG.screenWidth;
    this._fixedGroundY = this.cfg.groundY != null;
    this.groundY = this.cfg.groundY ?? 400;
    this.state = 'menu'; // 'menu' | 'playing' | 'gameover'
    this.deathCause = null;
    this.resetRun();
  }

  // Réinitialise les données d'une course sans changer l'écran courant.
  resetRun() {
    this.distance = 0;
    this.speed = this.cfg.baseSpeed;
    this.player = {
      x: this.cfg.playerX,
      y: this.groundY - this.cfg.playerH,
      w: this.cfg.playerW,
      h: this.cfg.playerH,
      vy: 0,
      grounded: true,
    };
    this.rooftops = [{ x: 0, w: this.cfg.startRoofWidth }];
    this.obstacles = [];
    this.deathCause = null;
  }

  // Lance une partie depuis le menu.
  start() {
    this.resetRun();
    this.state = 'playing';
    this._generateAhead();
  }

  // Recalcule la géométrie à l'écran (resize / devicePixelRatio). Si le niveau
  // des toits bouge, le joueur est décalé avec lui puis réancré s'il est au sol.
  setViewport(width, height) {
    this.screenWidth = width;
    if (!this._fixedGroundY) {
      const nextGroundY = Math.round(height * this.cfg.groundRatio);
      const delta = nextGroundY - this.groundY;
      this.groundY = nextGroundY;
      if (this.player) {
        this.player.y += delta;
        if (this.player.grounded || this.state === 'menu') {
          this.player.y = this.groundY - this.player.h;
        }
      }
    }
  }

  currentSpeed() {
    return speedAt(this.distance, this.cfg);
  }

  // Score affiché = distance en « mètres ».
  score() {
    return Math.floor(this.distance / this.cfg.scoreDivisor);
  }

  // Saut déclenché à l'appui (espace / clic / tactile). Un seul saut à la fois.
  jump() {
    if (this.state !== 'playing' || !this.player.grounded) return;
    this.player.vy = -this.cfg.jumpVelocity;
    this.player.grounded = false;
  }

  // Saut variable : relâcher l'appui pendant la montée coupe la vitesse.
  releaseJump() {
    if (this.player.vy < 0) {
      this.player.vy *= this.cfg.jumpCutFactor;
    }
  }

  // Avance la simulation d'un pas de temps dt (en secondes).
  update(dt) {
    if (this.state !== 'playing') return;
    dt = Math.min(dt, this.cfg.maxDt);

    // La vitesse augmente avec la distance ; la distance augmente avec la vitesse.
    this.speed = this.currentSpeed();
    this.distance += this.speed * dt;

    // Défilement : toits et obstacles glissent vers la gauche.
    const dx = this.speed * dt;
    for (const r of this.rooftops) r.x -= dx;
    for (const o of this.obstacles) o.x -= dx;

    // Élagage de ce qui sort par la gauche.
    this.rooftops = this.rooftops.filter((r) => r.x + r.w > 0);
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > 0);

    this._generateAhead();

    // Physique verticale (gravité).
    const p = this.player;
    const prevFeet = p.y + p.h;
    p.vy += this.cfg.gravity * dt;
    p.y += p.vy * dt;

    // Support au sol : on ne se réceptionne que si l'on croise la surface des
    // toits en descendant (sinon on est déjà tombé dans le trou).
    const onRoof = this._findSupport(p.x + p.w / 2);
    if (onRoof && p.vy >= 0 && prevFeet <= this.groundY + 1e-6 && p.y + p.h >= this.groundY) {
      p.y = this.groundY - p.h;
      p.vy = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
    }

    // Collision avec les obstacles (AABB).
    const playerBox = { x: p.x, y: p.y, w: p.w, h: p.h };
    for (const o of this.obstacles) {
      if (aabbCollide(playerBox, o)) {
        this._die('obstacle');
        return;
      }
    }

    // Chute fatale dans un trou.
    if (p.y > this.groundY + this.cfg.fallDeathOffset * this.cfg.playerH) {
      this._die('fall');
    }
  }

  // Cherche le toit dont la surface porte la coordonnée horizontale donnée.
  _findSupport(centerX) {
    for (const r of this.rooftops) {
      if (centerX >= r.x && centerX <= r.x + r.w) return r;
    }
    return null;
  }

  // Génère des toits (et leurs obstacles) jusqu'au bord droit de l'écran + marge.
  _generateAhead() {
    let endX = this.rooftops.length
      ? Math.max(...this.rooftops.map((r) => r.x + r.w))
      : 0;
    const limit = this.screenWidth + this.cfg.generateBuffer;
    while (endX < limit) {
      const roof = generateRooftop(this.rng, endX, this.speed, this.cfg);
      this.rooftops.push(roof);
      if (this.rng() < this.cfg.obstacleChance) {
        const o = generateObstacle(this.rng, roof, this.cfg);
        o.y = this.groundY - o.h;
        this.obstacles.push(o);
      }
      endX = roof.x + roof.w;
    }
  }

  _die(cause) {
    this.state = 'gameover';
    this.deathCause = cause;
  }
}
