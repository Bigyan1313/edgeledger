-- Which market session a plan is for, pre-market charts on the plan, and
-- backtest reviews. Additive: existing plans get no session label (they were
-- written before it existed) and no charts; existing reviews are not
-- backtests.

ALTER TABLE "TradingSession" ADD COLUMN "marketSession" TEXT,
ADD COLUMN "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_marketSession_check"
  CHECK ("marketSession" IS NULL OR "marketSession" IN ('asia', 'london', 'new_york'));

ALTER TABLE "PriceActionReview" ADD COLUMN "isBacktest" BOOLEAN NOT NULL DEFAULT false;
