#!/usr/bin/env node
/**
 * MoveInSync Play Store review collector — rerunnable.
 *
 * What it does on every run:
 *   1. Reads config/apps.json and scrapes every app with inScope=true.
 *   2. Saves app metadata (rating, histogram, version, "What's new", data safety,
 *      permissions) as a dated snapshot, so ratings can be compared run to run.
 *   3. Pulls reviews newest-first. The first run per app pulls full history; once a
 *      full pull has completed (recorded in data/state.json), runs are incremental: they stop once
 *      past the newest review already stored (minus an overlap window, so changed
 *      reviews and new developer replies are picked up). --full re-pulls everything.
 *   4. Saves the untouched API response under data/raw/<runId>/ (local only, gitignored:
 *      it contains reviewer names) and merges a cleaned copy into
 *      data/store/<appId>.jsonl (reviewer names replaced by a hash).
 *   5. Appends one line per run to data/runs.jsonl.
 *
 * Usage:
 *   node scripts/scrape.js                     # incremental run, all in-scope apps
 *   node scripts/scrape.js --full              # full history re-pull
 *   node scripts/scrape.js --apps com.moveinsync.ets
 *   node scripts/scrape.js --days 730          # lookback in days (default: historyDays in config/apps.json)
 *   node scripts/scrape.js --max 2000          # cap reviews per app per language (for quick tests)
 *   node scripts/scrape.js --overlap-days 30   # re-check window on incremental runs (default 30)
 *   node scripts/scrape.js --delay 1500        # ms between page requests (default 1500)
 */
import gplay from 'google-play-scraper';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

// ---------- args ----------
function parseArgs(argv) {
  const a = { full: false, apps: null, days: null, max: Infinity, overlapDays: 30, delay: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--full') a.full = true;
    else if (k === '--apps') a.apps = v().split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--days') a.days = Number(v());
    else if (k === '--max') a.max = Number(v());
    else if (k === '--overlap-days') a.overlapDays = Number(v());
    else if (k === '--delay') a.delay = Number(v());
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error(`Unknown argument: ${k}`); process.exit(2); }
  }
  return a;
}

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mkdirp = p => fs.mkdirSync(p, { recursive: true });
const writeJSON = (p, obj) => { mkdirp(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); };
const hash = s => (s ? crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12) : null);
const iso = d => (d ? new Date(d).toISOString() : null);

async function withRetry(label, fn, tries = 5) {
  let wait = 2000;
  for (let t = 1; ; t++) {
    try { return await fn(); }
    catch (e) {
      if (t >= tries) throw new Error(`${label} failed after ${tries} tries: ${e.message}`);
      console.warn(`  ! ${label}: ${e.message} — retry ${t}/${tries - 1} in ${wait / 1000}s`);
      await sleep(wait); wait *= 2;
    }
  }
}

function loadStore(file) {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    m.set(r.reviewId, r);
  }
  return m;
}

function saveStore(file, map) {
  mkdirp(path.dirname(file));
  const rows = [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(tmp, file); // atomic replace: a crash mid-write never corrupts the store
}

function clean(r, appId, lang, runAt) {
  return {
    reviewId: r.id,
    appId,
    lang,
    date: iso(r.date),
    score: r.score,
    text: r.text ?? '',
    version: r.version ?? null,
    thumbsUp: r.thumbsUp ?? 0,
    replyText: r.replyText ?? null,
    replyDate: iso(r.replyDate),
    userHash: hash(r.userName),
    url: r.url ?? null,
    firstSeenAt: runAt,
    lastSeenAt: runAt,
  };
}

// ---------- per-app work ----------
async function scrapeMeta(app, cfg, runDir, opts) {
  const base = { appId: app.appId, lang: cfg.langs[0], country: cfg.country };
  const details = await withRetry(`${app.appId} details`, () => gplay.app(base));
  let datasafety = null, permissions = null;
  try { datasafety = await withRetry(`${app.appId} datasafety`, () => gplay.datasafety({ appId: app.appId, lang: base.lang }), 2); } catch (e) { console.warn(`  ! datasafety skipped: ${e.message}`); }
  try { permissions = await withRetry(`${app.appId} permissions`, () => gplay.permissions(base), 2); } catch (e) { console.warn(`  ! permissions skipped: ${e.message}`); }

  writeJSON(path.join(runDir, app.appId, 'app_details.json'), details);
  if (datasafety) writeJSON(path.join(runDir, app.appId, 'datasafety.json'), datasafety);
  if (permissions) writeJSON(path.join(runDir, app.appId, 'permissions.json'), permissions);

  // PII-free summary, safe to commit; used for run-to-run comparison
  return {
    title: details.title,
    score: details.score,
    scoreText: details.scoreText,
    ratings: details.ratings,
    reviews: details.reviews,
    histogram: details.histogram,
    installs: details.installs,
    version: details.version,
    updated: iso(details.updated),
    recentChanges: details.recentChanges ?? null,
    androidVersion: details.androidVersion ?? null,
  };
}

async function scrapeReviews(app, lang, cfg, store, runDir, runAt, opts, state) {
  // Incremental only once a complete history pull has finished for this app+language.
  // (A capped test run seeds the store but must not make the next run think history is done.)
  const st = (state[app.appId] ??= {})[lang] ??= {};
  const incremental = !opts.full && !!st.fullHistoryAt && store.size > 0;
  // Incremental stop line: newest stored review date minus the overlap window.
  let stopBefore = null;
  if (incremental) {
    const newest = [...store.values()].reduce((m, r) => (r.date > m ? r.date : m), '');
    if (newest) stopBefore = new Date(new Date(newest).getTime() - opts.overlapDays * 864e5);
  }
  const hardFloor = opts.days ? new Date(Date.now() - opts.days * 864e5) : null;
  const floor = [stopBefore, hardFloor].filter(Boolean).sort((a, b) => b - a)[0] || null;

  const raw = [];
  let token = null, page = 0, added = 0, updated = 0, reachedFloor = false;
  do {
    page++;
    const res = await withRetry(`${app.appId} reviews p${page}`, () =>
      gplay.reviews({ appId: app.appId, lang, country: cfg.country, sort: gplay.sort.NEWEST, paginate: true, nextPaginationToken: token }));
    const batch = res.data || [];
    raw.push(...batch);
    for (const r of batch) {
      if (floor && r.date && new Date(r.date) < floor) { reachedFloor = true; continue; }
      const c = clean(r, app.appId, lang, runAt);
      const prev = store.get(c.reviewId);
      if (!prev) { store.set(c.reviewId, c); added++; }
      else {
        // keep firstSeenAt; refresh fields that can change (edited review, new reply)
        const changed = prev.score !== c.score || prev.text !== c.text || prev.replyText !== c.replyText;
        store.set(c.reviewId, { ...c, firstSeenAt: prev.firstSeenAt, lastSeenAt: runAt, ...(changed ? { changedAt: runAt } : {}) });
        if (changed) updated++;
      }
    }
    token = res.nextPaginationToken;
    process.stdout.write(`\r  ${lang}: page ${page}, fetched ${raw.length}, new ${added}, changed ${updated}   `);
    if (raw.length >= opts.max || reachedFloor) break;
    if (token) await sleep(opts.delay);
  } while (token);
  process.stdout.write('\n');

  writeJSON(path.join(runDir, app.appId, `reviews_raw_${lang}.json`), raw); // untouched API output
  const stoppedAt = reachedFloor ? 'floor' : token ? 'max' : 'end_of_history';
  // Baseline is complete if a non-incremental pull reached the end of history or the --days / historyDays floor.
  if (!incremental && stoppedAt !== 'max') { st.fullHistoryAt = runAt; st.baselineDays = opts.days ?? null; }
  st.lastRunAt = runAt;
  return { lang, mode: incremental ? 'incremental' : 'full', pages: page, fetched: raw.length, added, updated, stoppedAt };
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'apps.json'), 'utf8'));
  if (opts.days == null && cfg.historyDays) opts.days = cfg.historyDays; // default lookback from config
  const apps = cfg.apps.filter(a => (opts.apps ? opts.apps.includes(a.appId) : a.inScope));
  if (!apps.length) { console.error('No apps selected. Check config/apps.json or --apps.'); process.exit(2); }

  const stateFile = path.join(DATA, 'state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const runAt = new Date().toISOString();
  const runId = runAt.replace(/[:.]/g, '-');
  const runDir = path.join(DATA, 'raw', runId);
  const run = { runId, startedAt: runAt, mode: opts.full ? 'full' : 'auto', options: { ...opts, max: Number.isFinite(opts.max) ? opts.max : null }, country: cfg.country, apps: {} };
  console.log(`Run ${runId} (${opts.full ? 'forced full' : 'auto: full history until one completes, then incremental'}) — ${apps.length} app(s)`);

  for (const app of apps) {
    console.log(`\n▶ ${app.name} [${app.appId}]`);
    const entry = { name: app.name, audience: app.audience };
    try {
      entry.meta = await scrapeMeta(app, cfg, runDir, opts);
      writeJSON(path.join(DATA, 'meta', app.appId, `${runId}.json`), { runId, collectedAt: runAt, ...entry.meta });
      console.log(`  rating ${entry.meta.scoreText} from ${entry.meta.ratings} ratings · v${entry.meta.version} · updated ${entry.meta.updated?.slice(0, 10)}`);

      const storeFile = path.join(DATA, 'store', `${app.appId}.jsonl`);
      const store = loadStore(storeFile);
      entry.reviews = [];
      for (const lang of cfg.langs) entry.reviews.push(await scrapeReviews(app, lang, cfg, store, runDir, runAt, opts, state));
      saveStore(storeFile, store);
      writeJSON(stateFile, state);
      entry.storeTotal = store.size;
      const dates = [...store.values()].map(r => r.date).filter(Boolean).sort();
      entry.storeWindow = { from: dates[0] ?? null, to: dates.at(-1) ?? null };
      console.log(`  store: ${store.size} reviews, ${entry.storeWindow.from?.slice(0, 10)} → ${entry.storeWindow.to?.slice(0, 10)}`);
    } catch (e) {
      entry.error = e.message;
      console.error(`  ✗ ${e.message}`);
    }
    run.apps[app.appId] = entry;
  }

  run.finishedAt = new Date().toISOString();
  mkdirp(DATA);
  fs.appendFileSync(path.join(DATA, 'runs.jsonl'), JSON.stringify(run) + '\n');
  console.log(`\nDone. Run logged to data/runs.jsonl. Raw responses in data/raw/${runId}/`);
  if (Object.values(run.apps).some(a => a.error)) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
