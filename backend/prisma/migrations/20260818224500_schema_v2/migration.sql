-- Schema v2.
--
-- The governing constraint: the 44 v1 rows are real trades and must survive
-- this migration with every value they already carry. They cannot meet the v2
-- requirements — they have no broker position IDs and never will — so they are
-- marked (schemaVersion = 1, dataQualityFlags) rather than repaired or removed.
-- Nothing below auto-corrects a value. See prisma/schema.prisma for why each
-- column exists.

-- ---------------------------------------------------------------------------
-- 1. Renames, not recreates — a renamed column keeps its rows.
-- ---------------------------------------------------------------------------

-- Task 6: `date` carried a Z suffix that could not be trusted to mean true UTC.
-- The new name states the contract the column is now held to.
ALTER TABLE "Trade" RENAME COLUMN "date" TO "entryTimeUtc";

-- Task 3: the v1 `setup` enum mixed chart structure with trader state. The
-- string itself is preserved verbatim; step 5 projects it onto the two new
-- axes.
ALTER TABLE "Trade" RENAME COLUMN "setup" TO "legacySetup";

-- ---------------------------------------------------------------------------
-- 2. New columns.
-- ---------------------------------------------------------------------------
ALTER TABLE "Trade"
  ADD COLUMN "schemaVersion"    INTEGER      NOT NULL DEFAULT 2,
  ADD COLUMN "brokerPositionId" TEXT,
  ADD COLUMN "brokerAccountId"  TEXT,
  ADD COLUMN "brokerPlatform"   TEXT,
  ADD COLUMN "exitTimeUtc"      TIMESTAMP(3),
  ADD COLUMN "captureTimezone"  TEXT,
  ADD COLUMN "technicalSetup"   TEXT,
  ADD COLUMN "emotionalState"   TEXT,
  ADD COLUMN "exitNotes"        TEXT,
  ADD COLUMN "journaledAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastEditedAt"     TIMESTAMP(3),
  ADD COLUMN "entryStage"       TEXT         NOT NULL DEFAULT 'pending_exit',
  ADD COLUMN "amendedAt"        TIMESTAMP(3),
  ADD COLUMN "dataQualityFlags" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- 3. Task 4 — remove the defaults that masquerade as data.
--
-- `fullPort` was false on all 44 rows and `followedChecklist` false on 39 of
-- 44: nobody set them, the default did. Both controls exist in the entry UI, so
-- the fields stay — what goes is the default and the NOT NULL that made a
-- default necessary. From here the value is either an answer or absent, and the
-- two are distinguishable.
-- ---------------------------------------------------------------------------
ALTER TABLE "Trade" ALTER COLUMN "followedChecklist" DROP DEFAULT;
ALTER TABLE "Trade" ALTER COLUMN "followedChecklist" DROP NOT NULL;
ALTER TABLE "Trade" ALTER COLUMN "fullPort"          DROP DEFAULT;
ALTER TABLE "Trade" ALTER COLUMN "fullPort"          DROP NOT NULL;

-- A Stage A trade is entered but not yet exited, so it has no P&L yet.
ALTER TABLE "Trade" ALTER COLUMN "pnl" DROP NOT NULL;

-- `legacySetup` inherits NOT NULL from the v1 `setup` column, but v2 rows never
-- write it.
ALTER TABLE "Trade" ALTER COLUMN "legacySetup" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Drops.
--
-- `emotionBefore` was "Calm" on all 44 rows — zero variance, zero information —
-- and is superseded by `emotionalState`. `outcome` becomes computed from `pnl`:
-- a stored copy can drift out of sync with the number it summarises, and every
-- v1 value is recoverable from `pnl` anyway.
-- ---------------------------------------------------------------------------
ALTER TABLE "Trade" DROP COLUMN "emotionBefore";
ALTER TABLE "Trade" DROP COLUMN "outcome";

-- ---------------------------------------------------------------------------
-- 5. Backfill the existing rows.
--
-- Every row present at this point predates v2 by definition.
-- ---------------------------------------------------------------------------

UPDATE "Trade"
SET "schemaVersion" = 1,
    -- The honest journaling timestamp for a v1 row is when it was created.
    -- Combined with entryTimeUtc this makes each row's journaling lag
    -- measurable retroactively.
    "journaledAt"   = "createdAt",
    -- v1 rows are all closed trades; they were only ever written after exit.
    "entryStage"    = 'complete';

-- Project the preserved v1 setup string onto whichever axis it described.
-- Values that named chart structure become technicalSetup; values that named
-- trader state become emotionalState; the other axis stays NULL because it was
-- never recorded. `Other` and `News / Full-port` map to neither — inventing a
-- value for them is exactly the failure mode this schema exists to end.
UPDATE "Trade"
SET "technicalSetup" = "legacySetup"
WHERE "schemaVersion" = 1
  AND "legacySetup" IN (
    'Trend continuation',
    'Sweep → displacement → retest',
    'A+ Session sweep + rejection retest',
    'Anticipation (no confirmation)',
    'Break & retest'
  );

UPDATE "Trade"
SET "emotionalState" = "legacySetup"
WHERE "schemaVersion" = 1
  AND "legacySetup" IN ('FOMO / Impulsive', 'Revenge');

-- ---------------------------------------------------------------------------
-- 6. Task 8 — data quality flags.
--
-- This mirrors src/domain/dataQuality.js, which is the authoritative
-- implementation; a migration is a frozen historical artifact, so when that
-- module changes, re-converge the rows with
-- `node scripts/backfill-data-quality-flags.js` rather than editing this file.
-- Note Postgres word boundaries are \y, not \b.
-- ---------------------------------------------------------------------------
UPDATE "Trade"
SET "dataQualityFlags" = (
  SELECT ARRAY_REMOVE(ARRAY[
    -- No broker position ID: the row cannot be joined to execution data at all.
    -- True for all 44.
    CASE WHEN "brokerPositionId" IS NULL THEN 'legacy_unlinked' END,
    -- 40 of 44. Without a stop, the R-multiple is uncomputable.
    CASE WHEN "stopLoss" IS NULL THEN 'missing_stop_loss' END,
    -- Either end of the price pair missing breaks the R-multiple.
    CASE WHEN "entryPrice" IS NULL OR "exitPrice" IS NULL THEN 'missing_prices' END,
    -- The three negative lot sizes, including -16.83. Flagged, not corrected.
    CASE WHEN "lotSize" IS NOT NULL AND "lotSize" <= 0 THEN 'invalid_lot_size' END,
    -- One row merges three separate trades, which makes its P&L a sum.
    CASE WHEN COALESCE("notes", '') ~* '(\y(merg\w+|combin\w+|lump\w+)\y[^.]{0,40}\ytrades?\y|\y(\d+|two|three|four|several|multiple)\s+(separate\s+)?trades\y|\ytrades?\s+(merged|combined)\y)'
         THEN 'multi_trade_entry' END,
    -- Written after the outcome was known: either the note says so, or the gap
    -- between entry and first save says so.
    CASE WHEN COALESCE("notes", '') ~* '(journal(ed|led|ing)?\s+(this\s+)?late|late\s+journal|logged\s+(this\s+)?(after|late)|retroactiv)'
              OR ("createdAt" - "entryTimeUtc") > INTERVAL '60 minutes'
         THEN 'retroactive_journal' END
  ], NULL)
)
WHERE "schemaVersion" = 1;

-- ---------------------------------------------------------------------------
-- 7. Constraints and indexes.
-- ---------------------------------------------------------------------------

-- Task 1: a position ID identifies one position exactly once. Scoped to the
-- user because broker position IDs are unique only within a broker account.
-- Postgres treats NULLs as distinct, so the unlinked v1 rows do not collide.
CREATE UNIQUE INDEX "Trade_userId_brokerPositionId_key"
  ON "Trade"("userId", "brokerPositionId");

-- Task 8: list and export views filter on schemaVersion by default.
CREATE INDEX "Trade_userId_schemaVersion_idx" ON "Trade"("userId", "schemaVersion");

-- ---------------------------------------------------------------------------
-- 8. Task 7 — the amendment audit trail.
--
-- One row per field changed per amendment. This is what turns "the recorded
-- intent was contemporaneous" from a claim into something the analysis pipeline
-- can verify and filter on.
-- ---------------------------------------------------------------------------
CREATE TABLE "TradeAmendment" (
    "id"        SERIAL       NOT NULL,
    "tradeId"   INTEGER      NOT NULL,
    "field"     TEXT         NOT NULL,
    "oldValue"  TEXT,
    "newValue"  TEXT,
    "reason"    TEXT,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeAmendment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeAmendment_tradeId_idx" ON "TradeAmendment"("tradeId");

ALTER TABLE "TradeAmendment"
  ADD CONSTRAINT "TradeAmendment_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
