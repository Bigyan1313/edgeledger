# Screenshot import accuracy

Two different things get measured here, and conflating them hides the one that matters.

**`npm test`** covers everything deterministic: the image checks, the guards that
drop impossible values, duplicate detection, and the promise that extraction
never writes to the journal. The model is stubbed. No API key, no cost.

**`npm run eval:accuracy`** measures how well the model actually *reads a
screenshot*. It makes real API calls and needs `ANTHROPIC_API_KEY`.

```bash
npm run eval:fixtures      # regenerate the images (needs playwright)
ANTHROPIC_API_KEY=sk-... npm run eval:accuracy
ANTHROPIC_API_KEY=sk-... node eval/run-accuracy.mjs --runs 3    # check run-to-run stability
```

## How it scores

Per field, against known ground truth:

| Result | Meaning | Cost |
|---|---|---|
| **correct** | matches the truth | — |
| **missing** | truth had a value, extraction returned `null` | five seconds of typing |
| **WRONG** | extraction returned a value that differs from the truth | a permanently corrupted record |

These are not averaged into a single accuracy percentage, because doing that
would let a rising `correct` count hide a non-zero `WRONG` count. **`WRONG` must
be zero.** The harness exits non-zero if it isn't. `missing` is a cost, not a
defect — the whole design prefers a blank the user fills in over a plausible
number they don't notice.

## The fixtures

Synthetic, because real screenshots of a real account can't be committed, and
these can encode the specific traps that produce a *plausible* wrong number
rather than an obviously wrong one:

| Fixture | What it tests |
|---|---|
| `ctrader-closed-long` | the straightforward case — every field present |
| `ctrader-loss-no-stop` | a dash means no stop (`null`, not `0`); `(690.60)` is negative |
| `mt5-european-decimals` | `1,08453` and `2,50` — reading `2,50` as `250` inflates risk 100× |
| `units-not-lots` | a Volume column of `100,000` is 1.0 lots, not a lot size of 100000 |
| `open-position` | no exit price; unrealised P&L is not realised P&L |
| `cropped-columns` | columns absent from the image must be `null`, not inferred |
| `not-a-trade` | an inbox screenshot — inventing a trade here is the worst failure |

`fixtures/manifest.json` holds the ground truth for each.

## Adding your own

The fixtures are guesses at what your platform looks like. Real screenshots from
your own broker are better evidence. Drop a PNG in `fixtures/`, add an entry to
`manifest.json` with what the correct reading would be, and re-run — no code
change needed.

If accuracy is poor on a real screenshot, the prompt in
`src/domain/extraction.js` is the thing to change; the fixture that fails is the
regression test that proves it improved.
