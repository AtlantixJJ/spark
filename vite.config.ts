import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import arraybuffer from "vite-plugin-arraybuffer";
import dts from "vite-plugin-dts";
import glsl from "vite-plugin-glsl";

type MorphCandidate = {
  anchorPath: string;
  deltaPath: string;
  fileName: string;
  isDebugStep: boolean;
  label: string;
  modelName: string;
  step: string;
  variant: string;
  vizDir: string;
};

const SKIP_DIRS = new Set([
  "deprecated",
  "results",
  "results-old",
  "visualize",
]);
const SCOPED_SKIP_DIRS = new Set(["deprecated", "results", "results-old"]);

type ExprScope = {
  absPath: string;
  relPath: string;
};

type MorphFolderListing = {
  currentPath: string;
  parentPath: string;
  folders: {
    name: string;
    path: string;
  }[];
};

function resolveExprScope(fsRoot: string, scopeRelPath = ""): ExprScope | null {
  const exprRoot = path.resolve(fsRoot, "expr");
  const scopeAbs = path.resolve(exprRoot, scopeRelPath || ".");
  const relFromExpr = path.relative(exprRoot, scopeAbs);
  if (
    relFromExpr === ".." ||
    relFromExpr.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relFromExpr)
  ) {
    return null;
  }
  return {
    absPath: scopeAbs,
    relPath: relFromExpr === "" ? "" : relFromExpr.split(path.sep).join("/"),
  };
}

function listSam3dgsMorphFolders(
  fsRoot: string,
  scopeRelPath = "",
): MorphFolderListing | null {
  const scope = resolveExprScope(fsRoot, scopeRelPath);
  if (
    !scope ||
    !fs.existsSync(scope.absPath) ||
    !fs.statSync(scope.absPath).isDirectory()
  ) {
    return null;
  }

  const folders = fs
    .readdirSync(scope.absPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SCOPED_SKIP_DIRS.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.posix.join(scope.relPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = scope.relPath.includes("/")
    ? scope.relPath.slice(0, scope.relPath.lastIndexOf("/"))
    : "";

  return {
    currentPath: scope.relPath,
    parentPath,
    folders,
  };
}

function listSam3dgsModels(
  fsRoot: string,
  scanTarget: "expr" | "expr-visualize" = "expr",
  scopeRelPath?: string,
): string[] {
  const exprRoot = path.resolve(fsRoot, "expr");
  if (!fs.existsSync(exprRoot) || !fs.statSync(exprRoot).isDirectory()) {
    return [];
  }
  const scope =
    scopeRelPath === undefined ? null : resolveExprScope(fsRoot, scopeRelPath);
  if (scopeRelPath !== undefined && !scope) {
    return [];
  }
  const baseDir = scope
    ? scope.absPath
    : scanTarget === "expr-visualize"
      ? path.join(exprRoot, "visualize")
      : exprRoot;
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
    return [];
  }
  const skipDirs = scope ? SCOPED_SKIP_DIRS : SKIP_DIRS;
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !skipDirs.has(e.name))
    .map((e) => e.name)
    .sort();
}

function listSam3dgsMorphCandidates(
  fsRoot: string,
  scanTarget: "expr" | "expr-visualize" = "expr",
  modelFilter?: string,
  scopeRelPath?: string,
): MorphCandidate[] {
  const exprRoot = path.resolve(fsRoot, "expr");
  if (!fs.existsSync(exprRoot) || !fs.statSync(exprRoot).isDirectory()) {
    return [];
  }
  const scope =
    scopeRelPath === undefined ? null : resolveExprScope(fsRoot, scopeRelPath);
  if (scopeRelPath !== undefined && !scope) {
    return [];
  }

  const candidates: MorphCandidate[] = [];
  const seen = new Set<string>();
  const pairSpecs = [
    {
      anchorSuffix: "_canonical.ply",
      deltaSuffixes: ["_canonical_delta.bin", "_canonical_offset_xyz.bin"],
      variant: "canonical",
    },
    {
      anchorSuffix: "_posed.ply",
      deltaSuffixes: ["_posed_delta.bin"],
      variant: "posed",
    },
    {
      anchorSuffix: "_token_canonical_gs.ply",
      deltaSuffixes: [],
      variant: "token_canonical_gs",
    },
    {
      anchorSuffix: "_fac_gs.ply",
      deltaSuffixes: [],
      variant: "fac",
    },
    {
      anchorSuffix: "_image_gs.ply",
      deltaSuffixes: [],
      variant: "image_gs",
    },
    {
      anchorSuffix: "_posed_gs.ply",
      deltaSuffixes: [],
      variant: "posed_gs",
    },
    {
      anchorSuffix: "_gs.ply",
      deltaSuffixes: [],
      variant: "gs",
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
      let deltaName = "";
      for (const suffix of pairSpec.deltaSuffixes) {
        const candidate = path.join(targetDir, `${step}${suffix}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          deltaName = `${step}${suffix}`;
          break;
        }
      }
      const hasDelta = deltaName !== "";

      const relDir = path.relative(fsRoot, targetDir).split(path.sep).join("/");
      const relAnchorPath = path
        .join(relDir, entry.name)
        .split(path.sep)
        .join("/");
      const relDeltaPath = hasDelta
        ? path.join(relDir, deltaName).split(path.sep).join("/")
        : "";
      const candidateKey = `${relAnchorPath}::${relDeltaPath}`;
      if (seen.has(candidateKey)) {
        continue;
      }
      seen.add(candidateKey);

      const modelDir = path.basename(path.dirname(relAnchorPath));
      const isDebugStep =
        modelDir.startsWith("dbg_step") || relDir.includes("/dbg_step");
      candidates.push({
        anchorPath: relAnchorPath,
        deltaPath: relDeltaPath,
        fileName: entry.name,
        isDebugStep,
        label: `${modelDir || "."} :: ${step} :: ${pairSpec.variant}${hasDelta ? "" : " (no delta)"}`,
        modelName: modelDir || ".",
        step,
        variant: pairSpec.variant,
        vizDir: relDir,
      });
    }
  }

  const skipDirs = scope ? SCOPED_SKIP_DIRS : SKIP_DIRS;

  function walk(currentDir: string) {
    scanDirectoryForPairs(currentDir);
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (skipDirs.has(entry.name)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name));
      }
    }
  }

  const baseDir = scope
    ? scope.absPath
    : scanTarget === "expr-visualize"
      ? path.join(exprRoot, "visualize")
      : exprRoot;
  if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
    if (modelFilter) {
      const modelDir = path.resolve(baseDir, modelFilter);
      const relFromBase = path.relative(baseDir, modelDir);
      if (
        relFromBase !== ".." &&
        !relFromBase.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relFromBase) &&
        fs.existsSync(modelDir) &&
        fs.statSync(modelDir).isDirectory()
      ) {
        walk(modelDir);
      }
    } else {
      walk(baseDir);
    }
  }
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

function listPlyFiles(fsRoot: string, scopeRelPath: string): string[] {
  const scopeAbs = path.resolve(fsRoot, scopeRelPath);
  if (!fs.existsSync(scopeAbs) || !fs.statSync(scopeAbs).isDirectory()) {
    return [];
  }

  const results: string[] = [];

  function scanForPly(dir: string, relDir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".ply")) {
        results.push(`${relDir}/${entry.name}`);
      }
    }
  }

  // depth 1: scopeRelPath/sub/*.ply
  let depth1Entries: fs.Dirent[];
  try {
    depth1Entries = fs.readdirSync(scopeAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const sub of depth1Entries) {
    if (!sub.isDirectory()) continue;
    const sub1Abs = path.join(scopeAbs, sub.name);
    const sub1Rel = `${scopeRelPath}/${sub.name}`;
    scanForPly(sub1Abs, sub1Rel);

    // depth 2: scopeRelPath/sub/subsub/*.ply
    let depth2Entries: fs.Dirent[];
    try {
      depth2Entries = fs.readdirSync(sub1Abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub2 of depth2Entries) {
      if (!sub2.isDirectory()) continue;
      const sub2Abs = path.join(sub1Abs, sub2.name);
      const sub2Rel = `${sub1Rel}/${sub2.name}`;
      scanForPly(sub2Abs, sub2Rel);
    }
  }

  results.sort();
  return results;
}

const sparkRsDirectory = "rust/spark-rs/pkg";
if (!fs.existsSync(sparkRsDirectory)) {
  console.error(
    "\x1b[31m************************************************************************\x1b[0m",
  );
  console.error(
    "\x1b[31m Rust Wasm component not found, make sure to build them first.\x1b[0m",
  );
  console.error(
    "\x1b[31m Install Rust and run:\x1b[1m npm run build:wasm\x1b[0m",
  );
  console.error(
    "\x1b[31m************************************************************************\x1b[0m",
  );
  process.exit(1);
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
      arraybuffer(),
      glsl({
        include: ["**/*.glsl"],
      }),

      dts({ outDir: "dist/types" }),

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
          const morphModelsUrl = "/sam3dgs/morph-models";
          const morphCandidatesUrl = "/sam3dgs/morph-candidates";
          const morphFoldersUrl = "/sam3dgs/morph-folders";
          const plyFilesUrl = "/sam3dgs/ply-files";
          const fsRoot = path.resolve(__dirname, "..", "..");

          server.middlewares.use((req, res, next) => {
            const url = req.url?.split("?")[0] ?? "";
            const qs = new URLSearchParams(req.url?.split("?")[1] ?? "");
            if (url === morphModelsUrl) {
              const rawScanTarget = qs.get("scanTarget") ?? "expr";
              const scanTarget =
                rawScanTarget === "expr-visualize" ? "expr-visualize" : "expr";
              const rawScope = qs.has("scope")
                ? (qs.get("scope") ?? "")
                : undefined;
              const models = listSam3dgsModels(fsRoot, scanTarget, rawScope);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ models }));
              return;
            }
            if (url === morphCandidatesUrl) {
              const rawScanTarget = qs.get("scanTarget") ?? "expr";
              const scanTarget =
                rawScanTarget === "expr-visualize" ? "expr-visualize" : "expr";
              const modelFilter = qs.get("model") ?? undefined;
              const rawScope = qs.has("scope")
                ? (qs.get("scope") ?? "")
                : undefined;
              const candidates = listSam3dgsMorphCandidates(
                fsRoot,
                scanTarget,
                modelFilter,
                rawScope,
              );
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ candidates }));
              return;
            }
            if (url === morphFoldersUrl) {
              const rawScope = qs.get("scope") ?? "";
              const listing = listSam3dgsMorphFolders(fsRoot, rawScope);
              if (!listing) {
                res.statusCode = 404;
                res.end("Not found");
                return;
              }
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(listing));
              return;
            }
            if (url === plyFilesUrl) {
              const rawScope =
                new URLSearchParams(req.url?.split("?")[1] ?? "").get(
                  "scope",
                ) ?? "expr";
              // Prevent path traversal: scope must stay within fsRoot
              const scopeAbs = path.resolve(fsRoot, rawScope);
              if (!scopeAbs.startsWith(path.resolve(fsRoot))) {
                res.statusCode = 403;
                res.end("Forbidden");
                return;
              }
              const files = listPlyFiles(fsRoot, rawScope);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ files }));
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
          console.log(`🧭 Morph models active: ${morphModelsUrl}`);
          console.log(
            `🧭 Morph candidates active: ${morphCandidatesUrl}?scanTarget=<t>&model=<name>`,
          );
          console.log(
            `📂 Morph folder browse active: ${morphFoldersUrl}?scope=<expr-rel-path>`,
          );
          console.log(
            `🔍 PLY file search active: ${plyFilesUrl}?scope=<rel-path>`,
          );
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
        external: ["three", /^three\/addons/],
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
