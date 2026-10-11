#!/usr/bin/env node
/**
 * Build the "How are our Play Store ratings?" brief — rerunnable, compares itself to the previous run.
 *
 * Reads: data/store, data/labels (jev > llm > rules), data/meta snapshots, config/taxonomy.json, config/playbook.json
 * Writes (dated by the newest review, so reruns on the same data overwrite the same folder):
 *   reports/<date>/metrics.json       numbers used everywhere below; the next run diffs against it
 *   reports/<date>/brief.md           the brief as Markdown
 *   reports/<date>/action_queue.csv   ranked, ticket-ready issues (Jira-importable columns)
 *   docs/data/brief.js(.json)         data for the live page docs/index.html (a prebuilt React app; rebuild only when the UI changes: npm run site:build)
 *
 * Usage: node scripts/report.js [--app com.moveinsync.ets] [--provider jev]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Windows locks files open in Excel; never let that abort a run. Writes to "<name> (new).<ext>" instead and warns.
function safeWrite(file, content) {
  try { fs.writeFileSync(file, content); return file; }
  catch (e) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
    const alt = file.replace(/(\.[^.\/\\]+)$/, ' (new)$1');
    fs.writeFileSync(alt, content);
    console.warn(`! ${path.basename(file)} is open in another program (probably Excel), so this run saved ${path.basename(alt)} instead. Close the file and run again to update it.`);
    return alt;
  }
}
const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const APP = arg('app', 'com.moveinsync.ets');
const DAY = 864e5;

// ---------- load ----------
const jsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'taxonomy.json'), 'utf8'));
const PLAY = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'playbook.json'), 'utf8'));
const reviews = jsonl(path.join(ROOT, 'data', 'store', `${APP}.jsonl`)).map(r => ({ ...r, t: Date.parse(r.date) }));
if (!reviews.length) { console.error('No reviews stored. Run npm run scrape first.'); process.exit(2); }
const provider = arg('provider', ['jev', 'llm', 'rules'].find(p => fs.existsSync(path.join(ROOT, 'data', 'labels', `${APP}.${p}.jsonl`))));
// Only labels made with the CURRENT taxonomy count; older ones would mix two category definitions.
const crypto = await import('node:crypto');
const TAX_VERSION = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'config', 'taxonomy.json'), 'utf8')).digest('hex').slice(0, 10);
const allLabels = jsonl(path.join(ROOT, 'data', 'labels', `${APP}.${provider}.jsonl`));
const labels = new Map(allLabels.filter(l => l.taxonomyVersion === TAX_VERSION).map(l => [l.reviewId, l]));
const staleLabels = allLabels.length - labels.size;
if (staleLabels) console.warn(`Note: ${staleLabels} labels were made with an older taxonomy and are ignored. Run npm run classify to relabel them.`);
const metaDir = path.join(ROOT, 'data', 'meta', APP);
const metaFiles = fs.existsSync(metaDir) ? fs.readdirSync(metaDir).filter(f => f.endsWith('.json')).sort() : [];
const metaNow = metaFiles.length ? JSON.parse(fs.readFileSync(path.join(metaDir, metaFiles.at(-1)), 'utf8')) : null;
const spot = ['spotcheck_jev_round2_report.json', 'spotcheck_jev_round1_report.json', 'spotcheck_jev_report.json'].map(f => path.join(ROOT, 'validation', f)).filter(fs.existsSync).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));

const asOf = Math.max(...reviews.map(r => r.t));
const asOfDate = new Date(asOf).toISOString().slice(0, 10);
// Reviews the classifier should have labelled (same scope as classify.js) but has not, e.g. when API credit ran out
const wordsOf = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
const unlabelled = reviews.filter(r => r.t > asOf - 365 * DAY && (r.score <= 3 || wordsOf(r.text) >= 15) && !labels.has(r.reviewId)).length;
if (unlabelled) console.warn(`Note: ${unlabelled} in-scope reviews have no label yet and are left out of issue shares. Run npm run classify (check API credit).`);
const within = (days, endDays = 0) => r => r.t > asOf - days * DAY && r.t <= asOf - endDays * DAY;
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
const mean = a => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null);
const lab = r => labels.get(r.reviewId);

// ---------- core metrics ----------
function stats(rs) {
  const low = rs.filter(r => r.score <= 2);
  return { n: rs.length, mean: mean(rs.map(r => r.score)), oneStarN: rs.filter(r => r.score === 1).length, oneStarPct: pct(rs.filter(r => r.score === 1).length, rs.length), lowN: low.length, lowRepliedN: low.filter(r => r.replyText).length, lowRepliedPct: pct(low.filter(r => r.replyText).length, low.length) };
}
const windows = { d7: stats(reviews.filter(within(7))), d30: stats(reviews.filter(within(30))), prev30: stats(reviews.filter(within(60, 30))), d90: stats(reviews.filter(within(90))), d365: stats(reviews.filter(within(365))) };

// weekly series (last 26 complete weeks ending at asOf)
const weekly = [];
for (let i = 25; i >= 0; i--) {
  const end = asOf - i * 7 * DAY, start = end - 7 * DAY;
  const rs = reviews.filter(r => r.t > start && r.t <= end);
  weekly.push({ weekEnding: new Date(end).toISOString().slice(0, 10), n: rs.length, oneStarN: rs.filter(r => r.score === 1).length, oneStarPct: pct(rs.filter(r => r.score === 1).length, rs.length) });
}

// issues among 1-2★ in last 90 days
const low90 = reviews.filter(within(90)).filter(r => r.score <= 2 && lab(r));
const low30 = low90.filter(within(30)), lowPrev60 = low90.filter(r => r.t <= asOf - 30 * DAY);
const withSignal90 = low90.filter(r => lab(r).primary !== 'no_signal');
const issueKeys = Object.keys(TAX.issues).filter(k => !['no_signal', 'praise'].includes(k));
const brand = /\b(samsung|galaxy|oneplus|one plus|pixel|vivo|oppo|redmi|xiaomi|realme|iqoo|motorola|moto|nokia|huawei|honor|nothing phone|iphone)\b|android ?(\d{2})/gi;
const issues = issueKeys.map(k => {
  const prim = low90.filter(r => lab(r).primary === k);
  const ment = low90.filter(r => lab(r).primary === k || (lab(r).issues || []).includes(k));
  const causes = {}; for (const r of prim) causes[lab(r).cause] = (causes[lab(r).cause] || 0) + 1;
  const topCause = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
  const versions = {}; for (const r of ment) if (r.version) versions[r.version] = (versions[r.version] || 0) + 1;
  const devices = {}; for (const r of ment) for (const m of (r.text || '').matchAll(brand)) { const d = m[0].toLowerCase().replace('one plus', 'oneplus').replace('galaxy', 'samsung'); devices[d] = (devices[d] || 0) + 1; }
  const p30 = low30.filter(r => lab(r).primary === k).length, pPrev = lowPrev60.filter(r => lab(r).primary === k).length;
  const sev = mean(ment.map(r => lab(r).severity));
  const conf = mean(prim.map(r => lab(r).primaryConfidence).filter(x => x != null));
  const examples = [...prim].sort((a, b) => (b.thumbsUp - a.thumbsUp) || ((b.text || '').length - (a.text || '').length)).filter(r => (r.text || '').split(/\s+/).length >= 6).slice(0, 3);
  const n = prim.length;
  return {
    issue: k, label: TAX.issues[k].label, owner: TAX.issues[k].owner, stage: PLAY[k]?.stage ?? '',
    primaryN90: n, mentionsN90: ment.length, shareOfLowWithSignalPct: pct(n, withSignal90.length),
    last30N: p30, last30Pct: pct(p30, low30.length), prior60N: pPrev, prior60Pct: pct(pPrev, lowPrev60.length),
    cause: topCause ? topCause[0] : 'unclear', causeSharePct: topCause ? pct(topCause[1], n) : null,
    meanSeverity: sev, meanConfidence: conf,
    affectedVersions: Object.entries(versions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c]) => `${v} (${c})`).join('; '),
    dateRange: ment.length ? `${new Date(Math.min(...ment.map(r => r.t))).toISOString().slice(0, 10)} to ${new Date(Math.max(...ment.map(r => r.t))).toISOString().slice(0, 10)}` : '',
    devices: Object.entries(devices).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, c]) => `${d} (${c})`).join('; '),
    confidence: n >= 20 && (conf ?? 1) >= 0.8 ? 'high' : n >= 10 ? 'medium' : 'low',
    // Priority: reviews where it is the main complaint, plus half-weight for secondary mentions, scaled by mean severity (0-3, centred on 2).
    priority: +((n + 0.5 * (ment.length - n)) * ((sev ?? 2) / 2)).toFixed(1),
    examples: examples.map(r => ({ id: r.reviewId, date: r.date.slice(0, 10), version: r.version, stars: r.score, text: r.text })),
  };
}).filter(x => x.mentionsN90 > 0).sort((a, b) => b.priority - a.priority);

// version flags: versions first seen in the last 120 days with n>=20 whose 1★ share is well above the rest of the year
const yr = reviews.filter(within(365));
const firstSeen = {}; for (const r of reviews) if (r.version && (!firstSeen[r.version] || r.t < firstSeen[r.version])) firstSeen[r.version] = r.t;
const versionFlags = Object.keys(firstSeen).filter(v => firstSeen[v] > asOf - 120 * DAY).map(v => {
  const rs = yr.filter(r => r.version === v), rest = yr.filter(r => r.version && r.version !== v);
  const p1 = rs.filter(r => r.score === 1).length / (rs.length || 1), p0 = rest.filter(r => r.score === 1).length / (rest.length || 1);
  const z = rs.length ? (p1 - p0) / Math.sqrt(p0 * (1 - p0) / rs.length) : 0;
  const lowRs = rs.filter(r => r.score <= 2 && lab(r));
  const crash = lowRs.filter(r => lab(r).primary === 'app_crash_or_wont_open' || (lab(r).issues || []).includes('app_crash_or_wont_open')).length;
  return { version: v, firstSeen: new Date(firstSeen[v]).toISOString().slice(0, 10), n: rs.length, oneStarPct: pct(rs.filter(r => r.score === 1).length, rs.length), baselineOneStarPct: +(100 * p0).toFixed(1), z: +z.toFixed(2), lowStarN: lowRs.length, crashMentionsN: crash, crashSharePct: pct(crash, lowRs.length) };
}).filter(v => v.n >= 20).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));

// reply rate history by quarter (1-2★)
const quarters = {};
for (const r of reviews.filter(within(4 * 365)).filter(r => r.score <= 2)) {
  const d = new Date(r.t); const q = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  (quarters[q] ??= { n: 0, replied: 0 }); quarters[q].n++; if (r.replyText) quarters[q].replied++;
}
const replyHistory = Object.entries(quarters).sort().map(([q, v]) => ({ quarter: q, lowStarN: v.n, repliedN: v.replied, repliedPct: pct(v.replied, v.n) }));

// unanswered critical reviews (1-2★, last 60 days, no reply)
const unanswered = reviews.filter(within(60)).filter(r => r.score <= 2 && !r.replyText);

const flagsCount = f => low90.filter(r => lab(r).flags?.[f]).length;
const metrics = {
  app: APP, asOf: asOfDate, generatedAt: new Date().toISOString(), labelProvider: provider, labelModel: labels.size ? [...labels.values()][0].model : null, taxonomyVersion: labels.size ? [...labels.values()][0].taxonomyVersion : null,
  store: metaNow ? { collectedAt: metaNow.collectedAt, score: metaNow.score, ratings: metaNow.ratings, reviews: metaNow.reviews, histogram: metaNow.histogram, version: metaNow.version, updated: metaNow.updated } : null,
  windows, weekly, low90: { n: low90.length, noSignalN: low90.length - withSignal90.length, withSignalN: withSignal90.length, escalationFailureN: flagsCount('escalation_failure'), employerPolicyN: flagsCount('mentions_employer_or_policy'), recentUpdateN: flagsCount('mentions_recent_update'), safetyN: flagsCount('safety_concern') },
  causeSplit90: Object.fromEntries(Object.keys(TAX.causes).map(c => [c, withSignal90.filter(r => lab(r).cause === c).length])),
  issues: issues.map(({ examples, ...x }) => x), versionFlags, replyHistory, unansweredCritical60dN: unanswered.length,
  labelCoverage: { current: labels.size, stale: staleLabels, unlabelled },
  validation: spot.map(s => ({ round: s.tag || 'round1', checked: s.issue.checked, correct: s.issue.correct, pct: s.issue.pct })),
};

// ---------- what changed since the previous report ----------
const reportsDir = path.join(ROOT, 'reports');
const prevDir = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter(d => d < asOfDate && fs.existsSync(path.join(reportsDir, d, 'metrics.json'))).sort().at(-1) : null;
const prev = prevDir ? JSON.parse(fs.readFileSync(path.join(reportsDir, prevDir, 'metrics.json'), 'utf8')) : null;
const changes = [];
if (prev) {
  const d = (a, b, unit = '', dp = 2) => (a == null || b == null ? 'n/a' : `${a >= b ? '+' : ''}${(a - b).toFixed(dp)}${unit}`);
  if (metrics.store && prev.store) changes.push(`Store rating ${prev.store.score?.toFixed(2)} → ${metrics.store.score?.toFixed(2)} (${d(metrics.store.score, prev.store.score)}); ratings ${prev.store.ratings} → ${metrics.store.ratings} (+${metrics.store.ratings - prev.store.ratings}); version ${prev.store.version} → ${metrics.store.version}.`);
  changes.push(`Written reviews, last 30 days: average ${prev.windows.d30.mean} → ${metrics.windows.d30.mean}; 1★ share ${prev.windows.d30.oneStarPct}% → ${metrics.windows.d30.oneStarPct}% (n ${prev.windows.d30.n} → ${metrics.windows.d30.n}).`);
  changes.push(`Developer replies to 1-2★ (last 30 days): ${prev.windows.d30.lowRepliedPct}% → ${metrics.windows.d30.lowRepliedPct}%.`);
  const prevIssues = Object.fromEntries((prev.issues || []).map(i => [i.issue, i]));
  for (const i of metrics.issues.slice(0, 6)) {
    const p = prevIssues[i.issue];
    if (!p) changes.push(`New in the top issues: ${i.label} (${i.primaryN90} reviews in 90 days).`);
    else if (Math.abs(i.primaryN90 - p.primaryN90) >= 3) changes.push(`${i.label}: ${p.primaryN90} → ${i.primaryN90} main-complaint reviews in the 90-day window.`);
  }
  const prevFlags = new Set((prev.versionFlags || []).filter(v => v.z >= 2).map(v => v.version));
  for (const v of versionFlags.filter(v => v.z >= 2 && !prevFlags.has(v.version))) changes.push(`Newly flagged version ${v.version}: 1★ ${v.oneStarPct}% vs ${v.baselineOneStarPct}% baseline (n=${v.n}).`);
}
metrics.changesSincePrevious = { previous: prev?.asOf ?? null, items: changes };

// ---------- write outputs ----------
const outDir = path.join(reportsDir, asOfDate);
fs.mkdirSync(outDir, { recursive: true });
safeWrite(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));

const clip = (t, n) => { t = String(t ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, t.lastIndexOf(' ', n) > n * 0.6 ? t.lastIndexOf(' ', n) : n) + '…' : t; };
const csvEsc = s => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const aqCols = ['rank', 'issue', 'stage', 'cause', 'owner', 'n_reviews_90d', 'share_of_low_star', 'trend_30v60', 'affected_versions', 'date_range', 'devices_os', 'confidence', 'first_diagnostic_check', 'missing_data', 'success_metric', 'example_review_ids', 'example_quotes', 'app_side_fix', 'mentions_90d', 'priority_score'];
const aqRows = issues.filter(i => i.issue !== 'other').map((i, idx) => [
  idx + 1, i.label, i.stage, `${i.cause}${i.causeSharePct != null ? ` (${i.causeSharePct}%)` : ''}`, i.owner, i.primaryN90,
  `${i.shareOfLowWithSignalPct}% of ${withSignal90.length}`, `last30 ${i.last30N}/${low30.length} (${i.last30Pct}%) vs prior60 ${i.prior60N}/${lowPrev60.length} (${i.prior60Pct}%)`,
  i.affectedVersions, i.dateRange, i.devices, i.confidence, PLAY[i.issue]?.first_diagnostic_check, PLAY[i.issue]?.missing_data, PLAY[i.issue]?.success_metric,
  i.examples.map(e => e.id).join(' '), i.examples.map(e => `[${e.date} v${e.version ?? "?"} ${e.stars}★] ${clip(e.text, 180)}`).join(' | '), PLAY[i.issue]?.app_side_fix, i.mentionsN90, i.priority,
]);
safeWrite(path.join(outDir, 'action_queue.csv'), '﻿' + [aqCols.join(','), ...aqRows.map(r => r.map(csvEsc).join(','))].join('\n'));

// Markdown brief
const s = metrics.store, w = metrics.windows;
const top = issues.filter(i => i.issue !== 'other').slice(0, 5);
const flagged = versionFlags.filter(v => v.z >= 2);
const lastReply = replyHistory;
const coverageNote = (staleLabels || unlabelled) ? `\n> **Incomplete labels:** ${staleLabels + unlabelled} in-scope reviews are not yet labelled with the current taxonomy and are left out of the issue shares until \`npm run classify\` labels them.\n` : '';
const md = `# How are our Play Store ratings? — ${asOfDate}

*${APP} · reviews up to ${asOfDate} · labels: ${provider} (${metrics.labelModel ?? 'n/a'}, taxonomy ${metrics.taxonomyVersion ?? 'n/a'})${metrics.validation.length ? ` · spot-check: ${metrics.validation.map(v => `${v.round} ${v.correct}/${v.checked}`).join(', ')}` : ''}*

${coverageNote}
## Headline
- **Store rating ${s ? `${s.score.toFixed(2)}★ from ${s.ratings.toLocaleString('en-IN')} ratings` : 'n/a'}**${s ? ` (version ${s.version}, collected ${s.collectedAt.slice(0, 10)})` : ''}.
- **Written reviews, last 30 days:** ${w.d30.n} reviews, average ${w.d30.mean}★, **${w.d30.oneStarPct}% are 1★** (prior 30 days: ${w.prev30.oneStarPct}%, n=${w.prev30.n}).
- **Developer replies to 1-2★ reviews, last 30 days: ${w.d30.lowRepliedN} of ${w.d30.lowN} (${w.d30.lowRepliedPct}%).** ${unanswered.length} critical reviews from the last 60 days have no reply.
${flagged.length ? `- **Version alert:** ${flagged.map(v => `${v.version} has ${v.oneStarPct}% 1★ vs ${v.baselineOneStarPct}% baseline (n=${v.n}); crash/won't-open in ${v.crashMentionsN} of ${v.lowStarN} low-star reviews`).join('; ')}.` : '- No version stands out from the baseline this run.'}

## What changed since the last run${prev ? ` (${prev.asOf})` : ''}
${prev ? (changes.length ? changes.map(c => `- ${c}`).join('\n') : '- No material changes.') : '- First run: nothing to compare yet. The next run will list changes here.'}

## Top issues in 1-2★ reviews (last 90 days)
${low90.length} low-star reviews; ${low90.length - withSignal90.length} had no usable detail and are left out of the shares below (n=${withSignal90.length}). Ranked by priority: main-complaint count plus half the other mentions, weighted by average severity.

| # | Issue | Owner | Main complaint | Mentioned | Last 30d vs prior 60d |
|---|---|---|---|---|---|
${top.map((i, n) => `| ${n + 1} | ${i.label} | ${i.owner} | ${i.primaryN90} (${i.shareOfLowWithSignalPct}%) | ${i.mentionsN90} | ${i.last30Pct}% vs ${i.prior60Pct}% |`).join('\n')}

${top.slice(0, 3).map(i => `**${i.label}**${i.examples[0] ? `: "${clip(i.examples[0].text, 220)}" (${i.examples[0].date}, v${i.examples[0].version ?? "?"}, ${i.examples[0].stars}★)` : ''}`).join('\n\n')}

## Who it's about (last 90 days, low-star reviews with detail)
App: ${metrics.causeSplit90.app} · Operations: ${metrics.causeSplit90.ops} · Employer rules: ${metrics.causeSplit90.employer_config} · Unclear: ${metrics.causeSplit90.unclear}

## Developer replies to 1-2★ reviews by quarter
${lastReply.map(q => `- ${q.quarter}: ${q.repliedN} of ${q.lowStarN} (${q.repliedPct}%)`).join('\n')}

## Files
- \`action_queue.csv\` — every issue ranked, with owner, first diagnostic check, success metric and example reviews.
- \`metrics.json\` — all numbers; the next run compares against it.

*Written reviews skew negative compared with silent star ratings, so their shares describe what unhappy users say, not all users. Public Android data only.*
`;
safeWrite(path.join(outDir, 'brief.md'), md);

// Data for the live page (docs/index.html is a prebuilt React app; it reads docs/data/brief.js, so weekly runs need no build)
const versionStrip = Object.keys(firstSeen).filter(v => firstSeen[v] > asOf - 200 * DAY).map(v => {
  const rs = yr.filter(r => r.version === v);
  const lowRs = rs.filter(r => r.score <= 2 && lab(r));
  const crash = lowRs.filter(r => lab(r).primary === 'app_crash_or_wont_open' || (lab(r).issues || []).includes('app_crash_or_wont_open')).length;
  const f = versionFlags.find(x => x.version === v);
  return { version: v, firstSeen: new Date(firstSeen[v]).toISOString().slice(0, 10), n: rs.length, oneStarN: rs.filter(r => r.score === 1).length, oneStarPct: pct(rs.filter(r => r.score === 1).length, rs.length), lowStarN: lowRs.length, crashMentionsN: crash, flagged: !!(f && f.z >= 2), z: f?.z ?? null };
}).filter(v => v.n >= 15).sort((x, y) => x.firstSeen.localeCompare(y.firstSeen));
const baseline1 = yr.length ? +(100 * yr.filter(r => r.score === 1).length / yr.length).toFixed(1) : null;

// Reply queue: drafts from data/replies (made by `npm run replies`), highest severity and newest first
const draftCache = new Map(jsonl(path.join(ROOT, 'data', 'replies', `${APP}.jsonl`)).map(d => [d.reviewId, d]));
const replyQueue = unanswered.map(r => ({ r, l: lab(r) })).sort((a, b) => ((b.l?.severity ?? 1) - (a.l?.severity ?? 1)) || b.r.date.localeCompare(a.r.date)).slice(0, 25).map(({ r, l }) => ({
  id: r.reviewId, date: r.date.slice(0, 10), stars: r.score, version: r.version, text: r.text, issue: l ? TAX.issues[l.primary]?.label : null, owner: l ? TAX.issues[l.primary]?.owner : null,
  severity: l?.severity ?? null, safety: !!l?.flags?.safety_concern, url: r.url, draft: draftCache.get(r.reviewId)?.text ?? null, draftKind: draftCache.get(r.reviewId)?.kind ?? null,
}));

// One-sentence verdict, rule-based so it is reproducible
const d30 = windows.d30.oneStarPct ?? 0, p30 = windows.prev30.oneStarPct ?? 0;
const direction = d30 - p30 >= 3 ? 'worse' : p30 - d30 >= 3 ? 'better' : 'steady';
const topIssue = issues.filter(i => i.issue !== 'other')[0];
const flaggedNow = versionFlags.filter(v => v.z >= 2).at(-1);
const verdict = {
  direction,
  headline: flaggedNow
    ? `${direction === 'better' ? 'Better overall, but' : direction === 'worse' ? 'Worse this month:' : 'Holding steady, but'} version ${flaggedNow.version} is hurting the rating.`
    : `${direction === 'worse' ? 'Worse this month.' : direction === 'better' ? 'Better this month.' : 'Holding steady.'} ${topIssue ? `${topIssue.label} is the top complaint.` : ''}`,
  detail: flaggedNow
    ? `${flaggedNow.oneStarPct}% of reviews on ${flaggedNow.version} are 1★ against ${flaggedNow.baselineOneStarPct}% for other versions (n=${flaggedNow.n}), and ${flaggedNow.crashMentionsN} of its ${flaggedNow.lowStarN} low-star reviews say the app crashes or will not open. ${topIssue ? `Across all versions, ${topIssue.label.toLowerCase()} leads the last 90 days.` : ''}`
    : `1★ share of written reviews is ${d30}% over the last 30 days against ${p30}% the 30 days before.`,
  firstMove: topIssue ? { owner: topIssue.owner, check: PLAY[topIssue.issue]?.first_diagnostic_check ?? '' } : null,
};

// Is it working? per-issue change against the previous report
const prevIssueMap = Object.fromEntries((prev?.issues || []).map(i => [i.issue, i]));
const tracking = issues.filter(i => i.issue !== 'other').slice(0, 8).map(i => ({ issue: i.label, owner: i.owner, now: i.primaryN90, before: prevIssueMap[i.issue]?.primaryN90 ?? null, successMetric: PLAY[i.issue]?.success_metric ?? '' }));

const pageData = {
  ...metrics,
  verdict, versionStrip, baselineOneStarPct: baseline1, replyQueue, tracking,
  issuesDetailed: issues.filter(i => i.issue !== 'other').map(i => ({ ...i, playbook: PLAY[i.issue] ?? {} })),
};
fs.mkdirSync(path.join(ROOT, 'docs', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'data', 'brief.js'), `window.__BRIEF__ = ${JSON.stringify(pageData).replace(/</g, '\\u003c')};\n`);
safeWrite(path.join(ROOT, 'docs', 'data', 'brief.json'), JSON.stringify(pageData, null, 2));
safeWrite(path.join(ROOT, 'docs', 'brief.md'), md);

console.log(`Report for ${asOfDate} (labels: ${provider}) → reports/${asOfDate}/ and docs/index.html`);
console.log(`  ${issues.length} issues ranked; ${flagged.length} version alert(s); ${unanswered.length} unanswered critical reviews; compared with: ${prev?.asOf ?? 'nothing (first run)'}`);
