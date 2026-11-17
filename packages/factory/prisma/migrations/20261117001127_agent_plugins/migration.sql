-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "plugins" TEXT[] DEFAULT ARRAY[]::TEXT[];
