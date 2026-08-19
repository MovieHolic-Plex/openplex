import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planSlug = process.argv[2] ?? 'openplex-web';
const supportedPlans = new Set(['openplex-web', 'openplex-emby-features', 'openplex-media-library', 'openplex-library-ux-meta']);
const forbiddenExtensions = new Set(['.apk', '.ipa', '.torrent']);
const forbiddenPackages = ['webtorrent', 'torrent-stream', 'peerflix'];
const excludedDirectories = new Set(['node_modules', 'dist', 'reference', '.git', '.data', '.senpi', 'build']);
const failures = [];
const manifests = ['package.json', 'server/package.json', 'client/package.json'];

if (!supportedPlans.has(planSlug)) {
  console.error(`Unknown plan slug: ${planSlug}`);
  console.error(`Supported plans: ${[...supportedPlans].join(', ')}`);
  process.exitCode = 1;
} else {
  function walk(directory, visit) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (excludedDirectories.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target, visit);
      else visit(target);
    }
  }

  walk(root, (target) => {
    if (forbiddenExtensions.has(path.extname(target).toLowerCase())) {
      failures.push(`out-of-scope artifact: ${path.relative(root, target)}`);
    }
  });

  const manifestDependencies = new Map();
  for (const manifest of manifests) {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    manifestDependencies.set(manifest, dependencies);
    for (const dependency of forbiddenPackages) {
      if (dependency in dependencies) failures.push(`forbidden dependency ${dependency} in ${manifest}`);
    }
  }

  const authSource = fs.readFileSync(path.join(root, 'server/src/auth/token.ts'), 'utf8');
  if (!authSource.includes("LOOPBACK_HOST = '127.0.0.1'")) {
    failures.push('server no longer enforces the loopback host');
  }
  const gatewaySource = fs.readFileSync(path.join(root, 'server/src/gateway/hls-gateway.ts'), 'utf8');
  if (/request\.query.*url|[?&]url=/.test(gatewaySource)) {
    failures.push('gateway appears to expose an open URL proxy parameter');
  }

  if (planSlug === 'openplex-media-library') {
    const sourceFiles = [];
    for (const directory of ['client/src', 'server/src', 'shared', 'scripts']) {
      walk(path.join(root, directory), (target) => {
        if (/\.(?:[cm]?[jt]sx?)$/.test(target)) sourceFiles.push(target);
      });
    }

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (/OPENPLEX_BIND\s*(?:=[^=]|\+=|-=|\*=|\/=)/.test(content)) {
        failures.push(`OPENPLEX_BIND assignment found in ${path.relative(root, file)}`);
      }
    }

    const tokenSource = fs.readFileSync(path.join(root, 'server/src/auth/token.ts'), 'utf8');
    const allowlistBlock = tokenSource.match(
      /VISITOR_ALLOWLIST[^=]*=\s*\[[\s\S]*?\n\s*\];/,
    );
    if (!allowlistBlock) {
      failures.push('visitor allowlist block not found in server/src/auth/token.ts');
    } else {
      for (const forbidden of ['/hls/', '/api/stream/', '/api/category']) {
        if (allowlistBlock[0].includes(forbidden)) {
          failures.push(`visitor allowlist exposes protected route ${forbidden}`);
        }
      }
    }
  }

  function stripComments(source) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1');
  }

  if (planSlug === 'openplex-library-ux-meta') {
    const sourceFiles = [];
    for (const directory of ['client/src', 'server/src', 'shared', 'scripts']) {
      walk(path.join(root, directory), (target) => {
        if (/\.(?:[cm]?[jt]sx?)$/.test(target)) sourceFiles.push(target);
      });
    }

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (/OPENPLEX_BIND\s*(?:=[^=]|\+=|-=|\*=|\/=)/.test(content)) {
        failures.push(`OPENPLEX_BIND assignment found in ${path.relative(root, file)}`);
      }
    }

    const tokenSource = fs.readFileSync(path.join(root, 'server/src/auth/token.ts'), 'utf8');
    const allowlistBlock = tokenSource.match(
      /VISITOR_ALLOWLIST[^=]*=\s*\[[\s\S]*?\n\s*\];/,
    );
    if (!allowlistBlock) {
      failures.push('visitor allowlist block not found in server/src/auth/token.ts');
    } else {
      for (const forbidden of ['/hls/', '/api/stream/', '/api/category', '/api/agent']) {
        if (allowlistBlock[0].includes(forbidden)) {
          failures.push(`visitor allowlist exposes protected route ${forbidden}`);
        }
      }
    }

    const metadataFiles = [];
    walk(path.join(root, 'server/src/metadata'), (target) => {
      if (/\.(?:[cm]?[jt]sx?)$/.test(target)) metadataFiles.push(target);
    });

    for (const file of metadataFiles) {
      const relative = path.relative(root, file);
      const content = fs.readFileSync(file, 'utf8');
      const codeOnly = stripComments(content);
      for (const forbidden of ['credentials', 'cookie', 'set-cookie', 'login']) {
        if (new RegExp(forbidden.replace(/-/g, '\\-'), 'i').test(codeOnly)) {
          failures.push(`metadata code contains forbidden string ${forbidden} in ${relative}`);
        }
      }
      if (/TvwikiClient/.test(codeOnly)) {
        failures.push(`TvwikiClient import/usage found in ${relative} (cookie jar forbidden)`);
      }
      const allowedWriters = /(?:upsertWorkTitle|upsertWorkOverview|upsertWorkPoster|upsertMeta|setGenres)\s*\(/g;
      const withoutAllowed = codeOnly.replace(allowedWriters, '');
      for (const forbidden of [/upsertUnit\s*\(/, /addAsset\s*\(/, /upsertWork\s*\(/, /bindSource\s*\(/]) {
        if (forbidden.test(withoutAllowed)) {
          failures.push(`metadata code mutates library via ${forbidden.source} in ${relative}`);
        }
      }
      if (/fs\.writeFile(?:Sync)?/.test(codeOnly)) {
        failures.push(`metadata code writes files to disk (fs.writeFile/writeFileSync) in ${relative}`);
      }
    }

    const routesSource = fs.readFileSync(path.join(root, 'server/src/routes/index.ts'), 'utf8');
    const crawlBlock = routesSource.match(
      /if\s*\(role\s*===\s*'crawl'\)\s*\{[\s\S]*?\n[ ]{2}\}/,
    );
    const lookupPattern = /'\/api\/metadata\/lookup'/g;
    const lookupIndices = [];
    let match;
    while ((match = lookupPattern.exec(routesSource)) !== null) lookupIndices.push(match.index);
    if (lookupIndices.length === 0 || !crawlBlock) {
      failures.push('/api/metadata/lookup route registration not found in server/src/routes/index.ts');
    } else {
      const blockStart = crawlBlock.index;
      const blockEnd = crawlBlock.index + crawlBlock[0].length;
      for (const index of lookupIndices) {
        if (index < blockStart || index >= blockEnd) {
          failures.push('/api/metadata/lookup registered outside the crawl-role block in server/src/routes/index.ts');
        }
      }
    }
  }

  if (planSlug === 'openplex-emby-features') {
    const sourceFiles = [];
    for (const directory of ['client/src', 'server/src', 'shared']) {
      walk(path.join(root, directory), (target) => {
        if (/\.(?:[cm]?[jt]sx?)$/.test(target)) sourceFiles.push(target);
      });
    }
    const sources = sourceFiles.map((file) => ({
      file: path.relative(root, file),
      content: fs.readFileSync(file, 'utf8'),
    }));
    const allSource = sources.map(({ content }) => content).join('\n');

    const authenticationPatterns = [
      /\b(?:authenticate|authenticationMiddleware|authMiddleware)\b/i,
      /\b(?:passport|jsonwebtoken|jwtVerify|verifyToken)\b/i,
      /(?:authorization|bearer)\s*(?:header|token|scheme)?/i,
    ];
    if (authenticationPatterns.some((pattern) => pattern.test(allSource))) {
      failures.push('authentication middleware or token enforcement code found');
    }

    const chartPackages = [
      'chart.js',
      'echarts',
      'highcharts',
      'recharts',
      'victory',
      'apexcharts',
      'nivo',
      'plotly.js',
      'd3',
    ];
    for (const [manifest, dependencies] of manifestDependencies) {
      for (const dependency of chartPackages) {
        if (dependency in dependencies || Object.keys(dependencies).some((name) => name.startsWith(`@${dependency}/`))) {
          failures.push(`chart library dependency ${dependency} in ${manifest}`);
        }
      }
    }

    const cardFiles = sources.filter(({ file }) => /(?:Media|Poster)Card\.[jt]sx?$/.test(file));
    for (const { file, content } of cardFiles) {
      if (/\bfetch\s*\(|\bapi\.[A-Za-z_$][\w$]*\s*\(/.test(content)) {
        failures.push(`per-card fetch pattern found in ${file}`);
      }
    }

    const genrePattern = /\bgenres?\b/i;
    for (const { file, content } of sources) {
      if (genrePattern.test(content)) failures.push(`genre code found in ${file}`);
    }
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    const embySummary = planSlug === 'openplex-emby-features'
      ? ', auth middleware, chart libraries, per-card fetches, or genre code'
      : '';
    console.log(
      `Scope audit passed for ${planSlug}: no native mobile, torrent/P2P, open-relay, external-bind${embySummary} additions found.`,
    );
  }
}
