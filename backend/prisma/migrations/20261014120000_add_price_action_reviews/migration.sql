-- Price action reviews: what the market did, written once the morning has
-- played out. Additive only — no existing row changes.

-- When the trader's market opens. Nullable like the rest of the profile; the
-- app falls back to the New York cash open and each review records the open
-- it was actually written against.
ALTER TABLE "Profile" ADD COLUMN "marketOpenTime" TEXT,
ADD COLUMN "marketTimezone" TEXT;

CREATE TABLE "PriceActionReview" (
    "id"             SERIAL       NOT NULL,
    "userId"         INTEGER      NOT NULL,
    "reviewDate"     TEXT         NOT NULL,
    "symbol"         TEXT         NOT NULL,
    "marketTimezone" TEXT         NOT NULL,
    "marketOpenTime" TEXT         NOT NULL,
    "dayType"        TEXT         NOT NULL,
    "summary"        TEXT         NOT NULL,
    "openBehavior"   TEXT,
    "keyLevels"      TEXT,
    "liquidityTaken" TEXT,
    "planPlayedOut"  TEXT,
    "validSetup"     BOOLEAN      NOT NULL,
    "lesson"         TEXT,
    "screenshots"    TEXT[]       DEFAULT ARRAY[]::TEXT[],
    "writtenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedAt"   TIMESTAMP(3),

    CONSTRAINT "PriceActionReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceActionReview_userId_reviewDate_idx" ON "PriceActionReview"("userId", "reviewDate");

-- One review per symbol per trading day.
CREATE UNIQUE INDEX "PriceActionReview_userId_reviewDate_symbol_key" ON "PriceActionReview"("userId", "reviewDate", "symbol");

-- The enumerations, held by the database as well as the API.
ALTER TABLE "PriceActionReview" ADD CONSTRAINT "PriceActionReview_dayType_check"
  CHECK ("dayType" IN ('trend_up', 'trend_down', 'range', 'reversal', 'chop'));
ALTER TABLE "PriceActionReview" ADD CONSTRAINT "PriceActionReview_liquidityTaken_check"
  CHECK ("liquidityTaken" IS NULL OR "liquidityTaken" IN ('buy_side', 'sell_side', 'both', 'neither'));
ALTER TABLE "PriceActionReview" ADD CONSTRAINT "PriceActionReview_planPlayedOut_check"
  CHECK ("planPlayedOut" IS NULL OR "planPlayedOut" IN ('yes', 'partly', 'no'));

ALTER TABLE "PriceActionReview" ADD CONSTRAINT "PriceActionReview_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
