const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');

// Direct deps are hoisted into node_modules/<scope>; transitive deps live under
// node_modules/.pnpm/<pkg>/node_modules/<scope>. Collect a package's manifests
// from both locations so patches apply regardless of hoisting.
function findManifests(scope, name) {
  const found = [];
  const direct = path.join(nodeModules, scope, name, 'package.json');
  if (fs.existsSync(direct)) found.push(direct);

  const pnpmDir = path.join(nodeModules, '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      const nested = path.join(pnpmDir, entry, 'node_modules', scope, name, 'package.json');
      if (fs.existsSync(nested)) found.push(nested);
    }
  }
  return found;
}

function scopeMembers(scope) {
  const scopeDir = path.join(nodeModules, scope);
  if (!fs.existsSync(scopeDir)) return [];
  return fs.readdirSync(scopeDir);
}

function patch(manifestPath, mutate) {
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (mutate(pkg)) {
    fs.writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// @actions/* v6+ ship ESM-only export maps ({ ".": { import } }). ncc bundles to
// CJS and needs a `default`/`require` entry to resolve them, so mirror `import`.
for (const name of scopeMembers('@actions')) {
  for (const manifest of findManifests('@actions', name)) {
    patch(manifest, (pkg) => {
      const dot = pkg.exports?.['.'];
      if (dot?.import && !dot.require && !dot.default) {
        dot.default = dot.import;
        return true;
      }
      return false;
    });
  }
}

// @azure/storage-common's ESM crc64.js synthesizes `require` via
// createRequire(import.meta.url); ncc mis-bundles that Emscripten glue into CJS
// (`crc64_require is not a function`). The CommonJS build omits that block, so
// point ESM consumers (@actions/cache v6) at it. See dist/commonjs/crc64.js.
for (const manifest of findManifests('@azure', 'storage-common')) {
  patch(manifest, (pkg) => {
    const cjs = pkg.exports?.['.']?.require;
    const esm = pkg.exports?.['.']?.import;
    if (cjs && esm && esm.default !== cjs.default) {
      esm.default = cjs.default;
      return true;
    }
    return false;
  });
}
