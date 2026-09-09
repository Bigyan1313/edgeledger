-- Trader profile: identity plus the Stage A defaults that cut manual entry.
--
-- Every column is nullable. A profile is filled in over time, and an unset
-- default has to stay distinguishable from a chosen one — the same rule the
-- trade model follows.

CREATE TABLE "Profile" (
    "id"                     SERIAL       NOT NULL,
    "userId"                 INTEGER      NOT NULL,
    "displayName"            TEXT,
    "timezone"               TEXT,
    "baseCurrency"           TEXT,
    "defaultBrokerPlatform"  TEXT,
    "defaultBrokerAccountId" TEXT,
    "defaultRiskPercent"     DOUBLE PRECISION,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- One profile per user.
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

ALTER TABLE "Profile"
  ADD CONSTRAINT "Profile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
