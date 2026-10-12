# How are our Play Store ratings? — 2026-10-12

*com.moveinsync.ets · reviews up to 2026-10-11 · labels: jev (typesafe/jev-1.13-20260917, taxonomy ef37ad8ac4) · spot-check: round1 45/50*


## Headline
- **Store rating 4.64★ from 1,14,879 ratings** (version 12.19.0, collected 2026-10-12).
- **Written reviews, last 30 days:** 243 reviews, average 3.77★, **27.2% are 1★** (prior 30 days: 25.8%, n=229).
- **Developer replies to 1-2★ reviews, last 30 days: 1 of 73 (1.4%).** 136 critical reviews from the last 60 days have no reply.
- **Version alert:** 12.19.0 has 31.4% 1★ vs 23.2% baseline (n=105); crash/won't-open in 10 of 36 low-star reviews.

## What changed since the last run (2026-10-11)
- Store rating 4.64 → 4.64 (+0.00); ratings 114869 → 114879 (+10); version 12.19.0 → 12.19.0.
- Written reviews, last 30 days: average 3.79 → 3.77; 1★ share 26.7% → 27.2% (n 255 → 243).
- Developer replies to 1-2★ (last 30 days): 1.3% → 1.4%.

## Top issues in 1-2★ reviews (last 90 days)
205 low-star reviews; 38 had no usable detail and are left out of the shares below (n=167). Ranked by priority: main-complaint count plus half the other mentions, weighted by average severity.

| # | Issue | Owner | Main complaint | Mentioned | Last 30d vs prior 60d |
|---|---|---|---|---|---|
| 1 | App crashes, won't open, or freezes | Engineering | 31 (18.6%) | 33 | 23.3% vs 10.6% |
| 2 | Driver, vehicle or cab service (operations) | Transport Ops | 19 (11.4%) | 36 | 9.6% vs 9.1% |
| 3 | Login, OTP, or getting logged out | Engineering | 14 (8.4%) | 18 | 6.8% vs 6.8% |
| 4 | Booking or scheduling a ride | Product | 11 (6.6%) | 22 | 2.7% vs 6.8% |
| 5 | Routing, ride length, or pickup time | Product | 16 (9.6%) | 24 | 4.1% vs 9.8% |

**App crashes, won't open, or freezes**: "again and again it's getting stopped.. showing that it can't open as it is not downloaded from playstore. in last 3 weeks I uninstall an installed it for 10 times due to the same error" (2026-08-02, v?, 2★)

**Driver, vehicle or cab service (operations)**: "Complaint Regarding Pathetic Transport Service I would like to raise a complaint regarding the pathetic transport service provided today." (2026-07-14, v12.15.0, 1★)

**Login, OTP, or getting logged out**: "Such a worst app. I am not receiving the OTP even after trying multiple times. Because of this, I am unable to complete the login/verification process. Please fix this issue as soon as possible." (2026-09-24, v12.19.0, 1★)

## Who it's about (last 90 days, low-star reviews with detail)
App: 132 · Operations: 26 · Employer rules: 3 · Unclear: 6

## Developer replies to 1-2★ reviews by quarter
- 2022-Q4: 133 of 138 (96.4%)
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
- 2026-Q3: 1 of 210 (0.5%)
- 2026-Q4: 1 of 25 (4%)

## Files
- `action_queue.csv` — every issue ranked, with owner, first diagnostic check, success metric and example reviews.
- `metrics.json` — all numbers; the next run compares against it.

*Written reviews skew negative compared with silent star ratings, so their shares describe what unhappy users say, not all users. Public Android data only.*
