#!/usr/bin/env node
/**
 * Build a spot-check workbook: a person reviews the classifier's labels and marks each right or wrong.
 *
 * Usage:
 *   node scripts/make_spotcheck_sheet.js --ids ../reading/one_star_reading_set_A.csv [--provider jev] [--n 50]
 *   node scripts/make_spotcheck_sheet.js --random 30 --seed round2 --exclude ../reading/one_star_reading_set_A.csv --tag round2
 * Output: validation/spotcheck_<provider>.xlsx
 * Score it with: node scripts/spotcheck_report.js
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, k, i, a) => (k.startsWith('--') ? [...acc, [k.slice(2), a[i + 1]]] : acc), []));
const APP = args.app || 'com.moveinsync.ets', PROVIDER = args.provider || 'jev', N = Number(args.n || args.random || 50);
const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'taxonomy.json'), 'utf8'));
const jsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const store = new Map(jsonl(path.join(ROOT, 'data', 'store', `${APP}.jsonl`)).map(r => [r.reviewId, r]));
const labels = new Map(jsonl(path.join(ROOT, 'data', 'labels', `${APP}.${PROVIDER}.jsonl`)).map(l => [l.reviewId, l]));

let ids;
if (args.ids) ids = [...new Set(fs.readFileSync(path.resolve(args.ids), 'utf8').match(/gp:[A-Za-z0-9_\-]+|[0-9a-f]{8}-[0-9a-f-]{27}/g) || [])];
else ids = [...labels.keys()].map(id => [crypto.createHash('sha256').update((args.seed || 'spot') + id).digest('hex'), id]).sort().map(x => x[1]);
const exclude = new Set(args.exclude ? fs.readFileSync(path.resolve(args.exclude), 'utf8').match(/gp:[A-Za-z0-9_\-]+|[0-9a-f]{8}-[0-9a-f-]{27}/g) || [] : []);
ids = ids.filter(id => labels.has(id) && store.has(id) && !exclude.has(id)).slice(0, N);

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Check', { views: [{ state: 'frozen', ySplit: 1 }] });
const lists = wb.addWorksheet('Lists', { state: 'hidden' });
const guide = wb.addWorksheet('Guide');
const issueKeys = Object.keys(TAX.issues), causeKeys = Object.keys(TAX.causes);
lists.getColumn(1).values = ['issue', ...issueKeys];
lists.getColumn(2).values = ['cause', ...causeKeys];
lists.getColumn(3).values = ['yn', 'y', 'n'];

ws.columns = [
  { header: '#', key: 'n', width: 5 }, { header: 'reviewId', key: 'id', width: 12 }, { header: 'stars', key: 'stars', width: 6 },
  { header: 'review text', key: 'text', width: 70 },
  { header: 'model issue', key: 'issue', width: 26 }, { header: 'issue right? (y/n)', key: 'issue_ok', width: 10 }, { header: 'correct issue (if n)', key: 'issue_fix', width: 24 },
  { header: 'model cause', key: 'cause', width: 15 }, { header: 'cause right? (y/n, optional)', key: 'cause_ok', width: 12 }, { header: 'correct cause (if n)', key: 'cause_fix', width: 16 },
  { header: 'notes (optional)', key: 'notes', width: 30 },
];
ids.forEach((id, i) => { const r = store.get(id), l = labels.get(id); ws.addRow({ n: i + 1, id, stars: r.score, text: r.text, issue: l.primary, cause: l.cause }); });
ws.getRow(1).font = { bold: true };
ws.getColumn('text').alignment = { wrapText: true, vertical: 'top' };
const last = ids.length + 1;
const dv = (c, ref) => { for (let row = 2; row <= last; row++) { const cell = ws.getCell(`${c}${row}`); cell.dataValidation = { type: 'list', allowBlank: true, formulae: [ref] }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }; } };
dv('F', 'Lists!$C$2:$C$3'); dv('G', `Lists!$A$2:$A$${issueKeys.length + 1}`);
dv('I', 'Lists!$C$2:$C$3'); dv('J', `Lists!$B$2:$B$${causeKeys.length + 1}`);

guide.columns = [{ header: 'field', width: 22 }, { header: 'value', width: 26 }, { header: 'meaning', width: 110 }];
guide.getRow(1).font = { bold: true };
guide.addRow(['HOW TO CHECK', '', 'For each review: is the model issue the main thing the reviewer is upset about? Type y, or n and pick the right one. If two answers are both defensible, mark y and write "ambiguous" in notes. Cause is optional.']);
for (const k of issueKeys) guide.addRow(['issue', k, `${TAX.issues[k].label}: ${TAX.issues[k].description}`]);
for (const k of causeKeys) guide.addRow(['cause', k, TAX.causes[k]]);
guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

const out = path.join(ROOT, 'validation', `spotcheck_${PROVIDER}${args.tag ? '_' + args.tag : ''}.xlsx`);
if (fs.existsSync(out) && !('overwrite' in args)) { console.error(`${path.relative(ROOT, out)} already exists (it may hold someone's checks). Use --tag <name> for a new sheet, or --overwrite true.`); process.exit(2); }
fs.mkdirSync(path.dirname(out), { recursive: true });
await wb.xlsx.writeFile(out);
console.log(`Wrote ${path.relative(ROOT, out)} with ${ids.length} reviews labelled by ${PROVIDER}`);
