# Rooftop Runner — OhDjiGames

Un stickman court automatiquement sur les toits. Sautez pour éviter les trous et les obstacles ; plus vous allez loin, plus ça va vite. Le runner one-button façon Canabalt.

## Comment jouer
Appuyez (espace, clic ou toucher) pour sauter. Évitez les trous entre les toits et les obstacles. La vitesse augmente avec la distance.

## Lancer en local
Aucun build : servir le dossier `public`.
```bash
cd public && python3 -m http.server 8000      # http://localhost:8000
```
Ou via l'image :
```bash
docker build -t game_rooftop_runner . && docker run --rm -p 8080:8080 game_rooftop_runner
```

## Tests
```bash
node --test tests/     # logique pure (collision, génération, score) — zéro dépendance
```

## Stack
Vanilla JS + Canvas 2D, sans dépendance, sans build, sans appel réseau, sans clé d'API, sans traceur.
Le meilleur score est enregistré dans le navigateur (`localStorage`) et reste sur l'appareil.

## Structure
```
public/
  index.html   structure + canvas
  style.css    styles (fichier externe, CSP stricte)
  main.js      point d'entrée : boucle de jeu, rendu, entrées
  logic.js     logique pure testable (collision, génération, score)
  favicon.svg
tests/         tests Node (node --test)
nginx.conf     en-têtes de sécurité (CSP stricte), cache, /healthz
Dockerfile     nginx-unprivileged, port 8080, sans root
```

## CI/CD
`.github/workflows/ci.yml` : tests Node, build image, smoke test (page, assets, `/healthz`, CSP), scan Trivy (bloquant sur CRITICAL), push sur `ghcr.io/a-djihadi/game_rooftop_runner`.

## Déploiement Dokploy
Application « build Dockerfile » → `https://runner.ohdji.dev` (port 8080, HTTPS Let's Encrypt).
