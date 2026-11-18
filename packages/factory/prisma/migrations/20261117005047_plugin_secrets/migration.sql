-- CreateTable
CREATE TABLE "PluginSecret" (
    "factoryId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginSecret_pkey" PRIMARY KEY ("factoryId","pluginId","name")
);

-- AddForeignKey
ALTER TABLE "PluginSecret" ADD CONSTRAINT "PluginSecret_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
