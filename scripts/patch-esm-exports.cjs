const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');
const packages = fs.readdirSync(path.join(nodeModules, '@actions'))
  .map(name => path.join(nodeModules, '@actions', name, 'package.json'))
  .filter(p => fs.existsSync(p));

for (const pkgPath of packages) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const dot = pkg.exports?.['.'];
  if (dot?.import && !dot.require && !dot.default) {
    dot.default = dot.import;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}
