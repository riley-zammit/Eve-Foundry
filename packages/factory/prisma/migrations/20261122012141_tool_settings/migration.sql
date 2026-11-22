-- CreateTable
CREATE TABLE "ToolSetting" (
    "factoryId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ToolSetting_pkey" PRIMARY KEY ("factoryId","toolKey")
);

-- AddForeignKey
ALTER TABLE "ToolSetting" ADD CONSTRAINT "ToolSetting_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
