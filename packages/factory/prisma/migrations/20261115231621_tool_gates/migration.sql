-- CreateTable
CREATE TABLE "ToolGate" (
    "factoryId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "run" TEXT NOT NULL DEFAULT 'never',
    "result" TEXT NOT NULL DEFAULT 'never',

    CONSTRAINT "ToolGate_pkey" PRIMARY KEY ("factoryId","toolKey")
);

-- AddForeignKey
ALTER TABLE "ToolGate" ADD CONSTRAINT "ToolGate_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
