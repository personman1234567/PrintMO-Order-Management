const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'docs', 'official-docs', 'retrieval-manifest.json');

function loadManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function routeScore(route, query) {
  const normalizedQuery = normalize(query);
  const queryTerms = normalizedQuery.split(/[^a-z0-9_./:-]+/).filter(term => term.length > 1);
  const normalizedErrors = (route.errors || []).map(normalize);
  const normalizedPaths = (route.paths || []).map(normalize);
  const normalizedSymbols = (route.symbols || []).map(normalize);
  const fields = [
    route.id,
    route.description,
    ...(route.taskTypes || []),
    ...(route.keywords || []),
    ...(route.paths || []),
    ...(route.symbols || []),
    ...(route.errors || [])
  ].map(normalize);
  const haystack = fields.join(' ');
  let score = 0;
  if (fields.includes(normalizedQuery)) score += 20;
  if (haystack.includes(normalizedQuery)) score += 10;
  if (normalizedErrors.some(error => error.includes(normalizedQuery) || normalizedQuery.includes(error))) score += 30;
  if (normalizedPaths.some(file => file === normalizedQuery || normalizedQuery.endsWith(file))) score += 18;
  if (normalizedSymbols.includes(normalizedQuery)) score += 18;
  for (const term of queryTerms) {
    if (route.keywords.some(keyword => normalize(keyword) === term)) score += 6;
    else if (normalizedErrors.some(error => error.includes(term))) score += 5;
    else if (haystack.includes(term)) score += 2;
  }
  return score;
}

function routeQuery(query, options = {}) {
  if (!query.trim()) throw new Error('Provide a task, symptom, error, path, or symbol to route.');
  const manifest = loadManifest();
  const matches = manifest.routes
    .map(route => ({ route, score: routeScore(route, query) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.route.id.localeCompare(right.route.id))
    .slice(0, options.limit || 3);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
    return matches;
  }

  if (!matches.length) {
    console.log('No confident route found. Start with docs/official-docs/context-router.md.');
    return [];
  }

  for (const [index, result] of matches.entries()) {
    const route = result.route;
    console.log(`${index + 1}. ${route.id} — ${route.description}`);
    for (const target of route.read || []) {
      console.log(`   Read: ${target.path}#${target.anchor}`);
    }
    for (const target of route.inspect || []) {
      const symbols = target.symbols?.length ? ` → ${target.symbols.join(', ')}` : '';
      console.log(`   Inspect: ${target.path}${symbols}`);
    }
    if (route.tools?.length) console.log(`   Tools: ${route.tools.join(', ')}`);
    if (route.verify?.length) console.log(`   Verify: ${route.verify.join(' | ')}`);
    if (route.stop?.length) console.log(`   Stop: ${route.stop.join(' ')}`);
  }
  return matches;
}

function showTools(id, asJson = false) {
  const tools = loadManifest().tools;
  const selected = id ? tools.filter(tool => tool.id === id) : tools;
  if (id && !selected.length) throw new Error(`Unknown tool '${id}'. Run 'npm run repo -- tools'.`);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
    return;
  }
  for (const tool of selected) {
    console.log(`${tool.id} [${tool.mode}]`);
    console.log(`  ${tool.command}`);
    console.log(`  ${tool.purpose}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function runNode(script, args = []) {
  run(process.execPath, [path.join(root, script), ...args]);
}

function runRegisteredCommand(args) {
  const [group, action, ...rest] = args;
  const commandArgs = rest[0] === '--' ? rest.slice(1) : rest;
  if (group === 'verify' && ['phase1', 'phase2'].includes(action)) {
    return runNode(`scripts/verify-${action}.js`, rest);
  }
  if (group === 'docs' && action === 'check') return runNode('scripts/check-docs.js', rest);
  if (group === 'redis' && action === 'backup') return runNode('scripts/backup-redis-queue.js', rest);
  if (group === 'parity' && action === 'check') return runNode('scripts/run-parity-check.js', rest);
  if (group === 'build' && action === 'desktop-config') return runNode('scripts/create-desktop-config.js', rest);
  if (group === 'build' && action === 'cloudflare') return run('bash', ['scripts/prepare-cloudflare-pages-upload.sh', ...commandArgs]);
  if (group === 'deploy' && action === 'cloudflare') return run('bash', ['scripts/deploy-cloudflare-pages.sh', ...commandArgs]);
  if (group === 'migration' && ['dry-run', 'execute'].includes(action)) {
    const mode = action === 'execute' ? '--execute' : '--dry-run';
    return runNode('scripts/run-shadow-migration.js', [mode, ...rest]);
  }
  if (group === 'completion' && ['dry-run', 'execute'].includes(action)) {
    const mode = action === 'execute' ? '--execute' : '--dry-run';
    return runNode('scripts/repair-production-completion.js', [mode, ...rest]);
  }
  throw new Error(`Unknown command '${args.join(' ')}'. Run 'npm run repo -- --help'.`);
}

function printHelp() {
  console.log(`PrintMO repository command interface

Usage:
  npm run repo -- route <task-or-error> [--json]
  npm run repo -- tools [tool-id] [--json]
  npm run repo -- docs check
  npm run repo -- verify phase1|phase2
  npm run repo -- redis backup
  npm run repo -- parity check
  npm run repo -- migration dry-run|execute [migration arguments]
  npm run repo -- completion dry-run|execute [completion-repair arguments]
  npm run repo -- build desktop-config|cloudflare
  npm run repo -- deploy cloudflare -- --production|--preview [branch]

Safety:
  Route, tools, docs checks, and verifiers are read-only.
  Migration and completion repair default to dry-run; execution requires exact --confirm-shop.
  Redis backup and build commands write only their documented local artifacts.

Run 'npm run repo -- tools <tool-id>' for purpose and mutation mode.`);
}

function main(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') return printHelp();
  if (argv[0] === 'route') {
    const json = argv.includes('--json');
    return routeQuery(argv.slice(1).filter(value => value !== '--json').join(' '), { json });
  }
  if (argv[0] === 'tools') {
    const json = argv.includes('--json');
    const id = argv.slice(1).find(value => value !== '--json');
    return showTools(id, json);
  }
  return runRegisteredCommand(argv);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { loadManifest, routeQuery, routeScore, runRegisteredCommand };
