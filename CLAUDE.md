# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"LESS, STILL. — 構造分解": a static, no-build 3D puzzle (Three.js + Rapier) where the player taps structural members to hear them and removes them one by one without collapsing the structure. Published to GitHub Pages; UI text and README are Japanese.

## Commands

Requires Node.js 24+.

- `npm ci` — install
- `npm start` — serve `dist/` at http://127.0.0.1:8770 via `tools/serve.mjs` (do not use python http.server: on Windows it serves .js as text/plain and the game fails to boot)
- `npm run verify` — syntax check (`node --check` on every `dist/js/*.js`) + ESLint + Prettier check + `vendor:check` + unit tests. This is what CI runs before E2E.
- `npm run vendor` — copy three/rapier from `node_modules` into `dist/vendor/` after bumping their versions (`vendor:check` fails if they drift).
- `npm test` — unit tests (`node --test tests/unit/*.mjs`)
- Single unit test: `node --test --test-name-pattern="<name>" tests/unit/test-structure.mjs`
- `npm run format` — Prettier write
- `npx playwright install chromium` then `npm run test:e2e` — E2E; Playwright starts its own server on port 8770 (`reuseExistingServer: false`, so stop `npm start` first). Single test: `npx playwright test -g "<title>"`
- E2E uses SwiftShader software rendering with `workers: 1`. Do not run E2E of multiple 3D games concurrently — GPU contention makes them slow/flaky.

## Architecture

There is no bundler: `dist/` is both source and the deployed site. Edit files in `dist/js/` directly.

- `dist/index.html` defines an importmap mapping `three` → `./vendor/three.module.js`. Rapier and Three addons are imported by relative path from `dist/vendor/` (vendored copies; versions pinned in `package.json` must match). `dist/vendor/` is excluded from lint/format.
- Boot: `game-bootstrap.js` dynamically imports `structure.js` with a 30s timeout and checks `window.structureStudy.snapshot().ready`; on failure, or on a `structure-render-error` window event, it shows the startup error panel.
- `structure.js` is the app controller (UI, input, save/restore, wiring). It exposes `window.structureStudy` (`snapshot()` etc.), which E2E tests rely on to read game state — keep it in sync when changing state shape.

Logic layer (pure, no DOM/Three — unit-tested in Node by importing from `dist/js/`):

- `structure-solver.js` — 3D frame/truss stiffness analysis. `prepareAnalysis(structure, removed)` returns an evaluator; results include `stable`, `reason` (`'mechanism'` = collapse), per-member forces/energy, displacement.
- `structure-levels.js` (`CATALOG`, `makeStructure(id)`) assembles levels from `structure-stages.js` (stage order, chapters, hand-built stages) and `structure-geometry.js` (parametric shells/hyperboloids).
- Members whose both ends are fully fixed carry no load; `makeStructure` marks them `foundation: true` outside the first chapter (`入門`), and they cannot be selected or removed. Changing stages can make `target` unreachable — the unit test `attainable target` checks this.
- `structure-game.js` — `StructureGame` state machine (probe/remove, scoring by member energy share, pending-removal grace window, sway via `structure-motion.js` seeded RNG) and localStorage records (`SAVE_KEY` is versioned; bump it if the record format changes).
- `structure-captions.js` / `structure-audio.js` / `structure-music.js` — sound impression text and Web Audio synthesis from member profiles.

Rendering layer (Three.js / Rapier):

- `structure-view.js` — scene, camera, OrbitControls, member meshes, picking; composes `structure-landscape.js`, `structure-architecture.js` (geometries/materials), `structure-affordance.js` (selection highlight), `structure-effects.js`.
- `structure-collapse.js` — Rapier rigid-body simulation used only for the collapse animation after the solver reports failure. `structure-profile.js` holds shared `FOUNDATION` dimensions and member profiles.

The physics is a game approximation, not a real structural safety check.

## Deployment

`.github/workflows/check.yml`: on pushes to `main` and on PRs runs `npm run verify` and E2E; on `main` it deploys `dist/` + `LICENSE` to GitHub Pages. If the public URL changes, update the URLs/share links in `dist/index.html`, plus `dist/sitemap.xml`, `robots.txt`, `404.html`.
