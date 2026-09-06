import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runAudit } from '../../scripts/audit-source-ads.mjs';
import { candidateStatus, compileRules, createBudget, downloadSegment, observeMedia,
  pruneState, reviewCandidate, sha256, titleId } from './core.mjs';
import { atomicJson, openStore, readSnapshot } from './store.mjs';
import { loadBaseline, validateRules } from './rule-gate.mjs';

const SAMPLE_TITLES = [
  { keyword: 'X战警', title: 'X战警：天启' }, { keyword: '飞驰人生2', title: '飞驰人生2' },
  { keyword: '流浪地球2', title: '流浪地球2' }, { keyword: '热辣滚烫', title: '热辣滚烫' },
  { keyword: '长安三万里', title: '长安三万里' }, { keyword: '抓娃娃', title: '抓娃娃' }
];

export function parseArgs(args) {
  const command = args[0];
  const permitted = {
    once: ['--data', '--sources', '--queries'], watch: ['--data', '--sources', '--queries', '--interval-hours'],
    status: ['--data'], review: ['--data', '--id', '--verdict', '--confirm-content-review'], export: ['--data']
  };
  if (!permitted[command]) throw new Error('Unknown observer command');
  const options = { command };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (!permitted[command].includes(flag) || Object.hasOwn(options, flag)) throw new Error('Invalid argument');
    if (flag === '--confirm-content-review') options[flag] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value');
      options[flag] = value;
    }
  }
  if (!options['--data']) throw new Error('Private data directory is required');
  if (options['--interval-hours'] && (!/^\d+$/.test(options['--interval-hours']) ||
    Number(options['--interval-hours']) < 1 || Number(options['--interval-hours']) > 168)) throw new Error('Interval must be 1-168 hours');
  if (command === 'review' && (!/^[a-f0-9]{64}$/.test(options['--id'] || '') ||
    !['ad', 'content', 'uncertain'].includes(options['--verdict']) || !options['--confirm-content-review'])) throw new Error('Explicit content review required');
  return options;
}

export async function runCycle(store, { sources, queries, signal, audit = runAudit, read } = {}) {
  const now = new Date();
  pruneState(store.state, now);
  await store.collectExpiredEvidence();
  const rules = compileRules(store.state, await loadBaseline(), now);
  const budget = createBudget();
  const offset = queries ? store.state.runs : Math.floor(store.state.runs / (SAMPLE_TITLES.length / 2));
  const sample = queries || [SAMPLE_TITLES[(store.state.runs * 2) % SAMPLE_TITLES.length],
    SAMPLE_TITLES[(store.state.runs * 2 + 1) % SAMPLE_TITLES.length]];
  const deadline = AbortSignal.timeout(10 * 60 * 1000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const report = await audit({ sources, queries: sample, signal: bounded,
    onMedia: media => observeMedia(media, { state: store.state, budget, rules, offset,
      read: read || ((url, b) => downloadSegment(url, b, { signal: bounded })),
      saveEvidence: store.saveEvidence, now }) });
  store.state.runs++;
  const summary = { createdAt: now.toISOString(), status: bounded.aborted ? 'interrupted' : 'completed',
    scope: report.scope, sampledCases: report.rows.length, bytesBudgeted: budget.bytes,
    segmentRequests: budget.requests, budgetExhausted: budget.exhausted,
    sources: report.rows.map(row => ({ source: row.source, titleId: titleId(row.title), status: row.status,
      lines: row.lines.map(line => ({ index: line.index, status: line.status, observation: line.observation })) })),
    candidates: Object.values(store.state.candidates).map(entry => ({ id: entry.id,
      status: candidateStatus(entry, rules), evidenceAvailable: Boolean(entry.evidenceDigest),
      titles: new Set(entry.observations.map(o => o.titleId)).size })) };
  store.state.lastRun = summary;
  await store.save();
  await atomicJson(path.join(store.directory, 'report.json'), summary);
  return summary;
}

export async function exportRelease(store) {
  const rules = compileRules(store.state, await loadBaseline());
  const validation = await validateRules(rules);
  const version = sha256(JSON.stringify(rules));
  const release = { schema: 1, version, createdAt: new Date().toISOString(), rules, validation };
  const directory = path.join(store.directory, 'releases', version);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const javascript = '// Reviewed content fingerprints. Unknown material never authorizes skipping.\n' +
    `window.OpenStreamAdRules = ${JSON.stringify(rules, null, 2)};\n`;
  // Content-addressed outputs are reproducible; they never modify the website or deploy it.
  await fs.writeFile(path.join(directory, 'ad-rules.js'), javascript, { mode: 0o600 });
  await atomicJson(path.join(directory, 'release.json'), release);
  return { version, directory, validation };
}

export async function main(args) {
  const options = parseArgs(args);
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.on('SIGINT', onStop); process.on('SIGTERM', onStop);
  let store;
  try {
    if (options.command === 'status') {
      const snapshot = await readSnapshot(options['--data']);
      const baseline = await loadBaseline();
      console.log(JSON.stringify({ runs: snapshot.runs, lastRun: snapshot.lastRun,
        candidates: Object.values(snapshot.candidates).map(entry => ({ id: entry.id,
          status: candidateStatus(entry, baseline), review: entry.review?.verdict || 'pending', evidenceAvailable: Boolean(entry.evidenceDigest),
          observations: entry.observations.length })) }, null, 2));
      return;
    }
    store = await openStore(options['--data']);
    if (options.command === 'review') {
      const entry = store.state.candidates[options['--id']];
      if (!entry) throw new Error('Candidate not found');
      const digest = await store.verifyEvidence(entry);
      const now = new Date();
      reviewCandidate(entry, { verdict: options['--verdict'], evidenceDigest: digest,
        reviewedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString() });
      await store.save();
      console.log(JSON.stringify({ id: entry.id, verdict: entry.review.verdict, deployed: false }));
    } else if (options.command === 'export') {
      console.log(JSON.stringify(await exportRelease(store), null, 2));
    } else {
      const queries = options['--queries'] ? JSON.parse(await fs.readFile(options['--queries'], 'utf8')) : undefined;
      do {
        const summary = await runCycle(store, { sources: options['--sources']?.split(','), queries, signal: stop.signal });
        console.log(JSON.stringify({ status: summary.status, sampledCases: summary.sampledCases,
          candidates: summary.candidates.length, segmentRequests: summary.segmentRequests, budgetExhausted: summary.budgetExhausted }));
        if (options.command !== 'watch' || stop.signal.aborted) break;
        // No overlap or catch-up storm: schedule from completion, not from the previous start.
        await sleep(Number(options['--interval-hours'] || 6) * 3600000, null, { signal: stop.signal });
      } while (!stop.signal.aborted);
    }
  } catch (error) {
    if (!stop.signal.aborted) throw error;
  } finally {
    if (store) await store.close();
    process.off('SIGINT', onStop); process.off('SIGTERM', onStop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('Usage: npm run ads:observe -- once|watch|status|review|export --data /absolute/private/directory\n' +
    'once/watch: --sources bfzy,zy360 --queries /path/to/title-samples.json\nwatch: --interval-hours 6\n' +
    'review: --id <candidate SHA256> --verdict ad|content|uncertain --confirm-content-review');
  else main(process.argv.slice(2)).catch(() => {
    // Upstream exception text can contain signed URLs. Keep logs operational only.
    console.error('Observer failed. Check private directory permissions, lock, arguments and local state.');
    process.exitCode = 1;
  });
}
