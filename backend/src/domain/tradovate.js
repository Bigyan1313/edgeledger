// Tradovate fills → closed journal trades. The free alternative to the paid
// API: export a report from Tradovate, and the journal fills in each trade's
// exit, exit time and P&L from the broker's own numbers.
//
// What this deliberately does NOT do is create trades. A journal entry is the
// plan written before the trade (Stage A), and a broker export can only ever
// say what happened afterwards. A fill with no journal entry behind it is
// reported as "not in your journal" — which, with session rules on, usually
// means a trade taken outside the plan.
//
// Two export shapes are accepted:
//   - round trips (the Performance report): one row per buy/sell pair. Its
//     display headers are "Symbol, Qty, Buy Price, Buy Time, Duration, Sell
//     Time, Sell Price, P&L"; the CSV may spell them boughtTimestamp etc.
//     A short appears with its Sell Time before its Buy Time, and one order
//     can arrive as several rows (5 contracts as 1 + 4).
//   - executions (the Orders or Fills report): one row per fill
// Columns are found by name, not position. A file that matches neither shape
// is refused with the columns that were looked for and the ones that were
// found, rather than half-read.

import { zonedTimeToInstant } from './review.js'
import { parseFuturesSymbol, normalizeSymbol, contractSizeFor } from './tradeSchema.js'

// How far a journaled entry time may sit from the real fill. Stage A times are
// typed by hand and often rounded, or stamped a minute after clicking.
export const MATCH_TOLERANCE_MS = 3 * 60 * 1000
// Two candidates closer together than this cannot be told apart by time.
const AMBIGUITY_MS = 30 * 1000

// --- CSV ---------------------------------------------------------------------------

// RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text).replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  return rows
}

// Header names compared loosely: "Avg Fill Price", "avgFillPrice" and
// "avg_fill_price" are one column.
const key = (h) => String(h).toLowerCase().replace(/[^a-z0-9&/]/g, '')

const ALIASES = {
  symbol: ['symbol', 'contract', 'contractname', 'instrument'],
  // filledqty before quantity: an Orders export carries both, and a
  // partially filled order's ordered quantity is not what traded.
  qty: ['qty', 'filledqty', 'fillqty', 'quantity'],
  buyPrice: ['buyprice'],
  sellPrice: ['sellprice'],
  boughtAt: ['boughttimestamp', 'boughttime', 'buytime'],
  soldAt: ['soldtimestamp', 'soldtime', 'selltime'],
  pnl: ['pnl', 'p&l', 'profitloss', 'realizedpnl'],
  buyFillId: ['buyfillid'],
  sellFillId: ['sellfillid'],
  side: ['b/s', 'side', 'action', 'buysell'],
  price: ['avgfillprice', 'avgprice', 'fillprice', 'price'],
  time: ['filltime', 'timestamp', 'time', 'datetime'],
  status: ['status'],
  id: ['fillid', 'orderid', 'id'],
}

function locate(header) {
  const keys = header.map(key)
  const at = {}
  for (const [name, aliases] of Object.entries(ALIASES)) {
    // The first alias present wins, so "avgfillprice" beats a generic "price".
    for (const alias of aliases) {
      const i = keys.indexOf(alias)
      if (i !== -1) { at[name] = i; break }
    }
  }
  return at
}

const ROUND_TRIP = ['symbol', 'qty', 'buyPrice', 'sellPrice', 'boughtAt', 'soldAt']
const EXECUTION = ['symbol', 'qty', 'side', 'price', 'time']

// --- values -------------------------------------------------------------------------

// "$1,250.00", "$(25.00)", "(25.00)", "-25", "25.5". Parentheses are a loss.
export function parseMoney(raw) {
  if (raw === undefined || raw === null) return null
  let s = String(raw).trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s.replace(/^\$/, '')) || /^\$\(.*\)$/.test(s)) negative = true
  s = s.replace(/[$,()\s]/g, '')
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1) }
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return negative ? -n : n
}

function parseNumber(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}

// Strict. JavaScript's Date would read "10/14/2026 9:42 maybe" as something;
// a wrong exit time is worse than a refused row. A time without an offset is
// read in the zone the trader says their platform displays.
export function parseTimestamp(raw, timeZone) {
  const s = String(raw ?? '').trim()
  let m
  if ((m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s))) {
    const [, y, mo, d, h, mi, sec = '00', offset] = m
    if (!validDate(+y, +mo, +d) || +h > 23 || +mi > 59 || +sec > 59) return null
    if (offset) {
      const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec}${offset === 'Z' ? 'Z' : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`
      const t = new Date(iso)
      return Number.isNaN(t.getTime()) ? null : t
    }
    return zonedTimeToInstant(`${y}-${mo}-${d}`, `${h}:${mi}:${sec}`, timeZone)
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?$/.exec(s))) {
    let [, mo, d, y, h, mi, sec = '00', ampm] = m
    let hour = Number(h)
    if (ampm) {
      if (hour < 1 || hour > 12) return null
      hour = (hour % 12) + (/p/i.test(ampm) ? 12 : 0)
    }
    if (!validDate(+y, +mo, +d) || hour > 23 || +mi > 59 || +sec > 59) return null
    const pad = (v) => String(v).padStart(2, '0')
    return zonedTimeToInstant(`${y}-${pad(mo)}-${pad(d)}`, `${pad(hour)}:${mi}:${sec}`, timeZone)
  }
  return null
}

function validDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

// --- reading the file -----------------------------------------------------------------

// Returns executions — one per fill — whichever shape the file was, plus the
// rows that could not be read and why.
export function readExport(text, { timeZone }) {
  const rows = parseCsv(text)
  if (rows.length < 2) return { error: 'That file has no rows to import.' }
  const [header, ...data] = rows
  const at = locate(header)
  const has = (names) => names.every(n => at[n] !== undefined)

  const fills = []
  const skipped = []
  const cell = (row, name) => (at[name] === undefined ? undefined : row[at[name]])

  if (has(ROUND_TRIP)) {
    data.forEach((row, i) => {
      const line = i + 2
      const qty = parseNumber(cell(row, 'qty'))
      const buyPrice = parseNumber(cell(row, 'buyPrice'))
      const sellPrice = parseNumber(cell(row, 'sellPrice'))
      const boughtAt = parseTimestamp(cell(row, 'boughtAt'), timeZone)
      const soldAt = parseTimestamp(cell(row, 'soldAt'), timeZone)
      const symbol = String(cell(row, 'symbol') ?? '').trim()
      if (!symbol || !(qty > 0) || buyPrice == null || sellPrice == null || !boughtAt || !soldAt) {
        skipped.push({ line, reason: 'A required value is missing or unreadable.' })
        return
      }
      // The pair's reported P&L rides on whichever fill closed it.
      const pnl = at.pnl === undefined ? null : parseMoney(cell(row, 'pnl'))
      const closesOnSell = soldAt >= boughtAt
      fills.push({ symbol, side: 'buy', qty, price: buyPrice, at: boughtAt, id: cell(row, 'buyFillId') || null, pnl: closesOnSell ? null : pnl, line })
      fills.push({ symbol, side: 'sell', qty, price: sellPrice, at: soldAt, id: cell(row, 'sellFillId') || null, pnl: closesOnSell ? pnl : null, line })
    })
    return { shape: 'round_trips', fills, skipped }
  }

  if (has(EXECUTION)) {
    data.forEach((row, i) => {
      const line = i + 2
      const status = cell(row, 'status')
      if (status !== undefined && String(status).trim() && !/^filled$/i.test(String(status).trim())) return
      const sideRaw = String(cell(row, 'side') ?? '').trim().toLowerCase()
      const side = ['b', 'buy', 'bot', 'bought'].includes(sideRaw) ? 'buy'
        : ['s', 'sell', 'sld', 'sold'].includes(sideRaw) ? 'sell' : null
      const qty = parseNumber(cell(row, 'qty'))
      const price = parseNumber(cell(row, 'price'))
      const filledAt = parseTimestamp(cell(row, 'time'), timeZone)
      const symbol = String(cell(row, 'symbol') ?? '').trim()
      if (!symbol || !side || !(qty > 0) || price == null || !filledAt) {
        skipped.push({ line, reason: 'A required value is missing or unreadable.' })
        return
      }
      fills.push({ symbol, side, qty, price, at: filledAt, id: cell(row, 'id') || null, pnl: null, line })
    })
    return { shape: 'executions', fills, skipped }
  }

  return {
    error: 'This does not look like a Tradovate Performance, Orders or Fills export.',
    lookedFor: { roundTrips: ROUND_TRIP, executions: EXECUTION },
    found: header.map(h => String(h).trim()),
  }
}

// --- fills → trades ----------------------------------------------------------------------

// The instrument a symbol names, for matching: root and contract month for a
// future (so MNQZ6 and "MNQ 12-26" agree), the bare symbol otherwise.
export function instrumentOf(symbol) {
  const f = parseFuturesSymbol(symbol)
  if (f) return { root: f.root, month: f.month, year: f.year }
  return { root: normalizeSymbol(symbol), month: null, year: null }
}

export function sameInstrument(a, b) {
  const x = instrumentOf(a)
  const y = instrumentOf(b)
  if (!x.root || x.root !== y.root) return false
  // A continuous or bare root matches any month of that root.
  if (x.month === null || y.month === null) return true
  return x.month === y.month && x.year === y.year
}

// Each flat-to-flat run of fills in one contract is one trade: scale-ins and
// scale-outs included. Fills are paired first-in, first-out.
export function buildTrades(fills) {
  const bySymbol = new Map()
  for (const f of [...fills].sort((a, b) => a.at - b.at)) {
    const k = String(f.symbol).trim().toUpperCase()
    if (!bySymbol.has(k)) bySymbol.set(k, [])
    bySymbol.get(k).push(f)
  }

  const trades = []
  for (const [symbol, list] of bySymbol) {
    let position = 0
    let current = null
    for (const f of list) {
      const signed = f.side === 'buy' ? f.qty : -f.qty
      if (position === 0) {
        current = {
          symbol, direction: f.side === 'buy' ? 'long' : 'short',
          entries: [], exits: [], reportedPnl: 0, reportedPnlComplete: true,
        }
      }
      const opening = position === 0 || Math.sign(signed) === Math.sign(position)
      if (opening) {
        current.entries.push(f)
        position += signed
        continue
      }
      // Closing — possibly through flat into a new position the other way.
      const closingQty = Math.min(Math.abs(signed), Math.abs(position))
      current.exits.push({ ...f, qty: closingQty })
      if (f.pnl == null) current.reportedPnlComplete = current.reportedPnlComplete && false
      else current.reportedPnl += f.pnl
      position += Math.sign(signed) * closingQty
      if (position === 0) {
        trades.push(finish(current))
        const remainder = Math.abs(signed) - closingQty
        if (remainder > 0) {
          current = { symbol, direction: f.side === 'buy' ? 'long' : 'short', entries: [{ ...f, qty: remainder, pnl: null }], exits: [], reportedPnl: 0, reportedPnlComplete: true }
          position = Math.sign(signed) * remainder
        }
      }
    }
    // Still open at the end of the export: not a closed trade, nothing to apply.
  }
  return trades.sort((a, b) => a.entryAt - b.entryAt)
}

const wavg = (legs) => legs.reduce((s, l) => s + l.price * l.qty, 0) / legs.reduce((s, l) => s + l.qty, 0)

function finish(t) {
  const qty = t.entries.reduce((s, l) => s + l.qty, 0)
  const entryPrice = wavg(t.entries)
  const exitPrice = wavg(t.exits)
  const entryAt = t.entries[0].at
  const exitAt = t.exits[t.exits.length - 1].at
  const pointValue = contractSizeFor(t.symbol)
  const move = t.direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice
  // The broker's own figure when every closing fill carried one; otherwise
  // computed from prices, which needs a known point value.
  const pnl = t.reportedPnlComplete && t.exits.length
    ? round2(t.reportedPnl)
    : pointValue == null ? null : round2(move * qty * pointValue)
  return {
    symbol: t.symbol, direction: t.direction, qty,
    entryAt, exitAt,
    entryPrice: round6(entryPrice), exitPrice: round6(exitPrice),
    pnl, pnlSource: t.reportedPnlComplete && t.exits.length ? 'broker' : pnl == null ? 'unknown' : 'computed',
    // One fill split across several report rows appears once per row.
    entryIds: [...new Set(t.entries.map(e => e.id).filter(Boolean).map(String))],
  }
}

const round2 = (v) => Math.round(v * 100) / 100
const round6 = (v) => Math.round(v * 1e6) / 1e6

// --- trades → journal ----------------------------------------------------------------------

// Pairs broker trades with journal trades. A journal trade is matched at most
// once, by its position ID if it carries a fill or order ID from the export,
// otherwise by instrument, direction, size and an entry time within the
// tolerance — closest first. Two candidates too close in time to tell apart
// are reported as ambiguous and left alone.
export function matchTrades(brokerTrades, journalTrades) {
  const results = brokerTrades.map(bt => ({ broker: bt, status: 'not_in_journal', trade: null, candidates: [] }))
  const used = new Set()

  // 1. Exact: a journaled position ID equal to one of the entry fill IDs.
  results.forEach(r => {
    const exact = journalTrades.find(t => !used.has(t.id) && t.brokerPositionId && r.broker.entryIds.includes(String(t.brokerPositionId)))
    if (exact) { r.trade = exact; used.add(exact.id); r.status = statusFor(exact); r.by = 'position_id' }
  })

  // 2. By description, closest entry time first across everything.
  const pairs = []
  results.forEach((r, i) => {
    if (r.trade) return
    for (const t of journalTrades) {
      if (used.has(t.id)) continue
      if (!sameInstrument(r.broker.symbol, t.pair)) continue
      if (t.direction !== r.broker.direction) continue
      if (Number(t.lotSize) !== r.broker.qty) continue
      const gap = Math.abs(new Date(t.entryTimeUtc).getTime() - r.broker.entryAt.getTime())
      if (gap <= MATCH_TOLERANCE_MS) pairs.push({ i, t, gap })
    }
  })

  // An ambiguous broker trade is decided before anything is assigned, so it
  // cannot quietly take a trade another broker trade needed.
  const byBroker = new Map()
  for (const p of pairs) {
    if (!byBroker.has(p.i)) byBroker.set(p.i, [])
    byBroker.get(p.i).push(p)
  }
  for (const [i, list] of byBroker) {
    list.sort((a, b) => a.gap - b.gap)
    if (list.length > 1 && list[1].gap - list[0].gap < AMBIGUITY_MS) {
      results[i].status = 'ambiguous'
      results[i].candidates = list.map(p => p.t.id)
    }
  }

  for (const p of pairs.sort((a, b) => a.gap - b.gap)) {
    const r = results[p.i]
    if (r.trade || r.status === 'ambiguous' || used.has(p.t.id)) continue
    r.trade = p.t
    used.add(p.t.id)
    r.status = statusFor(p.t)
    r.by = 'time'
  }
  return results
}

function statusFor(trade) {
  return trade.entryStage === 'pending_exit' ? 'will_close' : 'already_closed'
}
