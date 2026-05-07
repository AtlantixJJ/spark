import fs from "node:fs";
import path from "node:path";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import glsl from "vite-plugin-glsl";

type MorphCandidate = {
  anchorPath: string;
  deltaPath: string;
  fileName: string;
  label: string;
  modelName: string;
  step: string;
  variant: string;
  vizDir: string;
};

function listSam3dgsMorphCandidates(fsRoot: string): MorphCandidate[] {
  const exprRoot = path.join(fsRoot, "expr");
  if (!fs.existsSync(exprRoot) || !fs.statSync(exprRoot).isDirectory()) {
    return [];
  }

  const candidates: MorphCandidate[] = [];
  const seen = new Set<string>();
  const pairSpecs = [
    {
      anchorSuffix: "_canonical.ply",
      deltaSuffix: "_canonical_delta.bin",
      variant: "canonical",
    },
    {
      anchorSuffix: "_posed.ply",
      deltaSuffix: "_posed_delta.bin",
      variant: "posed",
    },
  ];

  function scanDirectoryForPairs(targetDir: string) {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const pairSpec = pairSpecs.find(({ anchorSuffix }) =>
        entry.name.endsWith(anchorSuffix),
      );
      if (!pairSpec) {
        continue;
      }

      const step = entry.name.slice(0, -pairSpec.anchorSuffix.length);
      const deltaName = `${step}${pairSpec.deltaSuffix}`;
      const deltaAbsPath = path.join(targetDir, deltaName);
      if (!fs.existsSync(deltaAbsPath) || !fs.statSync(deltaAbsPath).isFile()) {
        continue;
      }

      const relDir = path.relative(fsRoot, targetDir).split(path.sep).join("/");
      const relAnchorPath = path.join(relDir, entry.name).split(path.sep).join("/");
      const relDeltaPath = path.join(relDir, deltaName).split(path.sep).join("/");
      const candidateKey = `${relAnchorPath}::${relDeltaPath}`;
      if (seen.has(candidateKey)) {
        continue;
      }
      seen.add(candidateKey);

      const modelDir = path.basename(path.dirname(relAnchorPath));
      candidates.push({
        anchorPath: relAnchorPath,
        deltaPath: relDeltaPath,
        fileName: entry.name,
        label: `${modelDir || "."} :: ${step} :: ${pairSpec.variant}`,
        modelName: modelDir || ".",
        step,
        variant: pairSpec.variant,
        vizDir: relDir,
      });
    }
  }

  function walk(currentDir: string) {
    scanDirectoryForPairs(currentDir);
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.name === "deprecated") {
        continue;
      }
      if (entry.isDirectory()) {
        walk(absPath);
      }
    }
  }

  walk(exprRoot);
  candidates.sort((a, b) => {
    if (a.modelName !== b.modelName) {
      return a.modelName.localeCompare(b.modelName);
    }
    if (a.step !== b.step) {
      return b.step.localeCompare(a.step);
    }
    if (a.variant !== b.variant) {
      return a.variant.localeCompare(b.variant);
    }
    return a.fileName.localeCompare(b.fileName);
  });
  return candidates;
}

/**
 * Vite plugin to fix WASM data URL compatibility with webpack/Next.js.
 *
 * wasm-pack generates code like: new URL("data:...", import.meta.url)
 * The import.meta.url argument is unnecessary for data: URLs and causes
 * webpack/Vite to incorrectly try to rewrite the URL as a file path.
 *
 * This plugin transforms:
 *   new URL("data:...", import.meta.url) → new URL("data:...")
 *
 * Uses magic-string to ensure proper source map generation.
 *
 * See: https://github.com/sparkjsdev/spark/issues/95
 */
function fixWasmDataUrl(): Plugin {
  return {
    name: "fix-wasm-data-url",
    renderChunk(code) {
      // Match: new URL("data:...", import.meta.url)
      // The data URL can contain any characters including quotes (escaped)
      const dataUrlPattern =
        /new\s+URL\(\s*("data:[^"]*")\s*,\s*import\.meta\.url\s*\)/g;

      const matches = [...code.matchAll(dataUrlPattern)];
      if (matches.length === 0) return null;

      const magicString = new MagicString(code);
      for (const match of matches) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;
        const replacement = `new URL(${match[1]})`;
        magicString.overwrite(start, end, replacement);
      }

      return {
        code: magicString.toString(),
        map: magicString.generateMap({ hires: true }),
      };
    },
  };
}

const assetsDirectory = "examples/assets";
const localAssetsDirectoryExist = fs.existsSync(assetsDirectory);
if (!localAssetsDirectoryExist) {
  console.log(
    "************************************************************************",
  );
  console.log(" Examples assets will be fetched from an external server.");
  console.log(
    " To work offline you can download them: npm run assets:download",
  );
  console.log(
    "************************************************************************",
  );
}

export default defineConfig(({ mode }) => {
  const isMinify = mode === "production";
  const isFirstPass = mode === "production";

  return {
    appType: "mpa",

    plugins: [
      glsl({
        include: ["**/*.glsl"],
      }),

      dts({ outDir: "dist/types" }),

      // Fix webpack/Next.js compatibility for WASM data URLs
      fixWasmDataUrl(),
      {
        name: "serve-node-modules-alias",
        configureServer(server) {
          const baseUrlPath = "/examples/js/vendor/";

          server.middlewares.use((req, res, next) => {
            if (!req.url.startsWith(baseUrlPath)) return next();

            const relModulePath = req.url.slice(baseUrlPath.length); // safe substring
            const absPath = path.resolve("node_modules", relModulePath);

            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
              const ext = path.extname(absPath);
              const contentType =
                {
                  ".js": "application/javascript",
                  ".mjs": "application/javascript",
                  ".css": "text/css",
                  ".json": "application/json",
                }[ext] || "application/octet-stream";

              res.setHeader("Content-Type", contentType);
              fs.createReadStream(absPath).pipe(res);
            } else {
              res.statusCode = 404;
              res.end(`Not found: ${relModulePath}`);
            }
          });

          console.log(`📦 Dev alias active: ${baseUrlPath} → node_modules/*`);
        },
      },
      {
        name: "serve-local-files",
        configureServer(server) {
          const urlPrefix = "/local/";
          const morphCandidatesUrl = "/sam3dgs/morph-candidates";
          const fsRoot = path.resolve(__dirname, "..", "..");

          server.middlewares.use((req, res, next) => {
            const url = req.url?.split("?")[0] ?? "";
            if (url === morphCandidatesUrl) {
              const candidates = listSam3dgsMorphCandidates(fsRoot);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ candidates }));
              return;
            }
            if (!url.startsWith(urlPrefix)) return next();

            const relPath = url.slice(urlPrefix.length);
            // Prevent path traversal outside fsRoot
            const absPath = path.resolve(fsRoot, relPath);
            if (!absPath.startsWith(path.resolve(fsRoot))) {
              res.statusCode = 403;
              res.end("Forbidden");
              return;
            }

            if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
              const ext = path.extname(absPath).toLowerCase();
              if (ext === ".bin" || ext === ".ply") {
                console.log(`[sam3dgs] serve ${ext} ${relPath}`);
              }
              const contentType =
                {
                  ".js": "application/javascript",
                  ".json": "application/json",
                  ".ply": "application/octet-stream",
                  ".bin": "application/octet-stream",
                  ".spz": "application/octet-stream",
                  ".splat": "application/octet-stream",
                  ".ksplat": "application/octet-stream",
                  ".png": "image/png",
                  ".jpg": "image/jpeg",
                  ".jpeg": "image/jpeg",
                }[ext] ?? "application/octet-stream";

              res.setHeader("Content-Type", contentType);
              fs.createReadStream(absPath).pipe(res);
            } else {
              res.statusCode = 404;
              res.end(`Not found: ${relPath}`);
            }
          });

          console.log(`📁 Local files active: ${urlPrefix} → ${fsRoot}`);
          console.log(`🧭 Morph candidates active: ${morphCandidatesUrl}`);
        },
      },
    ],

    build: {
      minify: isMinify,
      lib: {
        entry: path.resolve(__dirname, "src/index.ts"),
        name: "spark",
        formats: ["es", "cjs"],
        fileName: (format) => {
          const base = format === "es" ? "spark.module" : `spark.${format}`;
          return isMinify ? `${base}.min.js` : `${base}.js`;
        },
      },
      sourcemap: true,
      rollupOptions: {
        external: ["three"],
        output: {
          globals: {
            three: "THREE",
          },
        },
      },
      emptyOutDir: isFirstPass,
    },

    worker: {
      rollupOptions: {
        treeshake: "smallest",
      },
      plugins: () => [
        glsl({
          include: ["**/*.glsl"],
        }),
      ],
    },

    server: {
      watch: {
        usePolling: true,
      },
      port: 8080,
    },

    optimizeDeps: {
      force: true,
      exclude: ["three"], // prevent Vite pre-bundling
    },

    define: {
      sparkLocalAssets: localAssetsDirectoryExist,
    },
  };
});
