#!/usr/bin/env node
/**
 * Guard against duplicated / mismatched copies of the internal framework
 * packages. A second nested copy of @tanstack/router-core makes the
 * @tanstack/react-start type augmentations (e.g. the `server` route option)
 * apply to the wrong module, producing confusing TS2353 errors.
 *
 * Run automatically before `build` and `build:dev`.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NM = join(ROOT, "node_modules");

/** Packages that must resolve to exactly one copy with a single minor line. */
const GUARDED = [
  "@tanstack/router-core",
  "@tanstack/start-client-core",
  "@tanstack/react-router",
  "react",
  "react-dom",
];

const problems = [];

function readVersion(dir) {
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) return null;
  try {
    return JSON.parse(readFileSync(pkg, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Find nested copies under node_modules/<scope?>/<pkg>/node_modules. */
function findNestedCopies(name) {
  const found = [];
  const scopes = existsSync(NM) ? readdirSync(NM) : [];
  for (const entry of scopes) {
    const base = join(NM, entry);
    if (!statSync(base).isDirectory()) continue;
    const candidates = entry.startsWith("@")
      ? readdirSync(base).map((sub) => join(base, sub))
      : [base];
    for (const pkgDir of candidates) {
      const nested = join(pkgDir, "node_modules", ...name.split("/"));
      const version = readVersion(nested);
      if (version) found.push({ path: nested.replace(`${ROOT}/`, ""), version });
    }
  }
  return found;
}

for (const name of GUARDED) {
  const topVersion = readVersion(join(NM, ...name.split("/")));
  if (!topVersion) continue;
  const nested = findNestedCopies(name);
  const mismatched = nested.filter((c) => c.version !== topVersion);
  if (mismatched.length > 0) {
    problems.push(
      `${name}: root ${topVersion} but also ${mismatched
        .map((c) => `${c.version} (${c.path})`)
        .join(", ")}`,
    );
  }
}

if (problems.length > 0) {
  console.error("\nIncoerenza tra versioni dei pacchetti interni:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nAllinea le versioni, ad esempio:\n" +
      "  bun add @tanstack/react-start@latest @tanstack/react-router@latest\n",
  );
  process.exit(1);
}

console.log("check-deps: versioni dei pacchetti interni allineate.");
