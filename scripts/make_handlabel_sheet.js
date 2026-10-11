#!/usr/bin/env node
/**
 * Build the hand-labelling workbook used to validate the classifier.
 *
 * Sample = reviews listed in --include (e.g. the one-star reading set already read by hand)
 *        + a random draw from the classifier's scope (1-3 stars, or 4-5 stars with 15+ words, last --days days)
 *          up to --n reviews in total. Seeded, so the same command gives the same sample.
 *
 * Usage:
 *   node scripts/make_handlabel_sheet.js --include ../reading/one_star_reading_set_A.csv --n 100
 * Output: validation/handlabels.xlsx  (dropdowns limited to the taxonomy; a Guide sheet explains each value)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, k, i, a) => (k.startsWith('--') ? [...acc, [k.slice(2), a[i + 1]]] : acc), []));
const N = Number(args.n || 100), DAYS = Number(args.days || 365), APP = args.app || 'com.moveinsync.ets', SEED = args.seed || 'moveinsync-2026';
const OUT = path.join(ROOT, 'validation', 'handlabels.xlsx');

const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'taxonomy.json'), 'utf8'));
const store = fs.readFileSync(path.join(ROOT, 'data', 'store', `${APP}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const byId = new Map(store.map(r => [r.reviewId, r]));
const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;

const included = args.include ? [...new Set(fs.readFileSync(path.resolve(args.include), 'utf8').match(/gp:[A-Za-z0-9_\-]+|[0-9a-f]{8}-[0-9a-f-]{27}/g) || [])].filter(id => byId.has(id)) : [];
const newest = store.reduce((m, r) => (r.date > m ? r.date : m), '');
const since = new Date(new Date(newest).getTime() - DAYS * 864e5).toISOString();
const scope = store.filter(r => r.date >= since && (r.score <= 3 || words(r.text) >= 15) && !included.includes(r.reviewId));
// deterministic shuffle: sort by hash(seed + id)
const draw = scope.map(r => [crypto.createHash('sha256').update(SEED + r.reviewId).digest('hex'), r]).sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1]).slice(0, Math.max(0, N - included.length));
const sample = [...included.map(id => ({ r: byId.get(id), source: 'reading_set_A' })), ...draw.map(r => ({ r, source: 'random_scope' }))];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Label', { views: [{ state: 'frozen', ySplit: 1 }] });
const lists = wb.addWorksheet('Lists', { state: 'hidden' });
const guide = wb.addWorksheet('Guide');

const issueKeys = Object.keys(TAX.issues), causeKeys = Object.keys(TAX.causes), yn = ['yes', 'no'];
lists.getColumn(1).values = ['issue', ...issueKeys];
lists.getColumn(2).values = ['cause', ...causeKeys];
lists.getColumn(3).values = ['severity', 0, 1, 2, 3];
lists.getColumn(4).values = ['yn', ...yn];

ws.columns = [
  { header: '#', key: 'n', width: 5 },
  { header: 'reviewId', key: 'id', width: 14 },
  { header: 'source', key: 'source', width: 13 },
  { header: 'stars', key: 'stars', width: 6 },
  { header: 'date', key: 'date', width: 11 },
  { header: 'version', key: 'version', width: 9 },
  { header: 'review text', key: 'text', width: 70 },
  { header: 'primary issue', key: 'primary', width: 24 },
  { header: 'cause', key: 'cause', width: 15 },
  { header: 'severity 0-3', key: 'severity', width: 11 },
  { header: 'escalation failure?', key: 'escalation_failure', width: 11 },
  { header: 'employer / policy?', key: 'mentions_employer_or_policy', width: 11 },
  { header: 'recent update?', key: 'mentions_recent_update', width: 11 },
  { header: 'safety concern?', key: 'safety_concern', width: 11 },
  { header: 'notes (optional)', key: 'notes', width: 30 },
];
sample.forEach(({ r, source }, i) => ws.addRow({ n: i + 1, id: r.reviewId, source, stars: r.score, date: (r.date || '').slice(0, 10), version: r.version, text: r.text }));
ws.getRow(1).font = { bold: true };
ws.getColumn('text').alignment = { wrapText: true, vertical: 'top' };
const dv = (col, ref) => { for (let row = 2; row <= sample.length + 1; row++) ws.getCell(`${col}${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Not a valid value', error: 'Pick a value from the dropdown (see the Guide sheet).' }; };
dv('H', `Lists!$A$2:$A$${issueKeys.length + 1}`);
dv('I', `Lists!$B$2:$B$${causeKeys.length + 1}`);
dv('J', 'Lists!$C$2:$C$5');
for (const c of ['K', 'L', 'M', 'N']) dv(c, 'Lists!$D$2:$D$3');
for (const c of ['H', 'I', 'J', 'K', 'L', 'M', 'N']) for (let row = 2; row <= sample.length + 1; row++) ws.getCell(`${c}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } };

guide.columns = [{ header: 'field', width: 26 }, { header: 'value', width: 26 }, { header: 'meaning', width: 110 }];
guide.getRow(1).font = { bold: true };
guide.addRow(['HOW TO LABEL', '', 'Fill the yellow cells using the dropdowns. Label what the review says, not what you think really happened. One primary issue per review: the thing the reviewer is most upset about. Do not look at any model output while labelling.']);
for (const k of issueKeys) guide.addRow(['primary issue', k, `${TAX.issues[k].label}: ${TAX.issues[k].description}`]);
for (const k of causeKeys) guide.addRow(['cause', k, TAX.causes[k]]);
TAX.severity.forEach((s, i) => guide.addRow(['severity', i, s]));
for (const [k, v] of Object.entries(TAX.flags)) guide.addRow([`${k} (yes/no)`, '', v]);
guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${sample.length} reviews (${included.length} from --include, ${draw.length} random from ${scope.length} in scope)`);
