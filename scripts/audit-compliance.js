import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planSlug = process.argv[2] ?? 'openplex-web';

const plans = {
  'openplex-web': {
    evidence: [
      'task-1-scaffold.txt',
      'task-2-client.txt',
      'task-3-parsers.txt',
      'task-4-spike.txt',
      'task-5-level7.txt',
      'task-6-gateway.txt',
      'task-7-store.txt',
      'task-8-routes.txt',
      'task-9-ui.txt',
      'task-10-player.txt',
      'task-11-e2e.txt',
    ],
    implementation: [
      'server/src/index.ts',
      'client/src/App.tsx',
      'client/test/live-flow.spec.ts',
      'playwright.config.ts',
    ],
  },
  'openplex-media-library': {
    evidence: [
      'task-1.txt',
      'task-2.txt',
      'task-3.txt',
      'task-4.txt',
      'task-5.txt',
      'task-6.txt',
      'task-7.txt',
      'task-8.txt',
    ],
    implementation: [
      'server/src/auth/token.ts',
      'server/src/routes/settings.ts',
      'client/src/pages/LibraryPage.tsx',
      'client/test/library-public.spec.ts',
    ],
  },
  'openplex-library-ux-meta': {
    evidence: Array.from({ length: 9 }, (_, index) => `task-${index + 1}.txt`),
    implementation: [
      'server/src/metadata/providers/types.ts',
      'server/src/agent/deepseek.ts',
      'client/src/pages/LibraryPage.tsx',
      'client/test/library-public.spec.ts',
    ],
  },
  'openplex-emby-features': {
    evidence: Array.from({ length: 11 }, (_, index) => `task-${index + 1}.txt`),
    implementation: [
      'server/src/index.ts',
      'client/src/App.tsx',
      'client/test/profile-flow.spec.ts',
      'playwright.config.ts',
    ],
  },
};

const plan = plans[planSlug];
if (!plan) {
  console.error(`Unknown plan slug: ${planSlug}`);
  console.error(`Supported plans: ${Object.keys(plans).join(', ')}`);
  process.exitCode = 1;
} else {
  const evidenceDir = path.join(root, '.omo', 'evidence', planSlug);
  const failures = [];

  for (const file of plan.evidence) {
    const target = path.join(evidenceDir, file);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      failures.push(`missing or empty evidence: ${path.relative(root, target)}`);
    }
  }

  for (const file of plan.implementation) {
    if (!fs.existsSync(path.join(root, file))) failures.push(`missing implementation: ${file}`);
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `Compliance audit passed for ${planSlug}: ${plan.evidence.length} non-empty task evidence files and integrated deliverables found.`,
    );
  }
}
