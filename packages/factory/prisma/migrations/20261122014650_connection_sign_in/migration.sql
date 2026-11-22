/*
  Warnings:

  - You are about to drop the column `credentialRef` on the `Connection` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Connection" DROP COLUMN "credentialRef";

-- CreateTable
CREATE TABLE "ConnectionCredential" (
    "connectionId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "connector" TEXT,
    "encrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "signedInAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionCredential_pkey" PRIMARY KEY ("connectionId")
);

-- CreateTable
CREATE TABLE "RegisteredClient" (
    "issuer" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "encryptedSecret" TEXT,
    "authMethod" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisteredClient_pkey" PRIMARY KEY ("issuer","redirectUri")
);

-- AddForeignKey
ALTER TABLE "ConnectionCredential" ADD CONSTRAINT "ConnectionCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
