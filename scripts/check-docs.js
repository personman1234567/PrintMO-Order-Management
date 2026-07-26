const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const docsRoot = path.join(root, 'docs', 'official-docs');
const manifestPath = path.join(docsRoot, 'retrieval-manifest.json');
const errors = [];
const warnings = [];

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function headingAnchor(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(markdown) {
  const result = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) result.add(headingAnchor(match[1]));
  return result;
}

function resolveLocalLink(sourceFile, target) {
  const normalized = target.replace(/^<|>$/g, '');
  if (/^(https?:|mailto:|tel:|chatgpt-conversation:)/i.test(normalized)) return null;
  const hashIndex = normalized.indexOf('#');
  const clean = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const anchor = hashIndex >= 0 ? decodeURIComponent(normalized.slice(hashIndex + 1)) : '';
  return {
    file: clean ? path.resolve(path.dirname(sourceFile), decodeURIComponent(clean)) : sourceFile,
    anchor
  };
}

function validateMarkdownContracts(files) {
  const currentFolders = new Set(['architecture', 'workflows', 'runbooks', 'reference']);
  const required = ['## Use This When', '## Skip This When', '## Section Map', '## Common Failure Modes & Recovery'];

  for (const file of files) {
    const rel = relative(file);
    if (rel.includes('/legacy/')) continue;
    const markdown = read(file);
    const topFolder = rel.split('/')[2];

    if (currentFolders.has(topFolder)) {
      for (const heading of required) {
        if (!markdown.includes(heading)) fail(`${rel}: missing required heading '${heading}'`);
      }
    }
    if (/\]\(file:\/\/\//i.test(markdown)) fail(`${rel}: contains a machine-specific file:/// link`);

    for (const match of markdown.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
      const target = resolveLocalLink(file, match[1]);
      if (!target) continue;
      if (!fs.existsSync(target.file)) {
        fail(`${rel}: broken local link '${match[1]}'`);
        continue;
      }
      if (target.anchor && target.file.endsWith('.md') && !anchors(read(target.file)).has(target.anchor)) {
        fail(`${rel}: broken local anchor '${match[1]}'`);
      }
    }

    for (const match of markdown.matchAll(/(?:^|[\s`(])([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?/gm)) {
      const requestedEnd = Number(match[3] || match[2]);
      const direct = path.resolve(root, match[1]);
      if (!fs.existsSync(direct) || !fs.statSync(direct).isFile()) continue;
      const lineCount = read(direct).split(/\r?\n/).length;
      if (requestedEnd > lineCount) fail(`${rel}: source range '${match[1]}:${match[2]}${match[3] ? `-${match[3]}` : ''}' exceeds ${lineCount} lines`);
    }

    if (['architecture', 'workflows'].includes(topFolder) &&
        /\[(Draft \/ Idea|Spec Ready|In Progress)]/.test(markdown)) {
      fail(`${rel}: future-plan lifecycle state appears in current-state documentation`);
    }
  }
}

function extractPlanStatus(markdown) {
  const match = markdown.match(/^- \*\*Status\*\*:\s*`(\[[^\]]+])`/m);
  return match?.[1] || null;
}

function validatePlans() {
  const allowed = new Set(['[Draft / Idea]', '[Spec Ready]', '[In Progress]', '[Implemented Candidate]', '[Graduated]']);
  const futureDir = path.join(docsRoot, 'future-plans');
  const roadmap = read(path.join(futureDir, 'README.md'));
  const planFiles = fs.readdirSync(futureDir).filter(name => name.endsWith('.md') && name !== 'README.md');

  for (const name of planFiles) {
    const file = path.join(futureDir, name);
    const markdown = read(file);
    const status = extractPlanStatus(markdown);
    if (!status || !allowed.has(status)) fail(`docs/official-docs/future-plans/${name}: missing or invalid status '${status || 'none'}'`);
    for (const pattern of [
      /^## Summary & Intent$/m,
      /^## Current Continuation State$/m,
      /^## Open Questions & Brainstorming$/m,
      /^## .*Technical Specification & Task Checklist/m,
      /^## Progress Log$/m
    ]) {
      if (!pattern.test(markdown)) fail(`docs/official-docs/future-plans/${name}: missing plan contract section matching ${pattern}`);
    }
    const roadmapLine = roadmap.split(/\r?\n/).find(line => line.includes(name));
    if (!roadmapLine) fail(`future-plans/README.md: missing roadmap entry for ${name}`);
    else if (status && !roadmapLine.includes(`\`${status}\``)) fail(`future-plans/README.md: status for ${name} does not match ${status}`);
  }
}

function validateManifest() {
  let manifest;
  try {
    manifest = JSON.parse(read(manifestPath));
  } catch (error) {
    fail(`retrieval-manifest.json: ${error.message}`);
    return;
  }
  if (manifest.schemaVersion !== 1) fail('retrieval-manifest.json: unsupported schemaVersion');
  const toolIds = new Set();
  for (const tool of manifest.tools || []) {
    if (!tool.id || toolIds.has(tool.id)) fail(`retrieval-manifest.json: duplicate or missing tool id '${tool.id}'`);
    toolIds.add(tool.id);
    const script = path.resolve(root, tool.script || '');
    if (!tool.script || !fs.existsSync(script)) fail(`retrieval-manifest.json: tool '${tool.id}' references missing script '${tool.script}'`);
  }

  const routeIds = new Set();
  for (const route of manifest.routes || []) {
    if (!route.id || routeIds.has(route.id)) fail(`retrieval-manifest.json: duplicate or missing route id '${route.id}'`);
    routeIds.add(route.id);
    for (const target of route.read || []) {
      const file = path.resolve(root, target.path || '');
      if (!target.path || !fs.existsSync(file)) {
        fail(`retrieval-manifest.json: route '${route.id}' references missing read target '${target.path}'`);
        continue;
      }
      if (target.anchor && !anchors(read(file)).has(target.anchor)) {
        fail(`retrieval-manifest.json: route '${route.id}' references missing anchor '${target.anchor}' in ${target.path}`);
      }
    }
    for (const target of route.inspect || []) {
      const file = path.resolve(root, target.path || '');
      if (!target.path || !fs.existsSync(file)) {
        fail(`retrieval-manifest.json: route '${route.id}' references missing source '${target.path}'`);
        continue;
      }
      const source = read(file);
      for (const symbol of target.symbols || []) {
        if (!source.includes(symbol)) fail(`retrieval-manifest.json: route '${route.id}' cannot find symbol '${symbol}' in ${target.path}`);
      }
    }
    for (const toolId of route.tools || []) {
      if (!toolIds.has(toolId)) fail(`retrieval-manifest.json: route '${route.id}' references unknown tool '${toolId}'`);
    }
  }

  const registryPath = path.join(docsRoot, 'reference', 'tool-registry.md');
  if (fs.existsSync(registryPath)) {
    const registry = read(registryPath);
    for (const id of toolIds) {
      if (!registry.includes(`<!-- tool:${id} -->`)) fail(`tool-registry.md: missing registered tool marker '${id}'`);
    }
  } else {
    fail('docs/official-docs/reference/tool-registry.md is missing');
  }

  const routerPath = path.join(docsRoot, 'context-router.md');
  const router = read(routerPath);
  for (const id of routeIds) {
    if (!router.includes(`route:${id}`)) fail(`context-router.md: missing route marker '${id}'`);
  }
}

function main() {
  const markdownFiles = walk(docsRoot).filter(file => file.endsWith('.md'));
  validateMarkdownContracts(markdownFiles);
  validatePlans();
  validateManifest();

  for (const message of warnings) console.warn(`WARN: ${message}`);
  if (errors.length) {
    for (const message of errors) console.error(`ERROR: ${message}`);
    console.error(`Documentation validation failed with ${errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Documentation validation passed (${markdownFiles.length} Markdown files, ${loadCount('routes')} routes, ${loadCount('tools')} tools).`);
}

function loadCount(key) {
  return JSON.parse(read(manifestPath))[key]?.length || 0;
}

if (require.main === module) main();

module.exports = { anchors, headingAnchor, validateManifest };
