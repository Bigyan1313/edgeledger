-- Trading sessions: a plan written before the first trade of the day, locked
-- once written, that gates which trades the journal will take without a fight.
--
-- Additive only. No existing row changes meaning: every current trade gets an
-- empty ruleViolations array and no session, which is the truth — no rule
-- existed when they were logged. The gate itself only applies from a user's
-- first session onward (src/domain/session.js), so history is not retroactively
-- marked as rule-breaking.

-- The trader's own sleep floor. Nullable like the rest of the profile.
ALTER TABLE "Profile" ADD COLUMN "minSleepHours" DOUBLE PRECISION;

-- Violations are written once, at Stage A, and never recomputed.
ALTER TABLE "Trade" ADD COLUMN "ruleViolations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "sessionId" INTEGER;

CREATE TABLE "TradingSession" (
    "id"                   SERIAL           NOT NULL,
    "userId"               INTEGER          NOT NULL,
    "accountId"            INTEGER,
    "sessionDate"          TEXT             NOT NULL,
    "timezone"             TEXT             NOT NULL,
    "sleepHours"           DOUBLE PRECISION NOT NULL,
    "fitToTrade"           BOOLEAN          NOT NULL,
    "minSleepHoursApplied" DOUBLE PRECISION NOT NULL,
    "bias"                 TEXT,
    "wantToSee"            TEXT,
    "scenarios"            JSONB,
    "noTradeIf"            TEXT,
    "maxTrades"            INTEGER,
    "tradesLogged"         INTEGER          NOT NULL DEFAULT 0,
    "status"               TEXT             NOT NULL,
    "blockedReasons"       TEXT[]           DEFAULT ARRAY[]::TEXT[],
    "openedAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"             TIMESTAMP(3),
    "followedPlan"         BOOLEAN,
    "review"               TEXT,
    "createdAt"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradingSession_userId_sessionDate_idx" ON "TradingSession"("userId", "sessionDate");

-- One plan per account per day. NULL accountIds are distinct to Postgres, so
-- the no-account case is enforced in the route.
CREATE UNIQUE INDEX "TradingSession_userId_accountId_sessionDate_key" ON "TradingSession"("userId", "accountId", "sessionDate");

-- The ceiling is the rule that matters most, so it is not left to the API
-- alone: no path into the table can store a plan allowing more than 2 trades.
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_maxTrades_check" CHECK ("maxTrades" BETWEEN 1 AND 2);
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_status_check" CHECK ("status" IN ('open', 'blocked', 'closed'));
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_tradesLogged_check" CHECK ("tradesLogged" >= 0);

-- A blocked day needs no plan. Every day that opened must have had one.
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_plan_check" CHECK (
  "status" = 'blocked'
  OR ("wantToSee" IS NOT NULL AND "noTradeIf" IS NOT NULL AND "scenarios" IS NOT NULL AND "maxTrades" IS NOT NULL)
);

ALTER TABLE "Trade" ADD CONSTRAINT "Trade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
