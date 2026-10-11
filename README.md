# MoveInSync Play Store ratings: weekly brief

Answers "How are our Play Store ratings?" whenever someone asks, and every Monday on its own. It collects new reviews, labels them, and publishes a brief that says what changed since last week, which issues to fix and who owns them, and which critical reviews still need a reply.

**Everything in one command:** `npm run weekly`, which runs scrape, then classify, then replies, then report.

| Output | What it's for |
|---|---|
| `docs/index.html` | The live page (GitHub Pages, or open the file directly): this week's verdict, which release hurt, what to fix and who owns it, replies to post with copy buttons, reply-rate history, the 1★ trend, and what changed since last run |
| `reports/<date>/brief.md` | The same brief as Markdown, for email or Slack |
| `reports/<date>/action_queue.csv` | Ranked issues with owner, first diagnostic check, success metric and example reviews. Jira-importable. |
| `reports/<date>/reply_drafts.csv` | Drafted replies to unanswered 1–2★ reviews, for a person to review and post |
| `reports/<date>/metrics.json` | Every number; the next run compares against it |

## Run it

Needs Node 18+.

```bash
npm install
npm run scrape:test     # quick check: 300 reviews of the employee app
npm run scrape          # normal run: all in-scope apps, incremental
npm run scrape:full     # re-pull full review history (slow; first run or after config changes)
```

The first `npm run scrape` for an app pulls its history back `historyDays` days, even if a capped test run came first. After that baseline pull completes (recorded in `data/state.json`), later runs are incremental.

Options: `node scripts/scrape.js --help`.

## Classify reviews

```bash
npm run classify:test   # 10 recent reviews, to check the key works
npm run classify        # all 1-3 star reviews (and 4-5 star with 15+ words) from the last 365 days
```

Categories, causes, flags and severity are defined once in `config/taxonomy.json`, and every label is checked against it with `zod` before it's saved. Each issue has a fixed owner (Engineering, Product, Transport Ops, Safety, Customer Implementation), so the owner never comes from the model.

| Provider | Needs | Notes |
|---|---|---|
| `jev` (default with a key) | `OPENROUTER_API_KEY` | TypeSafe Jev `typesafe/jev-1.13` via OpenRouter. Returns only allowed categories, with a confidence score. About $0.0001 per review (roughly $0.10 for a year of low-star reviews). |
| `llm` | `OPENROUTER_API_KEY` | Any chat model on OpenRouter (`LLM_MODEL`, default `google/gemini-2.5-flash`). Used for comparison. |
| `rules` (default without a key) | nothing | Keyword rules from `taxonomy.json`. Rougher, so the weekly job still runs when no key is set. |

Put keys in a `.env` file in this folder (it's gitignored): `OPENROUTER_API_KEY=sk-or-...` for Jev, and optionally `GEMINI_API_KEY=...` for reply drafts.

Runs are incremental. A review is labelled again only if its text, the taxonomy or the model changed. Labels go to `data/labels/<appId>.<provider>.jsonl`, and each run is logged in `data/classify_runs.jsonl`. Reviews that fail stay unlabelled and are retried next time.

## Validate the classifier

1. `npm run validate:sheet` builds `validation/handlabels.xlsx`: the reading set already read by hand plus a seeded random draw, 100 reviews in total. The dropdowns are limited to the taxonomy.
2. Label the yellow columns by hand, without looking at any model output.
3. `npm run validate:label` runs every provider on those 100 reviews. `npm run validate` reports agreement per field (with n and Cohen's kappa) to `validation/agreement.json`, and lists the disagreements in `validation/disagreements.csv`.

### Faster alternative: spot-check

`npm run spotcheck:sheet` builds `validation/spotcheck_jev.xlsx`, which shows each review next to the label Jev gave it. A person marks each label right or wrong (y/n), and gives the correct value when it's wrong. `npm run spotcheck` then reports the % judged correct and which categories were confused. Checking against the model's answer slightly favours agreement, so report it as a spot-check, not as independent labelling.

## Brief, action queue and reply drafts

```bash
npm run report    # brief + action queue + live page, compared with the previous report
npm run replies   # reply drafts for unanswered 1-2★ reviews from the last 60 days
```

- **Action queue:** the numbers are recalculated each run. The judgement fields (first diagnostic check, missing data, success metric, app-side fix) come from `config/playbook.json`, written by people. Edit that file to change the advice, not the code. Ranking = main-complaint count + half of other mentions, weighted by average severity.
- **Version alerts:** any version released in the last 120 days with at least 20 reviews and a 1★ share well above the rest of the year (z ≥ 2).
- **Reply drafts:** each is under 350 characters (Play's limit), specific to the review, and gives one concrete next step. Drafts are rejected and rewritten if they promise fixes, dates or refunds. Uses `GEMINI_API_KEY` if set (a free key from aistudio.google.com; paced to the free tier, so 141 drafts take about 15 minutes), otherwise `OPENROUTER_API_KEY`. Without either, it writes per-issue starters marked TEMPLATE. **A person reviews every draft before posting.**

## The live page

`docs/index.html` is a React app compiled into one file, so it opens from disk and on GitHub Pages. Each run of `npm run report` rewrites only `docs/data/brief.js` next to it, so **weekly runs need no build step**. Rebuild the page only when you change the UI (`site/src`): `npm run site:build`.

## Which apps

`config/apps.json` lists every app on the MoveInSync developer account. Set `inScope` to choose which ones are scraped. You can also change `historyDays` (default 365; set `null` for the full history), `country` (default `in`) and `langs` (default `["en"]`; add `"hi"` to include Hindi-language reviews) there. No code changes are needed.

## What each run produces

| Path | What | Commit to git? |
|---|---|---|
| `data/store/<appId>.jsonl` | Every review seen so far, deduplicated by review ID. Reviewer names are replaced by a hash. Edited reviews and new developer replies are updated in place (`changedAt`). | Yes |
| `data/meta/<appId>/<runId>.json` | Rating, star histogram, total ratings, version, "What's new" text at the time of the run. Comparing these files shows how the rating moved between runs. | Yes |
| `data/state.json` | Per app and language: when the last complete history pull finished. Delete an entry to force a full re-pull. | Yes |
| `data/runs.jsonl` | One line per run: when it ran, mode, counts fetched, new and changed, and any errors. | Yes |
| `data/raw/<runId>/` | Untouched API responses, including data safety and permissions | No (contains reviewer names) |

## How incremental runs work

Reviews are fetched newest first. The run stops once it passes the newest stored review minus a 30-day overlap (`--overlap-days`). The overlap is there to catch reviews that users edited and replies the developer posted after the last run. Each write to the store is atomic, so an interrupted run never corrupts it.

## Scheduled runs

`.github/workflows/weekly.yml` runs the full weekly job: collect, classify, report and replies (a copy is kept in `ci/weekly.yml`; if the `.github` copy is missing, copy it to `.github/workflows/weekly.yml` before pushing) every Monday at 08:00 IST and commits the data, reports and live page. Turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / `/docs`) to publish the page. Add `OPENROUTER_API_KEY` as a repository secret to use Jev; without it the keyword rules are used. It can also be started any time from the Actions tab ("Run workflow").

## Limits

- Google Play returns only reviews that have text, filtered by language. The rating count on the store page (all star ratings) will be much larger than the number of reviews collected.
- Public Android data only. This collects no iOS reviews and no Play Console data such as crash rates.
- The scraper uses Google Play's unofficial web endpoints. If Google changes them, update `google-play-scraper` in `package.json`.
