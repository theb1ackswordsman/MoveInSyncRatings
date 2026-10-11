#!/usr/bin/env node
/**
 * Score each classifier against the hand labels in validation/handlabels.xlsx.
 *
 * For every provider that has labels (data/labels/<app>.<provider>.jsonl), reports per field:
 * agreement % with n, Cohen's kappa for primary issue and cause, and saves disagreement examples.
 *
 * Usage:
 *   node scripts/classify.js --provider jev --ids validation/handlabels.xlsx   (label the sample first; works for any provider)
 *   node scripts/evaluate.js
 * Output: validation/agreement.json and validation/disagreements.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : 'com.moveinsync.ets';
const FLAGS = ['escalation_failure', 'mentions_employer_or_policy', 'mentions_recent_update', 'safety_concern'];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.join(ROOT, 'validation', 'handlabels.xlsx'));
const ws = wb.getWorksheet('Label');
const head = ws.getRow(1).values.map(v => String(v ?? '').trim());
const col = name => head.indexOf(name);
const cell = (row, name) => { const v = row.getCell(col(name)).value; return v == null || v === '' ? null : String(typeof v === 'object' && v.result != null ? v.result : v).trim(); };

const human = new Map();
ws.eachRow((row, i) => {
  if (i === 1) return;
  const primary = cell(row, 'primary issue');
  if (!primary) return; // unlabelled rows are skipped, not counted
  const yn = v => (v == null ? null : v.toLowerCase() === 'yes');
  human.set(cell(row, 'reviewId'), {
    text: cell(row, 'review text'), stars: cell(row, 'stars'), primary, cause: cell(row, 'cause'),
    severity: cell(row, 'severity 0-3') == null ? null : Number(cell(row, 'severity 0-3')),
    escalation_failure: yn(cell(row, 'escalation failure?')), mentions_employer_or_policy: yn(cell(row, 'employer / policy?')),
    mentions_recent_update: yn(cell(row, 'recent update?')), safety_concern: yn(cell(row, 'safety concern?')),
  });
});
if (!human.size) { console.error('No hand labels found yet: fill the "primary issue" column in validation/handlabels.xlsx.'); process.exit(2); }

function kappa(pairs) {
  const n = pairs.length; if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const cats = [...new Set(pairs.flat())];
  const pe = cats.reduce((s, c) => s + (pairs.filter(p => p[0] === c).length / n) * (pairs.filter(p => p[1] === c).length / n), 0);
  return pe === 1 ? 1 : +((po - pe) / (1 - pe)).toFixed(3);
}

const report = { at: new Date().toISOString(), handLabelled: human.size, providers: {} };
const disagreements = [];
const files = fs.existsSync(path.join(ROOT, 'data', 'labels')) ? fs.readdirSync(path.join(ROOT, 'data', 'labels')).filter(f => f.startsWith(APP + '.') && f.endsWith('.jsonl')) : [];
for (const f of files) {
  const provider = f.slice(APP.length + 1, -'.jsonl'.length);
  const labels = new Map(fs.readFileSync(path.join(ROOT, 'data', 'labels', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(l => [l.reviewId, l]));
  const both = [...human.keys()].filter(id => labels.has(id));
  if (!both.length) { report.providers[provider] = { note: 'no overlap with hand-labelled sample; run classify.js --ids validation/handlabels.xlsx' }; continue; }
  const field = (name, get) => {
    const pairs = both.map(id => [human.get(id)[name], get(labels.get(id))]).filter(([h]) => h != null);
    const agree = pairs.filter(([a, b]) => a === b).length;
    return { n: pairs.length, agree, pct: pairs.length ? +(100 * agree / pairs.length).toFixed(1) : null, pairs };
  };
  const res = {
    model: labels.get(both[0]).model, overlap: both.length,
    primary: field('primary', l => l.primary),
    cause: field('cause', l => l.cause),
    severity: field('severity', l => l.severity),
    severity_within_1: (() => { const p = both.map(id => [human.get(id).severity, labels.get(id).severity]).filter(([h]) => h != null); const a = p.filter(([x, y]) => Math.abs(x - y) <= 1).length; return { n: p.length, agree: a, pct: p.length ? +(100 * a / p.length).toFixed(1) : null }; })(),
    ...Object.fromEntries(FLAGS.map(fl => [fl, field(fl, l => l.flags[fl])])),
  };
  res.primary.kappa = kappa(res.primary.pairs);
  res.cause.kappa = kappa(res.cause.pairs);
  for (const id of both) {
    const h = human.get(id), l = labels.get(id);
    if (h.primary !== l.primary) disagreements.push({ provider, reviewId: id, stars: h.stars, human_primary: h.primary, model_primary: l.primary, model_confidence: l.primaryConfidence ?? '', text: h.text });
  }
  for (const k of Object.keys(res)) if (res[k]?.pairs) delete res[k].pairs;
  report.providers[provider] = res;
  console.log(`\n${provider} (${res.model}) — ${both.length} reviews compared`);
  for (const [k, v] of Object.entries(res)) if (v && typeof v === 'object' && 'pct' in v) console.log(`  ${k.padEnd(28)} ${String(v.pct).padStart(5)}%  (${v.agree}/${v.n})${v.kappa != null ? `  kappa ${v.kappa}` : ''}`);
}

fs.writeFileSync(path.join(ROOT, 'validation', 'agreement.json'), JSON.stringify(report, null, 2));
const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(ROOT, 'validation', 'disagreements.csv'), '﻿' + ['provider,reviewId,stars,human_primary,model_primary,model_confidence,text', ...disagreements.map(d => [d.provider, d.reviewId, d.stars, d.human_primary, d.model_primary, d.model_confidence, d.text].map(esc).join(','))].join('\n'));
console.log(`\nHand-labelled reviews: ${human.size}. Saved validation/agreement.json and validation/disagreements.csv (${disagreements.length} primary-issue disagreements).`);
