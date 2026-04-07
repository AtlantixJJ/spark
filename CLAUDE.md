# Spark — CLAUDE.md

## Overview

**Spark** (`@sparkjsdev/spark`) is an advanced 3D Gaussian Splatting renderer for THREE.js. It supports multiple splat formats (PLY, SPZ, SPLAT, KSPLAT, SOG), real-time animation, skeletal skinning, and a GPU shader-graph system ("dyno"). It is a TypeScript library with a Rust/WASM core for sorting and raycasting.

---

## Repository Structure

```
spark/
├── src/                    # TypeScript library source
│   ├── index.ts            # Public API exports
│   ├── SparkRenderer.ts    # Central renderer — accumulates splats per frame
│   ├── SparkViewpoint.ts   # Per-viewpoint render camera/context
│   ├── PackedSplats.ts     # Core packed splat data structure
│   ├── SplatMesh.ts        # THREE.Mesh-compatible splat object
│   ├── SplatLoader.ts      # File format loader (PLY/SPZ/SPLAT/KSPLAT/SOG)
│   ├── SplatGenerator.ts   # Generator/Modifier/Transformer abstractions
│   ├── SplatAccumulator.ts # Per-frame splat accumulation pipeline
│   ├── SplatEdit.ts        # Runtime splat editing (color, SDF masking)
│   ├── SplatSkinning.ts    # Skeletal skinning for splat meshes
│   ├── SplatGeometry.ts    # Low-level splat geometry buffers
│   ├── dyno/               # GPU shader-graph system (type-safe GLSL construction)
│   │   ├── program.ts      # DynoProgram — compiles graph to GLSL
│   │   ├── splats.ts       # Gsplat / PackedSplats dyno nodes
│   │   ├── value.ts        # DynoValue base
│   │   ├── vecmat.ts       # Vec/mat dyno types
│   │   └── ...             # math, trig, logic, texture, transform nodes
│   ├── generators/         # Built-in splat generators (snow, static)
│   ├── modifiers/          # Built-in splat modifiers (depthColor, normalColor)
│   ├── shaders/            # GLSL shader source
│   ├── ply.ts              # PLY reader
│   ├── spz.ts              # SPZ reader/writer/transcode
│   ├── worker.ts           # Web Worker entry for background sorting
│   └── utils.ts            # Math/geometry utilities
├── rust/
│   └── spark-internal-rs/  # Rust crate compiled to WASM
│       └── src/
│           ├── lib.rs       # WASM bindings
│           ├── sort.ts      # Radix sort for splat depth ordering
│           └── raycast.rs   # Splat raycasting
├── dist/                   # Build output (ES module + CJS)
├── scripts/                # CLI utilities
│   └── compress-to-spz.js  # Transcode splat files to .spz format
├── examples/               # HTML examples
├── docs/                   # MkDocs documentation source
├── vite.config.ts          # Build configuration
├── biome.json              # Linter/formatter config (Biome)
└── package.json
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Dev server (builds + watches, serves on port 8080)
npm start          # alias for: npm run dev

# Build library (production + dev)
npm run build

# Build production only (minified)
npm run build:production

# Build dev only (unminified, with source maps)
npm run build:dev

# Watch mode (rebuilds on src changes)
npm run build:watch

# Build WASM from Rust source
npm run build:wasm

# Run tests
npm test

# Lint (Biome)
npm run lint
npm run lint:fix

# Format (Biome)
npm run format:fix

# Download example assets for offline use
npm run assets:download

# Compress splat assets to .spz
npm run assets:compress

# Docs dev server (MkDocs)
npm run docs
```

---

## Build System

- **Bundler**: Vite 6, outputs `dist/spark.module.js` (ESM) and `dist/spark.cjs.js` (CJS)
- **TypeScript**: strict mode, types emitted to `dist/types/`
- **GLSL**: bundled inline via `vite-plugin-glsl`
- **WASM**: built via `wasm-pack` from `rust/spark-internal-rs/`, inlined as data URLs
- **THREE.js**: peer dependency (external, not bundled)
- **Linter/Formatter**: Biome (`biome.json`) — 2-space indent, LF, double quotes

---

## Key Architectural Concepts

### Rendering Pipeline
1. `SparkRenderer` collects `SplatGenerator`s each frame
2. `SplatAccumulator` merges generators' `PackedSplats` into a combined buffer
3. GPU sort (WASM radix sort) orders splats by depth per viewpoint
4. `SparkViewpoint` renders the sorted splats via custom THREE.js material/shader

### Dyno Shader Graph (`src/dyno/`)
Type-safe GLSL shader construction system. Nodes represent GPU values; `DynoProgram` compiles the graph to valid GLSL. Used to create custom splat generators/modifiers that run entirely on the GPU.

### PackedSplats
Core data structure: splat attributes (position, rotation, scale, opacity, SH coefficients) packed into `Float32Array`/`Uint8Array` views. Multiple encoding formats (`SplatEncoding`).

### File Format Support
`SplatLoader` auto-detects format from file extension/magic bytes:
- `.ply` — raw and compressed PLY
- `.spz` — Niantic SPZ (compressed, recommended)
- `.splat` — AntiSplat binary
- `.ksplat` — KSplat
- `.sog` — PlayCanvas SOG

---

## Coding Conventions

- **TypeScript strict mode** — no implicit `any`
- **Biome** enforces style — run `npm run lint:fix` before committing
- **No bundling of THREE.js** — always import from `"three"` (peer dep)
- **WASM modules** are inlined as data URLs — do not import `.wasm` files directly
- **Workers** (`worker.ts`, `splatWorker.ts`) use Vite worker build pipeline

---

## Testing

```bash
npm test
# Uses ts-node/esm to run test/**/*.test.ts via Node's built-in test runner
```

---

## Dist Files

The `dist/` directory is committed and tracks the built library:
- `dist/spark.module.js` — ESM build (unminified dev)
- `dist/spark.module.min.js` — ESM build (minified production)
- `dist/spark.cjs.js` — CJS build
- `dist/types/` — TypeScript declarations
- `dist/assets/` — worker chunk(s)

When modifying `src/`, rebuild with `npm run build` to keep `dist/` in sync before committing.
