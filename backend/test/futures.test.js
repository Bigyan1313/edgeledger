// Futures pricing. Before this, every MNQ trade had a null riskDollars and a
// null R-multiple, because only CFD and spot symbols had contract sizes. The
// numbers below are CME contract specifications; the regression block makes
// sure adding futures moved nothing that already priced.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseFuturesSymbol, contractSizeFor } from '../src/domain/tradeSchema.js'
import { computeRiskDollars, computeRMultiple } from '../src/domain/derived.js'

describe('reading a futures symbol', () => {
  test('the platforms all write the same contract differently', () => {
    const z6 = { root: 'MNQ', month: 'Z', year: 6 }
    assert.deepEqual(parseFuturesSymbol('MNQZ6'), z6)
    assert.deepEqual(parseFuturesSymbol('MNQZ26'), z6)
    assert.deepEqual(parseFuturesSymbol('MNQZ2026'), z6)
    assert.deepEqual(parseFuturesSymbol('MNQ 12-26'), z6)
    assert.deepEqual(parseFuturesSymbol('/MNQZ6'), z6)
    assert.deepEqual(parseFuturesSymbol(' mnqz6 '), z6)
  })

  test('continuous and bare roots have no month', () => {
    assert.deepEqual(parseFuturesSymbol('MNQ1!'), { root: 'MNQ', month: null, year: null })
    assert.deepEqual(parseFuturesSymbol('ES'), { root: 'ES', month: null, year: null })
  })

  test('roots containing month letters or digits split correctly', () => {
    assert.equal(parseFuturesSymbol('NQN7').root, 'NQ')      // N is also July
    assert.equal(parseFuturesSymbol('NQQ7').root, 'NQ')      // Q is also August
    assert.equal(parseFuturesSymbol('MNQN7').root, 'MNQ')
    assert.equal(parseFuturesSymbol('M2KH7').root, 'M2K')
    assert.equal(parseFuturesSymbol('6EZ6').root, '6E')
    assert.equal(parseFuturesSymbol('SILZ6').root, 'SIL')
    assert.equal(parseFuturesSymbol('SIZ6').root, 'SI')
  })

  test('CFD and spot symbols are not mistaken for futures', () => {
    for (const s of ['XAUUSD', 'XAUUSD.pro', 'EURUSD', 'NAS100', 'US30', 'GER40', 'BTCUSD', 'USTEC', '']) {
      assert.equal(parseFuturesSymbol(s), null, s)
    }
  })

  test('a month number outside 1–12 is not a contract', () => {
    assert.equal(parseFuturesSymbol('MNQ 13-26'), null)
  })
})

describe('dollar risk on futures', () => {
  const trade = (pair, entryPrice, stopLoss, lotSize) => ({ pair, entryPrice, stopLoss, lotSize })

  test('MNQ: 20 points × 1 contract × $2 = $40', () => {
    assert.equal(computeRiskDollars(trade('MNQZ6', 21000, 20980, 1)), 40)
  })
  test('NQ: 20 points × 1 contract × $20 = $400', () => {
    assert.equal(computeRiskDollars(trade('NQZ6', 21000, 20980, 1)), 400)
  })
  test('MES: 4.25 points × 3 contracts × $5 = $63.75', () => {
    assert.equal(computeRiskDollars(trade('MESZ6', 6000, 5995.75, 3)), 63.75)
  })
  test('MGC: $3 × 2 contracts × $10 = $60', () => {
    assert.equal(computeRiskDollars(trade('MGCZ6', 2350, 2347, 2)), 60)
  })
  test('MCL: $0.20 × 1 contract × $100 = $20', () => {
    assert.equal(computeRiskDollars(trade('MCLX6', 70.5, 70.3, 1)), 20)
  })
  test('the NinjaTrader spelling prices the same', () => {
    assert.equal(computeRiskDollars(trade('MNQ 12-26', 21000, 20980, 1)), 40)
  })

  test('an R-multiple now exists for a closed futures trade', () => {
    // Risked $40, made $100 → 2.5R.
    const r = computeRMultiple({ ...trade('MNQZ6', 21000, 20980, 1), pnl: 100 })
    assert.equal(r, 2.5)
  })

  test('an unknown root still yields null, not a guess', () => {
    assert.equal(computeRiskDollars(trade('ZZZZ6', 100, 99, 1)), null)
  })
})

describe('nothing that already priced has moved', () => {
  test('CFD and spot contract sizes are unchanged', () => {
    assert.equal(contractSizeFor('XAUUSD.pro'), 100)
    assert.equal(contractSizeFor('EURUSD'), 100_000)
    assert.equal(contractSizeFor('NAS100.pro'), 1)
    assert.equal(contractSizeFor('BTCUSD'), 1)
  })
  test('gold CFD risk is what it always was', () => {
    assert.equal(computeRiskDollars({ pair: 'XAUUSD.pro', entryPrice: 2350, stopLoss: 2345, lotSize: 0.5 }), 250)
  })
})
