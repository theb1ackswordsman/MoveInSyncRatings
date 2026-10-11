#!/usr/bin/env node
/**
 * Draft Play Store developer replies for unanswered 1-2★ reviews — for a person to review and post.
 *
 * Which reviews: 1-2★, no developer reply, last --days days (default 60), sorted by severity then recency.
 * Each draft: specific to what the review says, <= 350 characters (Play's limit), no promises we can't verify
 * (no "fixed", no dates, no refunds), and one concrete next step. Drafts that break a rule are retried, then dropped.
 * Drafts are cached in data/replies/<app>.jsonl and only made for reviews not drafted before.
 *
 * Usage: node scripts/reply_drafts.js [--days 60] [--limit 200] [--app com.moveinsync.ets]
 * Needs GEMINI_API_KEY (free, aistudio.google.com; GEMINI_MODEL default gemini-2.5-flash, paced to the free tier)
 * or OPENROUTER_API_KEY (LLM_MODEL, default google/gemini-2.5-flash). Without a key it writes
 * per-issue starters marked TEMPLATE, which must be personalised before posting.
 * Output: reports/<date>/reply_drafts.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

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
const APP = arg('app', 'com.moveinsync.ets'), DAYS = Number(arg('days', 60)), LIMIT = Number(arg('limit', 200));
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
// Provider: Google Gemini (free tier key from aistudio.google.com) if GEMINI_API_KEY is set, otherwise OpenRouter.
// Force one with REPLY_PROVIDER=gemini|openrouter.
const useGemini = process.env.REPLY_PROVIDER ? process.env.REPLY_PROVIDER === 'gemini' : !!process.env.GEMINI_API_KEY;
const KEY = useGemini ? (process.env.GEMINI_API_KEY || '') : (process.env.OPENROUTER_API_KEY || '');
const MODEL = useGemini ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : (process.env.LLM_MODEL || 'google/gemini-2.5-flash');
const CHAT_URL = useGemini ? (process.env.GEMINI_CHAT_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') : (process.env.OPENROUTER_CHAT_URL || 'https://openrouter.ai/api/v1/chat/completions');
const DELAY_MS = Number(process.env.REPLY_DELAY_MS ?? (useGemini ? 6500 : 0)); // free Gemini tier allows ~10 requests/minute
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'app@moveinsync.com'; // from the Play Store listing

const jsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'taxonomy.json'), 'utf8'));
const reviews = jsonl(path.join(ROOT, 'data', 'store', `${APP}.jsonl`));
const provider = ['jev', 'llm', 'rules'].find(p => fs.existsSync(path.join(ROOT, 'data', 'labels', `${APP}.${p}.jsonl`)));
const labels = new Map(jsonl(path.join(ROOT, 'data', 'labels', `${APP}.${provider}.jsonl`)).map(l => [l.reviewId, l]));
const asOf = Math.max(...reviews.map(r => Date.parse(r.date)));
const asOfDate = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);   // filed by run date, like report.js

const targets = reviews
  .filter(r => r.score <= 2 && !r.replyText && Date.parse(r.date) > asOf - DAYS * 864e5)
  .map(r => ({ r, l: labels.get(r.reviewId) }))
  .sort((a, b) => ((b.l?.severity ?? 1) - (a.l?.severity ?? 1)) || b.r.date.localeCompare(a.r.date));

// Rules every draft must pass
const BANNED = [/\b(fixed|resolved|has been (fixed|resolved))\b/i, /\bwill be (fixed|resolved|available)\b/i, /\b(guarantee|refund|compensat)/i, /\bwithin \d+ ?(hours?|days?|hrs?)\b/i, /\b(tomorrow|next week|next release|soon)\b/i, /\bdear (customer|user)\b/i, /\binconvenience caused\b/i];
const Draft = z.string().min(60).max(350).refine(t => !BANNED.some(re => re.test(t)), 'contains a banned promise or stock phrase');

const STARTERS = { // fallback without a key; must be personalised
  app_crash_or_wont_open: `We're sorry the app isn't opening for you. Please email ${SUPPORT_EMAIL} with your phone model, Android version and the exact error you see, so our engineers can trace it.`,
  login_otp_session: `Sorry you're having trouble signing in. Please email ${SUPPORT_EMAIL} with your registered number or email and when it last failed, so we can check what happened with your OTP or session.`,
  booking_schedule: `Sorry booking didn't work as expected. Please email ${SUPPORT_EMAIL} with the date and shift you tried to book, so we can check whether it was an app error or a booking rule set for your office.`,
  routing_pickup_time: `Sorry your commute is taking this long. Please email ${SUPPORT_EMAIL} with your trip date and pickup area so we can review the route with your transport team.`,
};
const SYSTEM = `You write replies from the MoveInSync app team to Play Store reviews of the MoveInSync employee commute app (employees book company cabs/shuttles, track them, board with OTP/QR; their employer and its transport desk set rules like booking cutoffs).
Rules:
- Max 300 characters. Plain text, no markdown, no emojis, no hashtags, no "Dear customer", no "inconvenience caused".
- Refer to the specific problem the reviewer describes, in your own words. Do not quote them back at length.
- Do NOT promise outcomes, fixes, timelines, refunds or that anything "has been fixed". Do not invent facts about the cause.
- Give exactly one concrete next step: email ${SUPPORT_EMAIL} with the specific details needed for this problem (e.g. phone model and Android version for crashes; trip date and route for routing/driver issues; registered number for login).
- If the problem is a company rule (cutoff times, eligibility), say kindly that the rule is set by their organisation's transport team and how to raise it.
- If there is any safety concern, acknowledge it seriously and ask them to email with the trip date so it can be investigated.
- If the review has no specific problem, ask what went wrong in one short sentence plus the email.
Reply with only the reply text.`;

async function llmDraft(r, l) {
  const user = `Stars: ${r.score}/5. App version: ${r.version ?? 'unknown'}. Date: ${r.date.slice(0, 10)}. Issue label: ${l?.primary ?? 'unknown'} (${TAX.issues[l?.primary]?.label ?? ''}).\nReview: ${r.text}`;
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (DELAY_MS) await new Promise(s => setTimeout(s, DELAY_MS));
    const res = await fetch(CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...(useGemini ? {} : { 'X-Title': 'moveinsync-playstore-ratings' }) }, body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: Number(process.env.REPLY_MAX_TOKENS || 1500), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: attempt === 1 ? user : `${user}\n\nYour previous draft broke a rule (${last}). Write a new one that follows every rule.` }] }) });
    if (res.status === 429 || res.status >= 500) { await new Promise(s => setTimeout(s, (useGemini ? 20000 : 2000) * attempt)); last = `HTTP ${res.status}`; continue; }
    if (!res.ok) { const e = new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); e.fatal = [401, 402, 403].includes(res.status); throw e; }
    const j = await res.json();
    const text = (j.choices?.[0]?.message?.content ?? '').trim().replace(/^"|"$/g, '');
    const ok = Draft.safeParse(text);
    if (ok.success) return { text, cost: j.usage?.cost ?? 0 };
    last = ok.error.issues[0].message;
  }
  throw new Error(`no valid draft after 3 attempts (${last})`);
}

const cacheFile = path.join(ROOT, 'data', 'replies', `${APP}.jsonl`);
const cache = new Map(jsonl(cacheFile).map(d => [d.reviewId, d]));
const todo = targets.filter(t => !cache.has(t.r.reviewId) || (KEY && cache.get(t.r.reviewId).kind === 'template')).slice(0, LIMIT);
console.log(`${targets.length} unanswered 1-2★ reviews in the last ${DAYS} days; ${todo.length} need a draft (${KEY ? `${useGemini ? 'Gemini' : 'OpenRouter'} ${MODEL}${DELAY_MS ? `, ~${Math.ceil(todo.length * DELAY_MS / 60000)} min at the free-tier pace` : ''}` : 'no key: TEMPLATE starters'})`);
let cost = 0, failed = 0;
for (const [i, { r, l }] of todo.entries()) {
  try {
    let d;
    if (KEY) { const out = await llmDraft(r, l); cost += out.cost; d = { kind: 'llm', model: `${useGemini ? 'gemini' : 'openrouter'}:${MODEL}`, text: out.text }; }
    else d = { kind: 'template', model: 'starter', text: `TEMPLATE, personalise before posting: ${STARTERS[l?.primary] ?? `Sorry the app let you down. Could you tell us what went wrong? Please email ${SUPPORT_EMAIL} so we can look into it.`}` };
    cache.set(r.reviewId, { reviewId: r.reviewId, draftedAt: new Date().toISOString(), ...d });
  } catch (e) {
    failed++; console.warn(`  ! ${r.reviewId}: ${e.message}`);
    if (e.fatal) { console.error(`Stopping: the API refused the key. ${/402/.test(e.message) ? 'The OpenRouter account is out of credit: add credit at https://openrouter.ai/settings/credits and run again.' : 'Check OPENROUTER_API_KEY in .env.'} Drafts made so far are saved.`); break; }
  }
  if (process.stdout.isTTY) process.stdout.write(`\r  ${i + 1}/${todo.length}${cost ? `, cost $${cost.toFixed(4)}` : ''}   `);
  if ((i + 1) % 10 === 0) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, [...cache.values()].map(d => JSON.stringify(d)).join('\n') + '\n'); }
}
if (process.stdout.isTTY) process.stdout.write('\n');
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile, [...cache.values()].map(d => JSON.stringify(d)).join('\n') + '\n');

const esc = s => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const cols = ['priority', 'review_id', 'date', 'stars', 'version', 'issue', 'severity', 'safety_flag', 'review_text', 'draft_reply', 'draft_chars', 'draft_kind', 'play_console_link', 'status'];
const rows = targets.filter(t => cache.has(t.r.reviewId)).map(({ r, l }, i) => {
  const d = cache.get(r.reviewId);
  return [i + 1, r.reviewId, r.date.slice(0, 10), r.score, r.version, l ? TAX.issues[l.primary]?.label : '', l?.severity ?? '', l?.flags?.safety_concern ? 'YES' : '', r.text, d.text, d.text.length, d.kind, r.url ?? '', 'to review'];
});
const outDir = path.join(ROOT, 'reports', asOfDate);
fs.mkdirSync(outDir, { recursive: true });
safeWrite(path.join(outDir, 'reply_drafts.csv'), '﻿' + [cols.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n'));
console.log(`Wrote reports/${asOfDate}/reply_drafts.csv (${rows.length} drafts; ${failed} failed${cost ? `; cost $${cost.toFixed(4)}` : ''}). A person reviews each draft before posting.`);
