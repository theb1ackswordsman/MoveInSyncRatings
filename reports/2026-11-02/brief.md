# How are our Play Store ratings? — 2026-11-02

*com.moveinsync.ets · reviews up to 2026-11-01 · labels: jev (typesafe/jev-1.13-20260917, taxonomy ef37ad8ac4) · spot-check: round1 45/50*


## Headline
- **Store rating 4.64★ from 1,15,725 ratings** (version 12.20.0, collected 2026-11-02).
- **Written reviews, last 30 days:** 217 reviews, average 3.86★, **24.4% are 1★** (prior 30 days: 24.9%, n=237).
- **Developer replies to 1-2★ reviews, last 30 days: 3 of 60 (5%).** 123 critical reviews from the last 60 days have no reply.
- No version stands out from the baseline this run.

## What changed since the last run (2026-10-26)
- Store rating 4.64 → 4.64 (-0.00); ratings 115412 → 115725 (+313); version 12.20.0 → 12.20.0.
- Written reviews, last 30 days: average 3.8 → 3.86; 1★ share 26.4% → 24.4% (n 208 → 217).
- Developer replies to 1-2★ (last 30 days): 3.3% → 5%.
- App crashes, won't open, or freezes: 33 → 29 main-complaint reviews in the 90-day window.

## Top issues in 1-2★ reviews (last 90 days)
198 low-star reviews; 37 had no usable detail and are left out of the shares below (n=161). Ranked by priority: main-complaint count plus half the other mentions, weighted by average severity.

| # | Issue | Owner | Main complaint | Mentioned | Last 30d vs prior 60d |
|---|---|---|---|---|---|
| 1 | App crashes, won't open, or freezes | Engineering | 29 (18%) | 31 | 13.3% vs 15.2% |
| 2 | Driver, vehicle or cab service (operations) | Transport Ops | 22 (13.7%) | 38 | 13.3% vs 10.1% |
| 3 | Login, OTP, or getting logged out | Engineering | 16 (9.9%) | 20 | 11.7% vs 6.5% |
| 4 | Booking or scheduling a ride | Product | 11 (6.8%) | 22 | 8.3% vs 4.3% |
| 5 | Support unreachable or complaint ignored | Customer Implementation | 7 (4.3%) | 22 | 5% vs 2.9% |

**App crashes, won't open, or freezes**: "useless app, need to uninstall very frequently and install ...i guess developer forgot make it compatible to android 17. just open the app and leave it it doesn't display anything. User don't have any control on app..…" (2026-09-16, v12.18.1, 1★)

**Driver, vehicle or cab service (operations)**: "Extremely disappointing experience with Move In Sync. Why does the company keep assigning rude, disrespectful, and abusive cab drivers? Is there no proper qualification, screening, or behavioural training before hiring…" (2026-09-15, v12.18.1, 1★)

**Login, OTP, or getting logged out**: "worst app.. after logging in it asks for authentication.. by the time i open authenticator and come back to move in sync.. the app gets error and have to login from first.. this is happening for more than 10times and…" (2026-10-28, v12.20.0, 1★)

## Who it's about (last 90 days, low-star reviews with detail)
App: 119 · Operations: 31 · Employer rules: 4 · Unclear: 7

## Developer replies to 1-2★ reviews by quarter
- 2022-Q4: 86 of 90 (95.6%)
- 2023-Q1: 168 of 171 (98.2%)
- 2023-Q2: 148 of 153 (96.7%)
- 2023-Q3: 205 of 212 (96.7%)
- 2023-Q4: 229 of 238 (96.2%)
- 2024-Q1: 210 of 219 (95.9%)
- 2024-Q2: 100 of 194 (51.5%)
- 2024-Q3: 6 of 228 (2.6%)
- 2024-Q4: 1 of 199 (0.5%)
- 2025-Q1: 10 of 252 (4%)
- 2025-Q2: 7 of 234 (3%)
- 2025-Q3: 20 of 216 (9.3%)
- 2025-Q4: 24 of 182 (13.2%)
- 2026-Q1: 4 of 168 (2.4%)
- 2026-Q2: 1 of 210 (0.5%)
- 2026-Q3: 1 of 209 (0.5%)
- 2026-Q4: 3 of 62 (4.8%)

## Files
- `action_queue.csv` — every issue ranked, with owner, first diagnostic check, success metric and example reviews.
- `metrics.json` — all numbers; the next run compares against it.

*Written reviews skew negative compared with silent star ratings, so their shares describe what unhappy users say, not all users. Public Android data only.*
