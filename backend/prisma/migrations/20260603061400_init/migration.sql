-- CreateTable
CREATE TABLE "Trade" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "setup" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "lotSize" DOUBLE PRECISION,
    "riskDollars" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "emotionBefore" TEXT,
    "followedChecklist" BOOLEAN NOT NULL DEFAULT false,
    "fullPort" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);
