// Reading Tradovate exports and matching them to the journal.
//
// The first fixture follows the layout of a real Performance report the
// trader supplied — its headers, its "$(97.00)" losses, a short whose Sell
// Time comes before its Buy Time, one order arriving as two rows — with the
// numbers changed. The others cover the CSV spellings and the Orders shape.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv, parseMoney, parseTimestamp, readExport, buildTrades, matchTrades, sameInstrument,
} from '../src/domain/tradovate.js'

const CT = 'America/Chicago'

// Performance report, display headers. A 5-lot MNQ short in two rows, and a
// 2-lot long. Times are Central — 08:31 is one minute after the 9:30 ET open.
const PERFORMANCE = [
  'Symbol,Qty,Buy Price,Buy Time,Duration,Sell Time,Sell Price,P&L',
  'MNQZ6,1,21040.50,10/13/2026 08:36:10,"2min 11sec",10/13/2026 08:33:59,21020.25,$(40.50)',
  'MNQZ6,4,21040.50,10/13/2026 08:36:10,"2min 11sec",10/13/2026 08:33:59,21020.25,$(162.00)',
  'MESZ6,2,6001.00,10/13/2026 09:05:00,"10min 0sec",10/13/2026 09:15:00,6005.00,$40.00',
].join('\n')

// Performance report as the CSV download spells it, with fill IDs. One 2-lot
// long scaled out in two rows at different prices.
const PERFORMANCE_CSV = [
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
  'MNQZ6,-2,0,0.25,9001,9002,1,21000.00,21010.00,$20.00,10/14/2026 08:40:00,10/14/2026 08:45:00,5min 0sec',
  'MNQZ6,-2,0,0.25,9001,9003,1,21000.00,21020.00,$40.00,10/14/2026 08:40:00,10/14/2026 08:50:00,10min 0sec',
].join('\n')

// Orders report: one row per order, a cancelled one among them.
const ORDERS = [
  'orderId,Account,Order ID,B/S,Contract,Product,avgPrice,filledQty,Fill Time,Status,Quantity',
  '1,ACC-1,1,Buy,MNQZ6,MNQ,21000.00,2,10/14/2026 08:40:00,Filled,2',
  '2,ACC-1,2,Sell,MNQZ6,MNQ,21010.00,1,10/14/2026 08:45:00,Filled,1',
  '3,ACC-1,3,Sell,MNQZ6,MNQ,0,0,,Canceled,1',
  '4,ACC-1,4,Sell,MNQZ6,MNQ,21020.00,1,10/14/2026 08:50:00,Filled,1',
].join('\n')

describe('reading values', () => {
  test('money, in every way a statement writes it', () => {
    assert.equal(parseMoney('$(97.00)'), -97)
    assert.equal(parseMoney('(388.00)'), -388)
    assert.equal(parseMoney('$1,250.50'), 1250.5)
    assert.equal(parseMoney('-25'), -25)
    assert.equal(parseMoney('$0.00'), 0)
    assert.equal(parseMoney('n/a'), null)
    assert.equal(parseMoney(''), null)
  })

  test('a Central-time stamp becomes the right instant', () => {
    // 08:31:59 CDT is 13:31:59 UTC — one minute after the New York open.
    assert.equal(parseTimestamp('10/13/2026 08:31:59', CT).toISOString(), '2026-10-13T13:31:59.000Z')
  })

  test('12-hour and ISO forms are read too', () => {
    assert.equal(parseTimestamp('10/13/2026 8:31:59 AM', CT).toISOString(), '2026-10-13T13:31:59.000Z')
    assert.equal(parseTimestamp('10/13/2026 12:05:00 PM', CT).toISOString(), '2026-10-13T17:05:00.000Z')
    assert.equal(parseTimestamp('2026-10-13T13:31:59Z', CT).toISOString(), '2026-10-13T13:31:59.000Z')
  })

  test('an impossible date is refused, not rolled over', () => {
    assert.equal(parseTimestamp('02/30/2026 08:00:00', CT), null)
    assert.equal(parseTimestamp('10/13/2026 25:00:00', CT), null)
    assert.equal(parseTimestamp('10/13/2026 08:31 maybe', CT), null)
  })

  test('quoted fields with commas and newlines survive', () => {
    assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\n'), [['a', 'b'], ['x, y', 'line1\nline2']])
  })
})

describe('the Performance report', () => {
  const read = readExport(PERFORMANCE, { timeZone: CT })
  const trades = buildTrades(read.fills)

  test('is recognised by its own headers', () => {
    assert.equal(read.shape, 'round_trips')
    assert.equal(read.skipped.length, 0)
  })

  test('a short is read from its Sell Time coming first', () => {
    const short = trades.find(t => t.symbol === 'MNQZ6')
    assert.equal(short.direction, 'short')
    assert.equal(short.entryPrice, 21020.25)
    assert.equal(short.exitPrice, 21040.5)
    assert.equal(short.entryAt.toISOString(), '2026-10-13T13:33:59.000Z')
  })

  test('one order in two rows is one trade, with the broker\'s P&L added up', () => {
    const short = trades.find(t => t.symbol === 'MNQZ6')
    assert.equal(short.qty, 5)
    assert.equal(short.pnl, -202.5)
    assert.equal(short.pnlSource, 'broker')
  })

  test('a long is a long', () => {
    const long = trades.find(t => t.symbol === 'MESZ6')
    assert.equal(long.direction, 'long')
    assert.equal(long.pnl, 40)
  })
})

describe('the CSV spelling, with a scale-out', () => {
  const trades = buildTrades(readExport(PERFORMANCE_CSV, { timeZone: CT }).fills)

  test('two exits are one trade at the average exit price', () => {
    assert.equal(trades.length, 1)
    assert.equal(trades[0].qty, 2)
    assert.equal(trades[0].exitPrice, 21015)
    assert.equal(trades[0].pnl, 60)
    assert.equal(trades[0].exitAt.toISOString(), '2026-10-14T13:50:00.000Z')
  })

  test('the entry fill ID is kept for exact matching', () => {
    assert.deepEqual(trades[0].entryIds, ['9001'])
  })
})

describe('two entries closed by one exit fill', () => {
  // Seen in a real export: a 6-lot and a 4-lot entry, both closed by one
  // 10-lot exit fill, reported as two rows sharing a sellFillId.
  const SHARED_EXIT = [
    'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
    'MNQZ6,-2,0,0.25,5101,5199,6,21000.00,20995.50,$(54.00),10/13/2026 09:07:52,10/13/2026 09:11:31,3min 39sec',
    'MNQZ6,-2,0,0.25,5102,5199,4,21000.00,20995.50,$(36.00),10/13/2026 09:07:52,10/13/2026 09:11:31,3min 39sec',
  ].join('\r\n')
  const trades = buildTrades(readExport(SHARED_EXIT, { timeZone: CT }).fills)

  test('is one 10-lot trade carrying both entry fill IDs', () => {
    assert.equal(trades.length, 1)
    assert.equal(trades[0].qty, 10)
    assert.equal(trades[0].pnl, -90)
    assert.deepEqual(trades[0].entryIds, ['5101', '5102'])
  })

  test('Windows line endings are read the same', () => {
    assert.equal(readExport(SHARED_EXIT, { timeZone: CT }).skipped.length, 0)
  })
})

describe('the Orders report', () => {
  const read = readExport(ORDERS, { timeZone: CT })
  const trades = buildTrades(read.fills)

  test('is recognised, and a cancelled order is ignored', () => {
    assert.equal(read.shape, 'executions')
    assert.equal(read.fills.length, 3)
  })

  test('fills pair into the same trade the Performance report shows', () => {
    assert.equal(trades.length, 1)
    assert.equal(trades[0].qty, 2)
    assert.equal(trades[0].exitPrice, 21015)
  })

  test('with no P&L column, P&L is computed from the point value', () => {
    // (21015 − 21000) × 2 contracts × $2 = $60
    assert.equal(trades[0].pnl, 60)
    assert.equal(trades[0].pnlSource, 'computed')
  })

  test('a position still open at the end of the file is not a closed trade', () => {
    const open = ORDERS.split('\n').slice(0, 3).join('\n') // bought 2, sold 1
    assert.equal(buildTrades(readExport(open, { timeZone: CT }).fills).length, 0)
  })
})

describe('a file that is neither', () => {
  test('is refused, naming what was looked for and what was found', () => {
    const r = readExport('Date,Description,Amount\n10/13/2026,Fee,1.00', { timeZone: CT })
    assert.match(r.error, /does not look like a Tradovate/)
    assert.deepEqual(r.found, ['Date', 'Description', 'Amount'])
    assert.ok(r.lookedFor.roundTrips.includes('boughtAt'))
  })

  test('an unreadable row is skipped and named, not guessed at', () => {
    const bad = PERFORMANCE.replace('10/13/2026 09:15:00', '13/45/2026 09:15:00')
    const r = readExport(bad, { timeZone: CT })
    assert.equal(r.skipped.length, 1)
    assert.equal(r.skipped[0].line, 4)
  })
})

describe('matching broker trades to the journal', () => {
  const broker = buildTrades(readExport(PERFORMANCE, { timeZone: CT }).fills)
  const short = (over = {}) => ({
    id: 1, pair: 'MNQZ6', direction: 'short', lotSize: 5, entryStage: 'pending_exit', brokerPositionId: null,
    entryTimeUtc: '2026-10-13T13:34:00.000Z', ...over,
  })

  test('symbol, direction, size and a nearby entry time make a match', () => {
    const [r] = matchTrades(broker, [short()])
    assert.equal(r.status, 'will_close')
    assert.equal(r.trade.id, 1)
    assert.equal(r.by, 'time')
  })

  test('the NinjaTrader spelling of the same contract matches', () => {
    assert.equal(matchTrades(broker, [short({ pair: 'MNQ 12-26' })])[0].status, 'will_close')
  })

  test('a different contract month does not', () => {
    assert.equal(sameInstrument('MNQZ6', 'MNQH7'), false)
    assert.equal(matchTrades(broker, [short({ pair: 'MNQH7' })])[0].status, 'not_in_journal')
  })

  test('wrong size, wrong direction, or too far in time do not match', () => {
    assert.equal(matchTrades(broker, [short({ lotSize: 4 })])[0].status, 'not_in_journal')
    assert.equal(matchTrades(broker, [short({ direction: 'long' })])[0].status, 'not_in_journal')
    assert.equal(matchTrades(broker, [short({ entryTimeUtc: '2026-10-13T13:40:00.000Z' })])[0].status, 'not_in_journal')
  })

  test('a journal trade already closed is reported, not touched', () => {
    assert.equal(matchTrades(broker, [short({ entryStage: 'complete' })])[0].status, 'already_closed')
  })

  test('two journal trades too close in time to tell apart are left alone', () => {
    const r = matchTrades(broker, [short({ id: 1 }), short({ id: 2, entryTimeUtc: '2026-10-13T13:34:10.000Z' })])[0]
    assert.equal(r.status, 'ambiguous')
    assert.deepEqual(r.candidates.sort(), [1, 2])
  })

  test('a journal trade is never matched twice', () => {
    const twice = [broker[0], { ...broker[0] }]
    const results = matchTrades(twice, [short()])
    assert.equal(results.filter(r => r.trade).length, 1)
  })

  test('a position ID equal to the entry fill ID matches exactly, even off on time', () => {
    const csvBroker = buildTrades(readExport(PERFORMANCE_CSV, { timeZone: CT }).fills)
    const [r] = matchTrades(csvBroker, [{
      id: 7, pair: 'MNQZ6', direction: 'long', lotSize: 2, entryStage: 'pending_exit',
      brokerPositionId: '9001', entryTimeUtc: '2026-10-14T15:00:00.000Z',
    }])
    assert.equal(r.status, 'will_close')
    assert.equal(r.by, 'position_id')
  })

  test('broker trades with no journal entry are reported as such', () => {
    const results = matchTrades(broker, [])
    assert.ok(results.every(r => r.status === 'not_in_journal'))
  })
})
