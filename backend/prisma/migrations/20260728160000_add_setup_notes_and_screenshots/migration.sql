-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "setupNotes" TEXT;
ALTER TABLE "Trade" ADD COLUMN     "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];
