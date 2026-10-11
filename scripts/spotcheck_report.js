#!/usr/bin/env node
/**
 * Score a completed spot-check workbook.
 * Usage: node scripts/spotcheck_report.js [--provider jev]
 * Output: validation/spotcheck_<provider>_report.json (+ printed summary)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDER = process.argv.includes('--provider') ? process.argv[process.argv.indexOf('--provider') + 1] : 'jev';
const TAG = process.argv.includes('--tag') ? '_' + process.argv[process.argv.indexOf('--tag') + 1] : '';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.join(ROOT, 'validation', `spotcheck_${PROVIDER}${TAG}.xlsx`));
const ws = wb.getWorksheet('Check');
const head = ws.getRow(1).values.map(v => String(v ?? '').trim());
const get = (row, name) => { const v = row.getCell(head.indexOf(name)).value; return v == null || v === '' ? null : String(v).trim().toLowerCase(); };

const rows = [];
ws.eachRow((row, i) => { if (i > 1) rows.push({ id: get(row, 'reviewId'), text: row.getCell(head.indexOf('review text')).value, issue: get(row, 'model issue'), issueOk: get(row, 'issue right? (y/n)'), issueFix: get(row, 'correct issue (if n)'), cause: get(row, 'model cause'), causeOk: get(row, 'cause right? (y/n, optional)'), causeFix: get(row, 'correct cause (if n)'), notes: get(row, 'notes (optional)') }); });

const summarize = (okKey, fixKey, modelKey) => {
  const checked = rows.filter(r => r[okKey] === 'y' || r[okKey] === 'n');
  const wrong = checked.filter(r => r[okKey] === 'n');
  const confusions = {};
  for (const r of wrong) { const k = `${r[modelKey]} -> ${r[fixKey] ?? '?'}`; confusions[k] = (confusions[k] || 0) + 1; }
  return { checked: checked.length, correct: checked.length - wrong.length, pct: checked.length ? +(100 * (checked.length - wrong.length) / checked.length).toFixed(1) : null, confusions, wrong: wrong.map(r => ({ reviewId: r.id, model: r[modelKey], human: r[fixKey], notes: r.notes, text: r.text })) };
};
const report = { tag: TAG.slice(1) || 'round1', at: new Date().toISOString(), provider: PROVIDER, reviews: rows.length, issue: summarize('issueOk', 'issueFix', 'issue'), cause: summarize('causeOk', 'causeFix', 'cause'), ambiguous: rows.filter(r => (r.notes || '').includes('ambig')).length };
fs.writeFileSync(path.join(ROOT, 'validation', `spotcheck_${PROVIDER}${TAG}_report.json`), JSON.stringify(report, null, 2));
console.log(`Spot-check of ${PROVIDER}: issue correct ${report.issue.correct}/${report.issue.checked} (${report.issue.pct}%), cause correct ${report.cause.correct}/${report.cause.checked} (${report.cause.pct ?? '-'}%), marked ambiguous ${report.ambiguous}`);
for (const [k, v] of Object.entries(report.issue.confusions)) console.log(`  ${v}× ${k}`);
