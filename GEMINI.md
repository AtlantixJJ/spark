# Spark Project Instructions (GEMINI.md)

This document provides foundational mandates, architectural guidance, and development workflows for the Spark project.

## Core Mission
Spark is an advanced 3D Gaussian Splatting (3DGS) renderer built for the THREE.js ecosystem. It aims to provide a high-performance, flexible, and feature-rich library for rendering dynamic splats across all WebGL2-compatible devices.

## Tech Stack & Standards
- **Language:** TypeScript (strict mode)
- **Renderer:** THREE.js (External peer dependency)
- **Performance:** Rust/WASM (Radix sort, raycasting)
- **Bundler:** Vite 6
- **Linting/Formatting:** Biome (2-space indent, double quotes, LF)
- **Documentation:** MkDocs (Material theme)

## Architectural Mandates

### 1. Rendering Pipeline
- **SparkRenderer:** Central coordinator that accumulates splats from various sources each frame.
- **SparkViewpoint:** Represents a camera/render context. Handles depth sorting (via WASM) and final rendering.
- **SplatAccumulator:** Merges multiple `PackedSplats` into single GPU buffers.
- **SplatMesh:** The primary THREE.js-compatible object for placing splats in a scene.

### 2. Dyno Shader Graph
- All GPU-side logic (generators, modifiers) should prefer the **Dyno** system (`src/dyno/`).
- Dyno provides type-safe GLSL construction. Avoid writing raw GLSL unless absolutely necessary for core renderer features.

### 3. PackedSplats Data Structure
- `PackedSplats` is the core data format. It uses TypedArrays to store splat attributes (pos, rot, scale, color, opacity, SH).
- Follow the established packing layouts in `src/PackedSplats.ts`.

### 4. WASM & Worker Integration
- **WASM:** Built from Rust (`rust/spark-internal-rs/`). Modules are inlined as data URLs for easier distribution.
- **Workers:** Background tasks (like sorting) must use the Vite worker build pipeline. See `src/worker.ts`.

## Development Workflows

### Setup & Build
- `npm install`: Automatically builds WASM via `prepare` script.
- `npm run build`: Builds both production (minified) and dev versions.
- `npm run build:wasm`: Manual trigger for Rust/WASM compilation.
- `npm start`: Runs dev server with HMR and file watching.

**Note on older Git versions:**
If you encounter `open --path-format=absolute/lefthook.yml` errors (a side effect of `lefthook` not handling older Git versions cleanly), use the following commands to build the project:
```bash
npm install --ignore-scripts
npm run build:wasm
npm run build
```

### Code Quality
- **Linting:** Run `npm run lint:fix` before committing.
- **Formatting:** Biome is enforced. Run `npm run format:fix`.
- **Testing:** Add tests in `test/` for new utilities or logic. Run with `npm test`.

### Asset Management
- Download example assets: `npm run assets:download`.
- Compress PLY to SPZ: `npm run assets:compress <path>`.

## Release & Commit Workflow
- **Dist Files:** The `dist/` directory is tracked in Git. Always run `npm run build` before committing to keep it in sync.
- **Local Dev:** To avoid noise in `dist/` during development, use:
  `git update-index --assume-unchanged dist/*`
- **Preparing Commit:** Revert the above with `--no-assume-unchanged` before final build and commit.

## Documentation
- Edit files in `docs/` (Markdown).
- Preview docs: `npm run docs`.
- Site builds: `npm run site:build`.
