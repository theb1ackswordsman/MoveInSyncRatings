# How are our Play Store ratings? — 2026-11-16

*com.moveinsync.ets · reviews up to 2026-11-14 · labels: jev (typesafe/jev-1.13-20260917, taxonomy ef37ad8ac4) · spot-check: round1 45/50*


## Headline
- **Store rating 4.64★ from 1,16,205 ratings** (version 12.21.0, collected 2026-11-16).
- **Written reviews, last 30 days:** 192 reviews, average 3.8★, **24.5% are 1★** (prior 30 days: 26.9%, n=249).
- **Developer replies to 1-2★ reviews, last 30 days: 3 of 55 (5.5%).** 125 critical reviews from the last 60 days have no reply.
- No version stands out from the baseline this run.

## What changed since the last run (2026-11-09)
- Store rating 4.64 → 4.64 (+0.00); ratings 116005 → 116205 (+200); version 12.21.0 → 12.21.0.
- Written reviews, last 30 days: average 3.87 → 3.8; 1★ share 23.5% → 24.5% (n 213 → 192).
- Developer replies to 1-2★ (last 30 days): 5.2% → 5.5%.
- Booking or scheduling a ride: 11 → 8 main-complaint reviews in the 90-day window.

## Top issues in 1-2★ reviews (last 90 days)
185 low-star reviews; 34 had no usable detail and are left out of the shares below (n=151). Ranked by priority: main-complaint count plus half the other mentions, weighted by average severity.

| # | Issue | Owner | Main complaint | Mentioned | Last 30d vs prior 60d |
|---|---|---|---|---|---|
| 1 | App crashes, won't open, or freezes | Engineering | 29 (19.2%) | 31 | 10.9% vs 17.7% |
| 2 | Driver, vehicle or cab service (operations) | Transport Ops | 22 (14.6%) | 41 | 12.7% vs 11.5% |
| 3 | Support unreachable or complaint ignored | Customer Implementation | 10 (6.6%) | 27 | 7.3% vs 4.6% |
| 4 | Login, OTP, or getting logged out | Engineering | 14 (9.3%) | 17 | 5.5% vs 8.5% |
| 5 | Booking or scheduling a ride | Product | 8 (5.3%) | 19 | 5.5% vs 3.8% |

**App crashes, won't open, or freezes**: "useless app, need to uninstall very frequently and install ...i guess developer forgot make it compatible to android 17. just open the app and leave it it doesn't display anything. User don't have any control on app..…" (2026-09-16, v12.18.1, 1★)

**Driver, vehicle or cab service (operations)**: "Extremely disappointing experience with Move In Sync. Why does the company keep assigning rude, disrespectful, and abusive cab drivers? Is there no proper qualification, screening, or behavioural training before hiring…" (2026-09-15, v12.18.1, 1★)

**Support unreachable or complaint ignored**: "This is a third class app which is not at all user friendly for employees, this is just made to the convenience of vendors,Help desk and vendors are not at all helpful on this app...they don't even consider your…" (2026-08-17, v12.17.0, 1★)

## Who it's about (last 90 days, low-star reviews with detail)
App: 105 · Operations: 35 · Employer rules: 3 · Unclear: 8

## Developer replies to 1-2★ reviews by quarter
- 2022-Q4: 59 of 62 (95.2%)
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
- 2026-Q1: 4 of 167 (2.4%)
- 2026-Q2: 1 of 210 (0.5%)
- 2026-Q3: 1 of 209 (0.5%)
- 2026-Q4: 3 of 87 (3.4%)

## Files
- `action_queue.csv` — every issue ranked, with owner, first diagnostic check, success metric and example reviews.
- `metrics.json` — all numbers; the next run compares against it.

*Written reviews skew negative compared with silent star ratings, so their shares describe what unhappy users say, not all users. Public Android data only.*
