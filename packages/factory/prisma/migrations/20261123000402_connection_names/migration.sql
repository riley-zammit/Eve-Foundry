-- eve connection names allow lowercase letters, digits, and `-`, but not `_`, and an agent with a
-- bad name fails its turn. Connection names become their dashed form. Gates and allow lists use
-- the connection's id and the tools' own names, so nothing else changes. A rename that would take
-- a name the factory already uses is skipped.

UPDATE "Connection" AS renamed
SET "name" = replace(renamed."name", '_', '-')
WHERE renamed."name" LIKE '%\_%'
    AND NOT EXISTS (
        SELECT 1
        FROM "Connection" AS other
        WHERE other."factoryId" = renamed."factoryId"
            AND other."name" = replace(renamed."name", '_', '-')
    );
