import { defineConfig, env } from "prisma/config";

// DATABASE_URL lives in the repo root's .env.local, shared with the agent and web app.
process.loadEnvFile("../../.env.local");

export default defineConfig({
    schema: "prisma/schema.prisma",
    datasource: {
        url: env("DATABASE_URL"),
    },
});
