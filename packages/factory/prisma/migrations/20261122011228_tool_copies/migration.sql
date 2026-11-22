-- CreateTable
CREATE TABLE "ToolCopy" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolCopy_factoryId_name_key" ON "ToolCopy"("factoryId", "name");

-- AddForeignKey
ALTER TABLE "ToolCopy" ADD CONSTRAINT "ToolCopy_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
