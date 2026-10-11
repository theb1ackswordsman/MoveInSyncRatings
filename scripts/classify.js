#!/usr/bin/env node
/**
 * Classify stored Play Store reviews against config/taxonomy.json — rerunnable.
 *
 * Providers (all produce the same validated label shape):
 *   jev    TypeSafe Jev (System One decision model) via OpenRouter. Default when OPENROUTER_API_KEY is set.
 *   llm    A general LLM via OpenRouter chat completions (model from LLM_MODEL). Used for comparison.
 *   rules  Keyword rules from taxonomy.json. No key needed; the fallback for unattended runs.
 *
 * Which reviews: every 1-3 star review in the window, plus 4-5 star reviews with 15+ words.
 * Incremental: a review is re-labelled only if its text, the taxonomy, or the model changed.
 *
 * Usage:
 *   node scripts/classify.js                       # default provider, last 365 days
 *   node scripts/classify.js --provider llm
 *   node scripts/classify.js --provider rules
 *   node scripts/classify.js --days 90 --limit 20  # quick test
 *   node scripts/classify.js --ids reading/handlabel_sample.csv   # only the review IDs in a file
 *   node scripts/classify.js --app com.moveinsync.ets --concurrency 4 --force
 *
 * Environment (.env in the project root is read automatically):
 *   OPENROUTER_API_KEY   required for jev and llm
 *   CLASSIFIER           default provider (jev | llm | rules)
 *   JEV_MODEL            default typesafe/jev-1.13 (pinned for reproducibility)
 *   LLM_MODEL            default google/gemini-2.5-flash
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DECISIONS_URL = process.env.OPENROUTER_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions';
const CHAT_URL = process.env.OPENROUTER_CHAT_URL || 'https://openrouter.ai/api/v1/chat/completions';

// ---------- env (validated at startup, in plain words) ----------
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const ENV = {
  key: process.env.OPENROUTER_API_KEY || '',
  jevModel: process.env.JEV_MODEL || 'typesafe/jev-1.13',
  llmModel: process.env.LLM_MODEL || 'google/gemini-2.5-flash',
  defaultProvider: process.env.CLASSIFIER || null,
};

// ---------- args ----------
function parseArgs(argv) {
  const a = { provider: null, days: 365, limit: Infinity, ids: null, app: 'com.moveinsync.ets', concurrency: 4, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--provider') a.provider = v();
    else if (k === '--days') a.days = Number(v());
    else if (k === '--limit') a.limit = Number(v());
    else if (k === '--ids') a.ids = v();
    else if (k === '--app') a.app = v();
    else if (k === '--concurrency') a.concurrency = Number(v());
    else if (k === '--force') a.force = true;
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error(`Unknown argument: ${k}`); process.exit(2); }
  }
  return a;
}

// ---------- taxonomy + schema ----------
const taxRaw = fs.readFileSync(path.join(ROOT, 'config', 'taxonomy.json'), 'utf8');
const TAX = JSON.parse(taxRaw);
const TAX_VERSION = crypto.createHash('sha256').update(taxRaw).digest('hex').slice(0, 10);
const ISSUES = Object.keys(TAX.issues);
const MENTIONABLE = ISSUES.filter(k => !['praise', 'other', 'no_signal'].includes(k));
const CAUSES = Object.keys(TAX.causes);
const FLAGS = Object.keys(TAX.flags);

const LabelSchema = z.object({
  reviewId: z.string(),
  provider: z.enum(['jev', 'llm', 'rules']),
  model: z.string(),
  taxonomyVersion: z.string(),
  textHash: z.string(),
  primary: z.enum(ISSUES),
  primaryConfidence: z.number().min(0).max(1).nullable(),
  issues: z.array(z.enum(ISSUES)),
  cause: z.enum(CAUSES),
  causeConfidence: z.number().min(0).max(1).nullable(),
  severity: z.number().int().min(0).max(3),
  severityExpected: z.number().min(0).max(3).nullable().optional(),
  flags: z.object(Object.fromEntries(FLAGS.map(f => [f, z.boolean()]))),
  flagScores: z.object(Object.fromEntries(FLAGS.map(f => [f, z.number().min(0).max(1)]))).nullable(),
  owner: z.string(),
  classifiedAt: z.string(),
});

// What a general LLM must return (validated before it is trusted)
const LlmOut = z.object({
  primary: z.enum(ISSUES),
  issues: z.array(z.enum(ISSUES)).default([]),
  cause: z.enum(CAUSES),
  severity: z.number().int().min(0).max(3),
  flags: z.object(Object.fromEntries(FLAGS.map(f => [f, z.boolean()]))),
});

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
const reviewState = r => `Play Store review of the MoveInSync employee commute app (employees book company cabs/shuttles, track them, and board with OTP/QR).\nStars: ${r.score}/5\nApp version: ${r.version || 'unknown'}\nDate: ${(r.date || '').slice(0, 10)}\nReview: ${r.text}`;

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

async function postJSON(url, body, label) {
  let wait = 1500;
  for (let t = 1; ; t++) {
    let res, text;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ENV.key}`, 'X-Title': 'moveinsync-playstore-ratings' }, body: JSON.stringify(body) });
      text = await res.text();
    } catch (e) { res = { ok: false, status: 0 }; text = e.message; }
    if (res.ok) return JSON.parse(text);
    if (res.status === 401 || res.status === 402 || res.status === 403) { const e = new Error(`${label}: HTTP ${res.status} ${String(text).slice(0, 200)}`); e.fatal = true; throw e; }
    const retryable = res.status === 0 || res.status === 429 || res.status >= 500;
    if (!retryable || t >= 5) throw new Error(`${label}: HTTP ${res.status} ${String(text).slice(0, 300)}`);
    await sleep(wait); wait *= 2;
  }
}

function severityFromJev(ans) {
  const probs = ans?.probabilities && Object.entries(ans.probabilities).filter(([, p]) => Number.isFinite(Number(p)));
  const expected = Number.isFinite(Number(ans?.score)) ? Number(ans.score) : null;
  let level = null;
  if (probs && probs.length) level = Number(probs.sort((x, y) => Number(y[1]) - Number(x[1]) || Number(y[0]) - Number(x[0]))[0][0]);
  if (!Number.isInteger(level) && expected != null) level = Math.round(expected);
  return { severity: level, severityExpected: expected == null ? null : +expected.toFixed(3) };
}

// ---------- providers ----------
const providers = {
  async jev(r) {
    const questions = {
      primary_issue: { type: 'choice', instructions: 'What is the single main problem this review is about? If it lists several, pick the one the reviewer is most upset about.', criteria: Object.fromEntries(ISSUES.map(k => [k, TAX.issues[k].description])) },
      cause: { type: 'choice', instructions: 'Who or what is responsible for the main problem?', criteria: TAX.causes },
      severity: { type: 'score', instructions: 'How badly did this affect the reviewer?', criteria: TAX.severity },
      ...Object.fromEntries(FLAGS.map(f => [`flag_${f}`, { type: 'noul', instructions: TAX.flags[f], criteria: { true: TAX.flags[f], false: 'Not mentioned or implied in the review.' } }])),
      ...Object.fromEntries(MENTIONABLE.map(k => [`mentions_${k}`, { type: 'noul', instructions: `Does the review mention this problem, even as a secondary point? ${TAX.issues[k].label}.`, criteria: { true: TAX.issues[k].description, false: 'This problem is not mentioned.' } }])),
    };
    const res = await postJSON(DECISIONS_URL, { model: ENV.jevModel, state: reviewState(r), questions }, `jev ${r.reviewId}`);
    const a = res.answers || {};
    const flagScores = Object.fromEntries(FLAGS.map(f => [f, Number(a[`flag_${f}`]?.noul ?? 0)]));
    const primary = a.primary_issue?.choice;
    const issues = MENTIONABLE.filter(k => Number(a[`mentions_${k}`]?.noul ?? 0) >= 0.5);
    if (primary && !issues.includes(primary) && MENTIONABLE.includes(primary)) issues.unshift(primary);
    return {
      model: res.model || ENV.jevModel,
      primary,
      primaryConfidence: a.primary_issue?.confidence ?? null,
      issues,
      cause: a.cause?.choice,
      causeConfidence: a.cause?.confidence ?? null,
      // Jev's score can be fractional (an expected value). Use the most probable level; keep the expected value too.
      ...severityFromJev(a.severity),
      flags: Object.fromEntries(FLAGS.map(f => [f, flagScores[f] >= 0.5])),
      flagScores,
      _usage: res.usage,
    };
  },

  async llm(r) {
    const sys = `You label Play Store reviews of the MoveInSync employee commute app. Reply with JSON only, matching exactly:
{"primary": <issue key>, "issues": [<issue keys mentioned, including primary>], "cause": <cause key>, "severity": <0-3>, "flags": {${FLAGS.map(f => `"${f}": <true|false>`).join(', ')}}}

Issue keys:
${ISSUES.map(k => `- ${k}: ${TAX.issues[k].description}`).join('\n')}

Cause keys:
${CAUSES.map(k => `- ${k}: ${TAX.causes[k]}`).join('\n')}

Severity: ${TAX.severity.map((s, i) => `${i} = ${s}`).join(' ')}

Flags:
${FLAGS.map(f => `- ${f}: ${TAX.flags[f]}`).join('\n')}

"primary" is the single problem the reviewer is most upset about. Use "no_signal" when there is no specific problem.`;
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await postJSON(CHAT_URL, { model: ENV.llmModel, temperature: 0, max_tokens: 1500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: reviewState(r) }] }, `llm ${r.reviewId}`);
      const content = res.choices?.[0]?.message?.content ?? '';
      try {
        const out = LlmOut.parse(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')));
        if (!out.issues.includes(out.primary) && MENTIONABLE.includes(out.primary)) out.issues.unshift(out.primary);
        return { model: res.model || ENV.llmModel, ...out, issues: out.issues.filter(k => MENTIONABLE.includes(k)), primaryConfidence: null, causeConfidence: null, flagScores: null, _usage: res.usage };
      } catch (e) { lastErr = e; }
    }
    throw new Error(`llm ${r.reviewId}: invalid output after 2 attempts (${String(lastErr?.message).slice(0, 200)})`);
  },

  async rules(r) {
    const t = ` ${(r.text || '').toLowerCase()} `;
    const hits = {};
    for (const k of ISSUES) for (const kw of TAX.issues[k].keywords || []) if (t.includes(kw)) hits[k] = (hits[k] || 0) + 1;
    const complaints = Object.keys(hits).filter(k => k !== 'praise');
    let primary;
    if (complaints.length) primary = complaints.sort((a, b) => hits[b] - hits[a])[0];
    else if (hits.praise && r.score >= 4) primary = 'praise';
    else primary = words(r.text) <= 6 ? 'no_signal' : 'other';
    const kw = list => list.some(w => t.includes(w));
    const flags = {
      escalation_failure: kw(['complain', 'ticket', 'no response', 'not responding', 'helpdesk', 'help desk', 'escalat', 'nobody', 'no one']),
      mentions_employer_or_policy: kw(['company', 'employer', 'organization', 'organisation', 'policy', 'hr ', 'admin', 'transport team', 'transport desk']),
      mentions_recent_update: kw(['update', 'new version', 'latest version', 'old version', 'previous version']),
      safety_concern: primary === 'safety_incident' || !!hits.safety_incident && kw(['harass', 'unsafe', 'misbehav', 'sos', 'drunk', 'rash']),
    };
    const ownerCause = { Engineering: 'app', Product: 'app', 'Transport Ops': 'ops', Safety: 'ops', 'Customer Implementation': 'ops' };
    let cause = ownerCause[TAX.issues[primary].owner] || 'unclear';
    if (primary === 'booking_schedule' && kw(['hours before', 'hours prior', 'hrs before', 'cutoff', 'cut off', 'policy'])) cause = 'employer_config';
    const severity = flags.safety_concern ? 3 : ['praise'].includes(primary) ? 0 : ['app_crash_or_wont_open', 'login_otp_session', 'booking_schedule', 'boarding_checkin'].includes(primary) ? 2 : primary === 'no_signal' ? 1 : 1;
    return { model: 'keyword-rules', primary, primaryConfidence: null, issues: complaints.filter(k => MENTIONABLE.includes(k)), cause, causeConfidence: null, severity, flags, flagScores: null };
  },
};

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = opts.provider || ENV.defaultProvider || (ENV.key ? 'jev' : 'rules');
  if (!providers[provider]) { console.error(`Unknown provider "${provider}". Use jev, llm or rules.`); process.exit(2); }
  if (provider !== 'rules' && !ENV.key) {
    console.error(`Provider "${provider}" needs OPENROUTER_API_KEY. Add it to a .env file in the project root:\n  OPENROUTER_API_KEY=sk-or-...\nOr run with --provider rules (no key needed).`);
    process.exit(2);
  }

  const store = readJsonl(path.join(DATA, 'store', `${opts.app}.jsonl`));
  if (!store.length) { console.error(`No reviews for ${opts.app}. Run npm run scrape first.`); process.exit(2); }
  let pool;
  if (opts.ids) {
    let idText;
    if (opts.ids.endsWith('.xlsx')) {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.resolve(opts.ids));
      idText = []; wb.worksheets[0].eachRow(row => row.eachCell(c => idText.push(String(c.value ?? '')))); idText = idText.join('\n');
    } else idText = fs.readFileSync(path.resolve(opts.ids), 'utf8');
    const ids = new Set(idText.match(/gp:[A-Za-z0-9_\-]+|[0-9a-f]{8}-[0-9a-f-]{27}/g) || []);
    pool = store.filter(r => ids.has(r.reviewId));
    console.log(`Selected ${pool.length} of ${ids.size} IDs listed in ${opts.ids}`);
  } else {
    const newest = store.reduce((m, r) => (r.date > m ? r.date : m), '');
    const since = new Date(new Date(newest).getTime() - opts.days * 864e5).toISOString();
    pool = store.filter(r => r.date >= since && (r.score <= 3 || words(r.text) >= 15));
  }

  const outFile = path.join(DATA, 'labels', `${opts.app}.${provider}.jsonl`);
  const existing = new Map(readJsonl(outFile).map(l => [l.reviewId, l]));
  const model = provider === 'jev' ? ENV.jevModel : provider === 'llm' ? ENV.llmModel : 'keyword-rules';
  const pending = pool.filter(r => {
    if (opts.force) return true;
    const l = existing.get(r.reviewId);
    return !l || l.textHash !== hash(r.text) || l.taxonomyVersion !== TAX_VERSION || !String(l.model).startsWith(model);
  });
  const todo = pending.slice(0, opts.limit);

  console.log(`Provider ${provider} (${model}) · taxonomy ${TAX_VERSION} · ${pool.length} in scope · ${pool.length - pending.length} already labelled · ${todo.length} to label${pending.length > todo.length ? ` (${pending.length - todo.length} left for later runs)` : ''}`);
  const errors = [];
  let done = 0, cost = 0, stopped = false;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      try {
        const raw = await providers[provider](r);
        if (raw._usage?.cost) cost += raw._usage.cost;
        delete raw._usage;
        const label = LabelSchema.parse({ reviewId: r.reviewId, provider, taxonomyVersion: TAX_VERSION, textHash: hash(r.text), classifiedAt: new Date().toISOString(), owner: TAX.issues[raw.primary]?.owner ?? 'Unassigned', ...raw });
        existing.set(r.reviewId, label);
      } catch (e) {
        errors.push({ reviewId: r.reviewId, error: e.message });
        if (e.fatal && !stopped) { stopped = true; queue.length = 0; console.error(`\nStopping: the API refused the key (${e.message.match(/HTTP \d+/)?.[0]}). ${/402/.test(e.message) ? 'The OpenRouter account is out of credit: add credit at https://openrouter.ai/settings/credits and run again.' : 'Check OPENROUTER_API_KEY in .env.'} Everything labelled so far is saved.`); }
      }
      done++;
      if ((process.stdout.isTTY ? done % 10 === 0 : done % 100 === 0) || done === todo.length) process.stdout.write(`\r  ${done}/${todo.length} labelled, ${errors.length} failed${cost ? `, cost $${cost.toFixed(4)}` : ''}   `);
      if (done % 50 === 0) save();
    }
  }
  function save() {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile + '.tmp', [...existing.values()].map(l => JSON.stringify(l)).join('\n') + '\n');
    fs.renameSync(outFile + '.tmp', outFile);
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  save();
  process.stdout.write('\n');

  const log = { at: new Date().toISOString(), app: opts.app, provider, model, taxonomyVersion: TAX_VERSION, inScope: pool.length, labelled: todo.length - errors.length, failed: errors.length, cost: cost || null };
  fs.appendFileSync(path.join(DATA, 'classify_runs.jsonl'), JSON.stringify(log) + '\n');
  if (errors.length) {
    fs.writeFileSync(path.join(DATA, 'labels', `${opts.app}.${provider}.errors.json`), JSON.stringify(errors, null, 2));
    console.warn(`${errors.length} reviews could not be labelled; they stay unlabelled and will be retried next run. First error: ${errors[0].error}`);
  }
  console.log(`Labels: ${path.relative(ROOT, outFile)} (${existing.size} total)`);
}

main().catch(e => { console.error(e); process.exit(1); });
