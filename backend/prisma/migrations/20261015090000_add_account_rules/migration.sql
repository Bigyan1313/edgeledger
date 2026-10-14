-- Prop-firm loss rules on an account, so the journal can say how far the
-- trader is from losing it. Additive and nullable: no existing account gains
-- a rule it was never given.

ALTER TABLE "Account" ADD COLUMN "dailyLossLimit" DOUBLE PRECISION,
ADD COLUMN "maxDrawdown" DOUBLE PRECISION,
ADD COLUMN "drawdownType" TEXT,
ADD COLUMN "drawdownLockBalance" DOUBLE PRECISION;

ALTER TABLE "Account" ADD CONSTRAINT "Account_dailyLossLimit_check" CHECK ("dailyLossLimit" IS NULL OR "dailyLossLimit" > 0);
ALTER TABLE "Account" ADD CONSTRAINT "Account_maxDrawdown_check" CHECK ("maxDrawdown" IS NULL OR "maxDrawdown" > 0);
ALTER TABLE "Account" ADD CONSTRAINT "Account_drawdownType_check"
  CHECK ("drawdownType" IS NULL OR "drawdownType" IN ('static', 'eod_trailing', 'intraday_trailing'));
-- A drawdown is a size and a way of moving; one without the other means nothing.
ALTER TABLE "Account" ADD CONSTRAINT "Account_drawdown_pair_check"
  CHECK (("maxDrawdown" IS NULL) = ("drawdownType" IS NULL));
