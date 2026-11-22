-- Every library tool becomes a row made from a catalog template, like skills and connections.
-- Copies keep their ids, so their gates still match. A prebuilt tool a factory used, configured,
-- or gated gets a row named after itself, and its settings, gate, and attachments move to it.

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTool" (
    "agentId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,

    CONSTRAINT "AgentTool_pkey" PRIMARY KEY ("agentId","toolId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tool_factoryId_name_key" ON "Tool"("factoryId", "name");

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTool" ADD CONSTRAINT "AgentTool_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTool" ADD CONSTRAINT "AgentTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copies, with their settings.
INSERT INTO "Tool" ("id", "factoryId", "template", "name", "description", "model", "createdAt")
SELECT copy."id", copy."factoryId", copy."base", copy."name", COALESCE(setting."description", ''), COALESCE(setting."model", ''), copy."createdAt"
FROM "ToolCopy" copy
LEFT JOIN "ToolSetting" setting ON setting."factoryId" = copy."factoryId" AND setting."toolKey" = copy."id";

-- Prebuilt tools each factory used. Copy names could never be a prebuilt id, so the names are free.
WITH prebuilt(template) AS (
    VALUES ('web_fetch'), ('web_search'), ('decide'), ('generate_image'), ('generate_video')
),
used AS (
    SELECT agent."factoryId", ref.key AS template FROM "Agent" agent CROSS JOIN LATERAL unnest(agent."tools") AS ref(key)
    UNION
    SELECT "factoryId", "toolKey" FROM "ToolSetting"
    UNION
    SELECT "factoryId", "toolKey" FROM "ToolGate"
)
INSERT INTO "Tool" ("id", "factoryId", "template", "name", "description", "model")
SELECT gen_random_uuid()::text, used."factoryId", used.template, used.template, COALESCE(setting."description", ''), COALESCE(setting."model", '')
FROM used
JOIN prebuilt ON prebuilt.template = used.template
LEFT JOIN "ToolSetting" setting ON setting."factoryId" = used."factoryId" AND setting."toolKey" = used.template;

-- Attachments: an agent listed a copy by id and a prebuilt tool by its id, which is now the row's name.
INSERT INTO "AgentTool" ("agentId", "toolId")
SELECT agent."id", tool."id"
FROM "Agent" agent
CROSS JOIN LATERAL unnest(agent."tools") AS ref(key)
JOIN "Tool" tool ON tool."factoryId" = agent."factoryId" AND (tool."id" = ref.key OR (tool."name" = ref.key AND tool."template" = ref.key))
ON CONFLICT DO NOTHING;

-- A prebuilt tool's gate was keyed by its id. It moves to the new row's id.
UPDATE "ToolGate" gate
SET "toolKey" = tool."id"
FROM "Tool" tool
WHERE tool."factoryId" = gate."factoryId" AND tool."name" = gate."toolKey" AND tool."template" = gate."toolKey";

-- DropForeignKey
ALTER TABLE "ToolSetting" DROP CONSTRAINT "ToolSetting_factoryId_fkey";

-- DropForeignKey
ALTER TABLE "ToolCopy" DROP CONSTRAINT "ToolCopy_factoryId_fkey";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "tools";

-- DropTable
DROP TABLE "ToolSetting";

-- DropTable
DROP TABLE "ToolCopy";
