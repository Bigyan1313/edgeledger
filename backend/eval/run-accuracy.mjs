#!/usr/bin/env node
// Measures how accurately the screenshot importer transcribes a trade.
//
// The scoring distinction that matters:
//
//   CORRECT  the value matches the ground truth
//   MISSING  the truth had a value, extraction returned null
//   WRONG    extraction returned a value that differs from the truth
//
// These are not equally bad, and averaging them into one "accuracy %" would
// hide the only number worth watching. A MISSING field costs the user five
// seconds of typing. A WRONG field enters the journal looking exactly like a
// right one and silently corrupts every figure derived from it.
//
// So: WRONG must be zero. MISSING is a cost, not a defect.
//
//   ANTHROPIC_API_KEY=sk-... node eval/run-accuracy.mjs
//   ANTHROPIC_API_KEY=sk-... node eval/run-accuracy.mjs --runs 3   # check stability
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { callExtractionModel, normalizeExtraction, EXTRACTION_MODEL } from '../src/domain/extraction.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures')
const runs = Math.max(1, Number((process.argv.find(a => a.startsWith('--runs=')) || '').split('=')[1]) ||
                        Number(process.argv[process.argv.indexOf('--runs') + 1]) || 1)

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set. This eval makes real API calls.')
  console.error('Fixtures and scoring are ready — set the key and re-run.')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8'))
const client = new Anthropic({ apiKey })

// Prices carry more decimals than a float compares cleanly at, so numbers match
// on their printed value rather than by identity.
const same = (a, b) => {
  if (a === null || a === undefined) return b === null || b === undefined
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  return String(a) === String(b)
}

const SCORED = ['brokerPositionId', 'pair', 'direction', 'lotSize', 'entryPrice',
                'stopLoss', 'takeProfit', 'exitPrice', 'pnl', 'isClosed']

let correct = 0, missing = 0, wrong = 0
const wrongDetail = []
let inputTokens = 0, outputTokens = 0

for (let run = 1; run <= runs; run++) {
  if (runs > 1) console.log(`\n──── run ${run} of ${runs} ────`)
  for (const fx of manifest) {
    const b64 = readFileSync(join(FIX, fx.image)).toString('base64')
    let raw, usage
    try {
      ({ input: raw, usage } = await callExtractionModel(client, { mediaType: 'image/png', data: b64 }))
    } catch (err) {
      console.error(`  ${fx.name}: API error — ${err.message}`)
      continue
    }
    inputTokens += usage?.input_tokens ?? 0
    outputTokens += usage?.output_tokens ?? 0

    const { fields } = normalizeExtraction(raw ?? {})
    const line = []
    for (const key of SCORED) {
      if (!(key in fx.truth)) continue
      const want = fx.truth[key], got = fields[key]
      if (same(want, got)) { correct++; continue }
      if ((got === null || got === undefined) && want !== null) {
        missing++; line.push(`${key}: missing (wanted ${want})`)
      } else {
        wrong++
        line.push(`${key}: WRONG got ${JSON.stringify(got)} wanted ${JSON.stringify(want)}`)
        wrongDetail.push({ fixture: fx.name, field: key, got, want })
      }
    }
    const mark = line.some(l => l.includes('WRONG')) ? '✗' : line.length ? '~' : '✓'
    console.log(`  ${mark} ${fx.name}`)
    for (const l of line) console.log(`      ${l}`)
  }
}

const scored = correct + missing + wrong
console.log(`\n${'='.repeat(60)}`)
console.log(`model      ${EXTRACTION_MODEL}   fixtures ${manifest.length} x ${runs} run(s)`)
console.log(`correct    ${correct}/${scored}  (${(correct / scored * 100).toFixed(1)}%)`)
console.log(`missing    ${missing}   — costs the user typing, not correctness`)
console.log(`WRONG      ${wrong}   — must be 0`)
// Haiku 4.5: $1/MTok in, $5/MTok out.
const cost = inputTokens / 1e6 * 1 + outputTokens / 1e6 * 5
console.log(`tokens     ${inputTokens} in / ${outputTokens} out  ≈ $${cost.toFixed(4)} total, $${(cost / (manifest.length * runs)).toFixed(4)}/screenshot`)

if (wrong > 0) {
  console.log(`\nWrong values — each of these would have entered the journal:`)
  for (const w of wrongDetail) {
    console.log(`  ${w.fixture} · ${w.field}: got ${JSON.stringify(w.got)}, truth ${JSON.stringify(w.want)}`)
  }
}
process.exit(wrong > 0 ? 1 : 0)
