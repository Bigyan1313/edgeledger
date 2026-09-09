#!/usr/bin/env node
// Renders realistic broker screenshots to PNG, each paired with the ground
// truth of what a correct transcription would be.
//
// Synthetic on purpose: real screenshots of a real account cannot be committed,
// and these can encode the specific traps that produce a plausible wrong number
// — European decimals, volume-in-units, parenthesised losses, a cropped column.
//
//   node eval/build-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwright is a dev-only dependency for this script. PLAYWRIGHT_MODULE lets a
// globally-installed copy be used without adding it to package.json.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
mkdirSync(OUT, { recursive: true })

const shell = (title, bodyHtml, opts = {}) => `
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", Roboto, system-ui, sans-serif;
         background:${opts.light ? '#f4f5f7' : '#1b1f27'}; color:${opts.light ? '#1a1a1a' : '#d6dae2'}; }
  .win { width: ${opts.width || 1250}px; padding: 0 0 10px; }
  .bar { background:${opts.light ? '#e3e6ea' : '#232833'}; padding:8px 12px; font-size:12px; font-weight:600;
         border-bottom:1px solid ${opts.light ? '#c9ced6' : '#2e3542'}; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; font-weight:500; color:${opts.light ? '#5b6472' : '#7d8797'}; padding:7px 10px;
       border-bottom:1px solid ${opts.light ? '#c9ced6' : '#2e3542'}; white-space:nowrap; }
  td { padding:7px 10px; border-bottom:1px solid ${opts.light ? '#e8eaee' : '#252b36'}; white-space:nowrap; }
  .buy { color:#2e9e5b; font-weight:600; } .sell { color:#d1495b; font-weight:600; }
  .pos { color:#2e9e5b; } .neg { color:#d1495b; }
  .mono { font-variant-numeric: tabular-nums; }
</style>
<div class="win"><div class="bar">${title}</div>${bodyHtml}</div>`

const fixtures = []
const add = (name, html, truth, note) => fixtures.push({ name, html, truth, note })

// 1. cTrader-style closed position. The straightforward case.
add('ctrader-closed-long', shell('Positions — History',
`<table>
<tr><th>Position ID</th><th>Symbol</th><th>Direction</th><th>Volume</th><th>Entry</th><th>S/L</th><th>T/P</th><th>Close</th><th>Open time</th><th>Close time</th><th>Net P&L</th></tr>
<tr class="mono"><td>184052117</td><td>XAUUSD.pro</td><td class="buy">Buy</td><td>0.50</td><td>2350.15</td><td>2345.00</td><td>2365.00</td><td>2360.40</td><td>2026-08-01 13:30:00</td><td>2026-08-01 15:02:11</td><td class="pos">512.50</td></tr>
</table>`),
{ brokerPositionId: '184052117', pair: 'XAUUSD.pro', direction: 'long', lotSize: 0.5,
  entryPrice: 2350.15, stopLoss: 2345, takeProfit: 2365, exitPrice: 2360.4, pnl: 512.5, isClosed: true },
'Clean read — every field present and unambiguous.')

// 2. A loss in parentheses, no stop set. Two traps at once.
add('ctrader-loss-no-stop', shell('Positions — History',
`<table>
<tr><th>Position ID</th><th>Symbol</th><th>Direction</th><th>Volume</th><th>Entry</th><th>S/L</th><th>T/P</th><th>Close</th><th>Open time</th><th>Close time</th><th>Net P&L</th></tr>
<tr class="mono"><td>184052993</td><td>NAS100.pro</td><td class="sell">Sell</td><td>1.20</td><td>19845.20</td><td>—</td><td>—</td><td>19902.75</td><td>2026-08-03 09:14:00</td><td>2026-08-03 09:51:40</td><td class="neg">(690.60)</td></tr>
</table>`),
{ brokerPositionId: '184052993', pair: 'NAS100.pro', direction: 'short', lotSize: 1.2,
  entryPrice: 19845.2, stopLoss: null, takeProfit: null, exitPrice: 19902.75, pnl: -690.6, isClosed: true },
'A dash means no stop (null, not 0); a parenthesised P&L is negative.')

// 3. European decimal separators. The classic plausible-wrong-number trap.
add('mt5-european-decimals', shell('MetaTrader 5 — Verlauf', `<table>
<tr><th>Ticket</th><th>Symbol</th><th>Typ</th><th>Volumen</th><th>Preis</th><th>S/L</th><th>Kurs</th><th>Zeit</th><th>Gewinn</th></tr>
<tr class="mono"><td>77120458</td><td>EURUSD</td><td class="buy">buy</td><td>2,50</td><td>1,08453</td><td>1,08200</td><td>1,08791</td><td>2026.08.05 07:12:03</td><td class="pos">843,50</td></tr>
</table>`, { light: true }),
{ brokerPositionId: '77120458', pair: 'EURUSD', direction: 'long', lotSize: 2.5,
  entryPrice: 1.08453, stopLoss: 1.082, exitPrice: 1.08791, pnl: 843.5, isClosed: true },
'Comma is the decimal separator. Misreading 2,50 as 250 inflates risk 100x.')

// 4. Volume shown in units, not lots.
add('units-not-lots', shell('Order History', `<table>
<tr><th>Deal ID</th><th>Instrument</th><th>Side</th><th>Volume (units)</th><th>Open price</th><th>Stop loss</th><th>Close price</th><th>Opened</th><th>Closed</th><th>P/L</th></tr>
<tr class="mono"><td>99001234</td><td>GBPJPY</td><td class="buy">BUY</td><td>100,000</td><td>193.412</td><td>192.900</td><td>194.055</td><td>2026-08-07 11:02:00</td><td>2026-08-07 14:40:00</td><td class="pos">418.90</td></tr>
</table>`),
{ brokerPositionId: '99001234', pair: 'GBPJPY', direction: 'long', lotSize: 1.0,
  entryPrice: 193.412, stopLoss: 192.9, exitPrice: 194.055, pnl: 418.9, isClosed: true },
'100,000 units = 1.0 lots. Reporting 100000 as lotSize is the damaging failure; null is acceptable.')

// 5. An open position — no exit, no P&L yet.
add('open-position', shell('Positions — Open', `<table>
<tr><th>Position ID</th><th>Symbol</th><th>Direction</th><th>Volume</th><th>Entry</th><th>S/L</th><th>T/P</th><th>Open time</th><th>Unrealised</th></tr>
<tr class="mono"><td>184060777</td><td>XAUUSD.pro</td><td class="buy">Buy</td><td>0.25</td><td>2402.80</td><td>2396.50</td><td>2418.00</td><td>2026-08-11 08:05:00</td><td class="pos">62.10</td></tr>
</table>`),
{ brokerPositionId: '184060777', pair: 'XAUUSD.pro', direction: 'long', lotSize: 0.25,
  entryPrice: 2402.8, stopLoss: 2396.5, takeProfit: 2418, exitPrice: null, isClosed: false },
'Still open: no exit price, and unrealised P&L is not realised P&L.')

// 6. Cropped so the P&L and close columns are cut off.
add('cropped-columns', shell('Positions — History', `<table>
<tr><th>Position ID</th><th>Symbol</th><th>Direction</th><th>Volume</th><th>Entry</th><th>S/L</th></tr>
<tr class="mono"><td>184051002</td><td>US30.pro</td><td class="sell">Sell</td><td>0.80</td><td>41250.5</td><td>41400.0</td></tr>
</table>`, { width: 520 }),
{ brokerPositionId: '184051002', pair: 'US30.pro', direction: 'short', lotSize: 0.8,
  entryPrice: 41250.5, stopLoss: 41400, exitPrice: null, pnl: null, isClosed: false },
'Columns absent from the image must be null, not inferred.')

// 7. Not a trading screenshot at all.
add('not-a-trade', shell('Inbox', `<table>
<tr><th>From</th><th>Subject</th><th>Date</th></tr>
<tr><td>billing@example.com</td><td>Your invoice for August</td><td>2026-08-02</td></tr>
<tr><td>no-reply@example.com</td><td>Security alert</td><td>2026-08-04</td></tr>
</table>`, { light: true }),
{ brokerPositionId: null, pair: null, direction: null, lotSize: null,
  entryPrice: null, stopLoss: null, exitPrice: null, pnl: null, isClosed: false },
'Everything null. Inventing a trade here is the worst possible failure.')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
})
const page = await browser.newPage({ deviceScaleFactor: 2 })
const manifest = []
for (const f of fixtures) {
  await page.setContent(f.html)
  const el = await page.locator('.win')
  await el.screenshot({ path: join(OUT, `${f.name}.png`) })
  manifest.push({ name: f.name, image: `${f.name}.png`, note: f.note, truth: f.truth })
  console.log(`  ${f.name}.png`)
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
await browser.close()
console.log(`\n${fixtures.length} fixtures + manifest.json written to eval/fixtures/`)
