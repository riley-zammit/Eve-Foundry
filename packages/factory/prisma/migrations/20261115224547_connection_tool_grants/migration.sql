-- AlterTable
ALTER TABLE "AgentConnection" ADD COLUMN     "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "restrictTools" BOOLEAN NOT NULL DEFAULT false;
