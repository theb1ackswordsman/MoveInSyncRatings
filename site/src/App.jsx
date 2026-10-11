import React, { useEffect, useMemo, useRef, useState } from 'react';

const fmt = n => (n == null ? '–' : Number(n).toLocaleString('en-IN'));
const pp = n => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(1)} pts`);

function useWidth(ref, fallback = 900) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// Bar with rounded data-end (top) anchored square to the baseline.
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.title}</strong>
      {tip.lines.map((l, i) => <span key={i}>{l}</span>)}
    </div>
  );
}

/* ---------- Release strip: 1★ share per app version vs baseline ---------- */
function ReleaseStrip({ versions, baseline }) {
  const box = useRef(null);
  const W = useWidth(box);
  const [tip, setTip] = useState(null);
  const H = 220, L = 34, R = 4, T = 12, B = 46;
  const ymax = Math.max(40, Math.ceil(Math.max(...versions.map(v => v.oneStarPct || 0), baseline || 0) / 10) * 10);
  const band = (W - L - R) / versions.length;
  const bw = Math.max(4, band - 2);           // 2px surface gap between bars
  const y = v => T + (H - T - B) * (1 - v / ymax);
  const every = band < 34 ? 2 : 1;
  const show = (v, i) => {
    const x = L + i * band + band / 2;
    setTip({
      x: x + band / 2 + 8 + 190 < W ? x + band / 2 + 8 : Math.max(0, x - band / 2 - 198), y: 0,
      title: `${v.oneStarPct}% 1★ on ${v.version}`,
      lines: [`${v.oneStarN} of ${v.n} reviews since ${v.firstSeen}`, `${v.crashMentionsN} of ${v.lowStarN} low-star reviews mention crashes`, v.flagged ? 'Flagged: well above other versions' : `Baseline ${baseline}%`],
    });
  };
  return (
    <div className="chart" ref={box} onMouseLeave={() => setTip(null)}>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of 1-star reviews for each app version, compared with the 12-month baseline">
        {[0, 10, 20, 30, 40, 50, 60].filter(t => t <= ymax).map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end">{t}%</text>
          </g>
        ))}
        {versions.map((v, i) => {
          const x = L + i * band + 1;
          return (
            <g key={v.version} tabIndex={0} onMouseEnter={() => show(v, i)} onFocus={() => show(v, i)} onBlur={() => setTip(null)} aria-label={`${v.version}: ${v.oneStarPct}% one-star, ${v.n} reviews`}>
              <rect x={L + i * band} y={T} width={band} height={H - T - B} fill="transparent" />
              <path d={barPath(x, y(v.oneStarPct), bw, y(0) - y(v.oneStarPct))} fill={v.flagged ? 'var(--signal)' : 'var(--series)'} opacity={v.flagged ? 1 : 0.85} />
              {i % every === 0 || v.flagged ? (
                <text x={x + bw / 2} y={H - B + 14} textAnchor="end" transform={`rotate(-40 ${x + bw / 2} ${H - B + 14})`} style={v.flagged ? { fill: 'var(--signal-ink)', fontWeight: 600 } : null}>{v.version}</text>
              ) : null}
            </g>
          );
        })}
        {baseline != null && <line x1={L} x2={W - R} y1={y(baseline)} y2={y(baseline)} stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="5 4" pointerEvents="none" />}
      </svg>
      <Tip tip={tip} />
      <div className="legend">
        <span><i style={{ background: 'var(--series)' }} />Version</span>
        <span><i style={{ background: 'var(--signal)' }} />Flagged version</span>
        <span><i className="dash" />12-month average ({baseline}%)</span>
      </div>
      <details className="table">
        <summary>Show as table</summary>
        <div className="scroll"><table>
          <thead><tr><th>Version</th><th>First seen</th><th className="n">Reviews</th><th className="n">1★ share</th><th className="n">Crash mentions (low-star)</th></tr></thead>
          <tbody>{versions.map(v => <tr key={v.version}><td>{v.version}{v.flagged ? ' (flagged)' : ''}</td><td>{v.firstSeen}</td><td className="n">{v.n}</td><td className="n">{v.oneStarPct}%</td><td className="n">{v.crashMentionsN} of {v.lowStarN}</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}

/* ---------- Weekly 1★ share line with crosshair ---------- */
function WeeklyTrend({ weekly }) {
  const box = useRef(null);
  const W = useWidth(box);
  const [hover, setHover] = useState(null);
  const H = 200, L = 34, R = 8, T = 10, B = 24;
  const ys = weekly.map(d => d.oneStarPct ?? 0);
  const ymax = Math.max(40, Math.ceil(Math.max(...ys) / 10) * 10);
  const x = i => L + i * (W - L - R) / (weekly.length - 1);
  const y = v => T + (H - T - B) * (1 - v / ymax);
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(weekly.length - 1, Math.round((e.clientX - r.left - L) / ((W - L - R) / (weekly.length - 1)))));
    setHover(i);
  };
  const d = hover != null ? weekly[hover] : null;
  return (
    <div className="chart" ref={box}>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly share of written reviews that are 1-star, last 26 weeks" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 10, 20, 30, 40, 50].filter(t => t <= ymax).map(t => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{t}%</text></g>
        ))}
        {[0, Math.floor(weekly.length / 2), weekly.length - 1].map(i => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === weekly.length - 1 ? 'end' : 'middle'}>{weekly[i].weekEnding}</text>)}
        <polyline points={weekly.map((d, i) => `${x(i)},${y(d.oneStarPct ?? 0)}`).join(' ')} fill="none" stroke="var(--series)" strokeWidth="2" strokeLinejoin="round" />
        {d && <>
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--ink-2)" />
          <circle cx={x(hover)} cy={y(d.oneStarPct ?? 0)} r="5" fill="var(--series)" stroke="var(--paper)" strokeWidth="2" />
        </>}
      </svg>
      {d && <Tip tip={{ x: Math.min(x(hover) + 12, W - 190), y: 4, title: `${d.oneStarPct}% 1★`, lines: [`${d.oneStarN} of ${d.n} reviews`, `Week ending ${d.weekEnding}`] }} />}
      <details className="table">
        <summary>Show as table</summary>
        <div className="scroll"><table>
          <thead><tr><th>Week ending</th><th className="n">Reviews</th><th className="n">1★</th><th className="n">1★ share</th></tr></thead>
          <tbody>{weekly.map(w => <tr key={w.weekEnding}><td>{w.weekEnding}</td><td className="n">{w.n}</td><td className="n">{w.oneStarN}</td><td className="n">{w.oneStarPct ?? '–'}%</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}

/* ---------- Developer reply rate by quarter ---------- */
function ReplyHistory({ quarters }) {
  const box = useRef(null);
  const W = useWidth(box);
  const [tip, setTip] = useState(null);
  const H = 190, L = 40, R = 4, T = 10, B = 26;
  const band = (W - L - R) / quarters.length, bw = Math.max(4, band - 2);
  const y = v => T + (H - T - B) * (1 - v / 100);
  return (
    <div className="chart" ref={box} onMouseLeave={() => setTip(null)}>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of 1 and 2 star reviews that received a developer reply, by quarter">
        {[0, 50, 100].map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{t}%</text></g>)}
        {quarters.map((q, i) => {
          const x = L + i * band + 1, h = y(0) - y(q.repliedPct || 0);
          const show = () => setTip({ x: Math.min(Math.max(0, x - 80), W - 190), y: Math.max(0, y(q.repliedPct || 0) - 70), title: `${q.repliedPct}% replied`, lines: [`${q.repliedN} of ${q.lowStarN} low-star reviews`, q.quarter] });
          return (
            <g key={q.quarter} tabIndex={0} onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)} aria-label={`${q.quarter}: ${q.repliedPct}% replied`}>
              <rect x={L + i * band} y={T} width={band} height={H - T - B} fill="transparent" />
              <path d={barPath(x, y(q.repliedPct || 0), bw, Math.max(h, q.repliedN ? 2 : 0))} fill="var(--series)" />
              {(i % 2 === 0 || band > 50) && <text x={x + bw / 2} y={H - 8} textAnchor="middle">{q.quarter.replace('-', ' ')}</text>}
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/* ---------- Action list grouped by owner ---------- */
function Actions({ issues }) {
  const owners = useMemo(() => {
    const c = {}; issues.forEach(i => { c[i.owner] = (c[i.owner] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [issues]);
  const [owner, setOwner] = useState('All');
  const [open, setOpen] = useState(issues[0]?.issue ?? null);
  const list = issues.filter(i => owner === 'All' || i.owner === owner);
  return (
    <>
      <div className="chips" role="group" aria-label="Filter by owner">
        {[['All', issues.length], ...owners].map(([o, n]) => (
          <button key={o} className="chip" aria-pressed={owner === o} onClick={() => setOwner(o)}>{o}<em>{n}</em></button>
        ))}
      </div>
      <ol className="actions" style={{ marginTop: 16 }}>
        {list.map(i => {
          const rank = issues.indexOf(i) + 1;
          const up = (i.last30Pct ?? 0) - (i.prior60Pct ?? 0);
          const isOpen = open === i.issue;
          return (
            <li key={i.issue} className={`act${isOpen ? ' open' : ''}`}>
              <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.issue)}>
                <span className="rank">{rank}</span>
                <span className="act-title">{i.label}</span>
                <span className="act-owner">{i.owner}</span>
                <span className="act-count"><b>{i.primaryN90}</b> <small>main complaint, {i.mentionsN90} mentions</small></span>
                <span className="act-trend">
                  <span className={up >= 3 ? 'delta-up' : up <= -3 ? 'delta-down' : ''}>{i.last30Pct ?? 0}%</span>
                  <small>last 30d, was {i.prior60Pct ?? 0}%</small>
                </span>
                <span className="caret" aria-hidden="true">›</span>
              </button>
              {isOpen && (
                <div className="act-body">
                  <div><h4>What to change</h4><p>{i.playbook.app_side_fix || 'Read the examples and decide.'}</p></div>
                  <div><h4>First check</h4><p>{i.playbook.first_diagnostic_check || '–'}</p></div>
                  <div><h4>How we'll know it worked</h4><p>{i.playbook.success_metric || '–'}</p></div>
                  <div><h4>Data we need</h4><p>{i.playbook.missing_data || '–'}</p></div>
                  <div><h4>Where it shows up</h4><p>{i.affectedVersions || 'No version pattern'}{i.devices ? `. Devices named: ${i.devices}` : ''}. Cause: {i.cause}{i.causeSharePct != null ? ` (${i.causeSharePct}% of these reviews)` : ''}.</p></div>
                  <div><h4>Confidence</h4><p>{i.confidence[0].toUpperCase() + i.confidence.slice(1)}, from {i.primaryN90} reviews{i.meanConfidence != null ? ` with average label confidence ${Math.round(i.meanConfidence * 100)}%` : ''}.</p></div>
                  <div className="quotes">
                    {i.examples.slice(0, 2).map(e => (
                      <blockquote key={e.id}>{e.text}<footer>{e.stars}★, {e.date}, version {e.version ?? 'unknown'}</footer></blockquote>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ---------- Reply queue ---------- */
function ReplyQueue({ queue, total }) {
  const [n, setN] = useState(6);
  const [copied, setCopied] = useState(null);
  if (!queue.length) return <div className="empty">No unanswered 1–2★ reviews in the last 60 days.</div>;
  const copy = async (id, text) => {
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    setCopied(id); setTimeout(() => setCopied(c => (c === id ? null : c)), 1800);
  };
  return (
    <>
      <div className="replies">
        {queue.slice(0, n).map(q => (
          <article className="reply" key={q.id}>
            <div className="reply-review">
              <div className="reply-meta">
                <span className="stars">{q.stars}★</span><span>{q.date}</span><span>version {q.version ?? 'unknown'}</span>
                {q.issue && <span>{q.issue}</span>}
                {q.safety && <span className="safety">Safety</span>}
              </div>
              <p style={{ margin: 0 }}>{q.text}</p>
            </div>
            <div className="reply-draft">
              {q.draft ? <p>{q.draft}</p> : <p style={{ color: 'var(--ink-2)' }}>No draft yet. Run npm run replies.</p>}
              <div className="reply-actions">
                <span>{q.draft ? `${q.draft.length}/350 characters${q.draftKind === 'template' ? ', template: personalise first' : ''}` : ''}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  {q.url && <a className="btn ghost" href={q.url} target="_blank" rel="noreferrer">Open review</a>}
                  {q.draft && <button className={`btn${copied === q.id ? ' done' : ''}`} onClick={() => copy(q.id, q.draft)}>{copied === q.id ? 'Copied' : 'Copy reply'}</button>}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
      {n < queue.length && <button className="btn ghost more" onClick={() => setN(queue.length)}>Show {queue.length - n} more</button>}
      {total > queue.length && <p className="lede">The full list of {total} drafts is in reply_drafts.csv.</p>}
    </>
  );
}

export default function App({ data }) {
  if (!data) return <main className="page"><div className="verdict"><h1>No brief yet.</h1><p>Run <code>npm run report</code> to create docs/data/brief.js, then reload this page.</p></div></main>;
  const w = data.windows, s = data.store, v = data.verdict;
  const delta = w.d30.oneStarPct != null && w.prev30.oneStarPct != null ? w.d30.oneStarPct - w.prev30.oneStarPct : null;
  const quarters = data.replyHistory.filter(q => q.quarter >= '2023');
  const peak = quarters.find(q => q.repliedPct >= 90);
  const peakIdx = quarters.findIndex(q => q.repliedPct >= 90);
  const drop = quarters.find((q, i) => i > peakIdx && peakIdx >= 0 && q.repliedPct < 10);
  const alarm = !!data.versionStrip.find(x => x.flagged) || v.direction === 'worse';
  return (
    <main className="page">
      <header className="bar">
        <div className="brand">Ratings brief <span>for the MoveInSync employee app</span></div>
        <div className="bar-meta"><span>Updated {data.runDate ?? data.asOf}, reviews up to {data.asOf}</span><span>Updates every Monday</span></div>
      </header>

      <div className="verdict">
        <div className={`verdict-tag${alarm ? '' : ' calm'}`}><i />{alarm ? 'Needs action this week' : 'No new alarms this week'}</div>
        <h1>{v.headline}</h1>
        <p>{v.detail}</p>
        {v.firstMove && (
          <div className="first-move">
            <b>First move</b><span>{v.firstMove.owner}: {v.firstMove.check}</span>
          </div>
        )}
      </div>

      <div className="numbers">
        <div className="num"><strong>{s ? s.score.toFixed(2) : '–'}★</strong><small>Play Store rating from {s ? fmt(s.ratings) : '–'} ratings</small></div>
        <div className="num"><strong>{w.d30.oneStarPct}%</strong><small>of written reviews in the last 30 days are 1★ (n={w.d30.n}), <span className={delta >= 3 ? 'delta-up' : delta <= -3 ? 'delta-down' : ''}>{pp(delta)}</span> on the 30 days before</small></div>
        <div className="num"><strong className={w.d30.lowRepliedPct < 50 ? 'alert' : ''}>{w.d30.lowRepliedPct}%</strong><small>of 1–2★ reviews got a reply in the last 30 days ({w.d30.lowRepliedN} of {w.d30.lowN})</small></div>
        <div className="num"><strong className="alert">{data.unansweredCritical60dN}</strong><small>critical reviews from the last 60 days still have no reply</small></div>
      </div>

      <section aria-labelledby="releases">
        <div className="sec-head"><div>
          <h2 id="releases">Which release hurt</h2>
          <p className="lede">Share of each version's reviews that are 1★. A version is flagged when it sits well above the 12-month average.</p>
        </div></div>
        <ReleaseStrip versions={data.versionStrip} baseline={data.baselineOneStarPct} />
      </section>

      <section aria-labelledby="actions">
        <div className="sec-head"><div>
          <h2 id="actions">What to fix, and who owns it</h2>
          <p className="lede">From {data.low90.n} 1–2★ reviews in the last 90 days; {data.low90.noSignalN} said nothing specific and are left out. Ranked by how often each problem is the main complaint, weighted by severity.</p>
        </div></div>
        <Actions issues={data.issuesDetailed} />
      </section>

      <section aria-labelledby="reply">
        <div className="sec-head"><div>
          <h2 id="reply">Reply today</h2>
          <p className="lede">Unanswered 1–2★ reviews, safety and blocked users first. Each draft is under Play's 350-character limit and promises nothing we can't check. Read it before you post it.</p>
        </div></div>
        <ReplyQueue queue={data.replyQueue} total={data.unansweredCritical60dN} />
      </section>

      <section aria-labelledby="replyrate">
        <div className="sec-head"><div>
          <h2 id="replyrate">We used to answer every bad review</h2>
          <p className="lede">{peak && drop ? `Replies to 1–2★ reviews ran at ${peak.repliedPct}% in ${peak.quarter.replace('-', ' ')} and were down to ${drop.repliedPct}% by ${drop.quarter.replace('-', ' ')}. Since then, most unhappy reviewers hear nothing back.` : 'Share of 1–2★ reviews that got a developer reply, by quarter.'}</p>
        </div></div>
        <ReplyHistory quarters={quarters} />
      </section>

      <section aria-labelledby="trend">
        <div className="sec-head"><div>
          <h2 id="trend">1★ share, week by week</h2>
          <p className="lede">Written reviews only, last 26 weeks. Silent star ratings are kinder; this line tracks what unhappy users say.</p>
        </div></div>
        <WeeklyTrend weekly={data.weekly} />
      </section>

      <section className="two" aria-label="Changes and progress">
        <div>
          <h2>Since the last run</h2>
          {data.changesSincePrevious.previous
            ? (data.changesSincePrevious.items.length ? <ul className="plain">{data.changesSincePrevious.items.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="lede">No material changes since {data.changesSincePrevious.previous}.</p>)
            : <p className="lede">This is the first run, so it sets the baseline. Next Monday this lists what moved.</p>}
        </div>
        <div>
          <h2>Is it working?</h2>
          <div className="scroll"><table>
            <thead><tr><th>Issue</th><th className="n">Last run</th><th className="n">Now</th></tr></thead>
            <tbody>{data.tracking.slice(0, 6).map(t => <tr key={t.issue}><td>{t.issue}</td><td className="n">{t.before ?? '–'}</td><td className="n">{t.now}</td></tr>)}</tbody>
          </table></div>
        </div>
      </section>

      <footer className="method">
        <span>Source: public Google Play reviews of com.moveinsync.ets (India, English), collected weekly. Written reviews skew negative compared with silent star ratings, and this is Android only.</span>
        <span>Labels by {data.labelProvider} ({data.labelModel}), taxonomy {data.taxonomyVersion}{(data.labelCoverage?.stale || data.labelCoverage?.unlabelled) ? `; ${(data.labelCoverage.stale || 0) + (data.labelCoverage.unlabelled || 0)} reviews still await labels and are left out` : ''}.{data.validation?.length ? ` Human spot-check: ${data.validation.map(x => `${x.correct} of ${x.checked} correct (${x.round})`).join(', ')}.` : ''}</span>
        <span>Files: reports/{data.asOf}/action_queue.csv, reply_drafts.csv, brief.md, metrics.json. Generated {data.generatedAt.slice(0, 16).replace('T', ' ')} UTC.</span>
      </footer>
    </main>
  );
}
