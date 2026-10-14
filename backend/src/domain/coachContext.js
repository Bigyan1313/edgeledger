// What Edge, the in-app assistant, knows about the trader on each message.
//
// The assistant is only useful at the moment of decision if it can see what
// the trader committed to: today's plan, how many trades are left, how far
// each account is from being lost, and how the recent trades went against the
// rules. This turns the raw rows into a compact, readable brief. Pure, so the
// exact text the model sees is testable.
//
// Everything here is the trader's own journal. Free-text fields are their
// writing and are passed as data, inside a fenced block the system prompt
// tells the model not to take instructions from.

const money = (v) => (v == null ? 'n/a' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`)
const clip = (s, n = 160) => {
  if (s == null) return ''
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function formatCoachContext({ now, timezone, today, profile, sessions, standings, trades, reviews, reviewWindow }) {
  const lines = []
  const add = (s = '') => lines.push(s)

  add(`Now: ${now.toISOString()} (market day ${today}, ${timezone}).`)
  if (profile?.displayName) add(`Trader: ${clip(profile.displayName, 40)}.`)

  add('', '## Today\'s session plans')
  if (!sessions.length) {
    add('No plan written today on any account. If session rules are on, a trade logged now is refused as "no session plan".')
  }
  for (const s of sessions) {
    const acct = s.account?.name ?? 'no account'
    if (s.status === 'blocked') {
      add(`- ${acct}: NO-TRADE DAY (readiness failed). Reasons: ${s.blockedReasons.join(' ')}`)
      continue
    }
    const left = s.status === 'open' ? Math.max(0, s.maxTrades - s.tradesLogged) : 0
    add(`- ${acct}: ${s.status}. Trades used ${s.tradesLogged} of ${s.maxTrades}; ${left} left.${s.tradesLogged > s.maxTrades ? ' OVER THE LIMIT.' : ''}`)
    add(`  Slept ${s.sleepHours}h (floor ${s.minSleepHoursApplied}h).${s.bias ? ` Bias ${s.bias}.` : ''}`)
    add(`  Wants to see: ${clip(s.wantToSee)}`)
    for (const sc of s.scenarios ?? []) add(`  If ${clip(sc.if, 100)} → then ${clip(sc.then, 100)}`)
    add(`  NO TRADE IF: ${clip(s.noTradeIf)}`)
    if (s.status === 'closed') add(`  Closed. Followed plan: ${s.followedPlan ? 'yes' : 'no'}.${s.review ? ` Review: ${clip(s.review)}` : ''}`)
  }

  add('', '## Accounts — distance to losing')
  if (!standings.length) add('No account has a starting balance set, so distance to losing is unknown.')
  for (const { name, standing: st } of standings) {
    if (!st.configured) { add(`- ${name}: no starting balance set.`); continue }
    if (st.status === 'no_rules') { add(`- ${name}: balance ${money(st.balance)}; no loss rules entered.`); continue }
    const parts = [`balance ${money(st.balance)}`]
    if (st.dailyRemaining != null) parts.push(`daily loss room ${money(st.dailyRemaining)} (today ${money(st.todayPnl)})`)
    if (st.distanceToFloor != null) parts.push(`${money(st.distanceToFloor)} above the drawdown floor ${money(st.floor)}`)
    parts.push(`binding limit: ${st.binding}`)
    if (st.openRisk) parts.push(`open stops risk ${money(st.openRisk)} → room if all stops hit ${money(st.roomIfStopsHit)}`)
    add(`- ${name}: ${parts.join('; ')}. Status: ${st.status.toUpperCase()}.`)
  }

  add('', '## Price action review')
  add(reviewWindow.state === 'open'
    ? `Today's review window is open${reviewWindow.writtenToday ? ' and a review is written.' : ' and NOT yet written.'}`
    : reviewWindow.state === 'not_yet' ? `Opens at ${reviewWindow.opensAt.toISOString()}.` : 'Markets closed today.')
  for (const r of reviews) {
    add(`- ${r.reviewDate} ${r.symbol}: ${r.dayType}; plan played out: ${r.planPlayedOut ?? 'no plan'}; valid setup: ${r.validSetup ? 'yes' : 'no'}.${r.lesson ? ` Lesson: ${clip(r.lesson, 120)}` : ''}`)
  }

  add('', `## Recent trades (newest first, ${trades.length})`)
  if (!trades.length) add('None logged.')
  for (const t of trades) {
    const result = t.entryStage === 'pending_exit' ? 'OPEN' : `${t.outcome ?? '?'} ${money(t.pnl)}${t.rMultiple != null ? ` (${t.rMultiple}R)` : ''}`
    const risk = t.riskDollars != null ? ` risk ${money(t.riskDollars)}` : ''
    const breaks = t.ruleViolations?.length ? ` RULE BREAK: ${t.ruleViolations.join(', ')}.` : ''
    const state = [t.technicalSetup, t.emotionalState].filter(Boolean).join(' / ')
    add(`- ${new Date(t.entryTimeUtc).toISOString().slice(0, 16)}Z ${t.pair} ${t.direction} ${t.lotSize ?? '?'}${risk} → ${result}.${state ? ` ${state}.` : ''}${t.followedChecklist === false ? ' Checklist NOT followed.' : ''}${breaks}`)
  }

  return lines.join('\n')
}
