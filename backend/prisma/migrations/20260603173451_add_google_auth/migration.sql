-- AlterTable: password becomes optional, add Google's user id
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL,
ADD COLUMN "googleId" TEXT;

-- CreateIndex: googleId must be unique (one Google account → one user)
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
