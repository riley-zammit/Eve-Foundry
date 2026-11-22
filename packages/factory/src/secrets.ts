import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getDb } from "./db";

// Secrets at rest: plugin env values (below), connection tokens and Foundry's registered OAuth
// clients (src/auth), and sign-ins in progress (a cookie, also src/auth).
//
// - Encrypted with AES-256-GCM under FOUNDRY_SECRETS_KEY, which lives in the server's env, never
//   in the database. Each value is bound to where it's stored (the associated data), so a value
//   copied into another row or factory fails to decrypt.
//
// Plugin secrets are env var values a factory sets for a plugin's CLIs. They're factory-level, so
// scheduled turns can use them with no one there to sign in.
// - Write-only from the builder: it learns which names are set, never the values.
// - Decrypted only by the runtime, inside a tool call, for that one command. Never memoized,
//   never put in prompts.

const ALGORITHM = "aes-256-gcm";
// Bumped if the key or format changes, so old rows can be told apart and re-encrypted.
const FORMAT_VERSION = "v1";

function secretsKey() {
    const encoded = process.env.FOUNDRY_SECRETS_KEY ?? "";
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) {
        throw new Error("FOUNDRY_SECRETS_KEY must be 32 random bytes in base64. Generate one with `openssl rand -base64 32`.");
    }
    return key;
}

function pluginContext(factoryId: string, pluginId: string, name: string) {
    return `${factoryId}:${pluginId}:${name}`;
}

// Stored as `v1.<iv>.<tag>.<ciphertext>`, each part base64. `context` says where the value is
// stored; decrypting needs the same one.
export function encryptSecret(value: string, context: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, secretsKey(), iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const parts = [FORMAT_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")];
    return parts.join(".");
}

export function decryptSecret(stored: string, context: string) {
    const [version, iv, tag, ciphertext] = stored.split(".");
    if (version !== FORMAT_VERSION) {
        throw new Error(`Unknown secret format: ${version}`);
    }
    const decipher = createDecipheriv(ALGORITHM, secretsKey(), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
}

export async function storePluginSecret(factoryId: string, pluginId: string, name: string, value: string) {
    const encrypted = encryptSecret(value, pluginContext(factoryId, pluginId, name));
    await getDb().pluginSecret.upsert({
        where: { factoryId_pluginId_name: { factoryId, pluginId, name } },
        create: {
            factoryId,
            pluginId,
            name,
            encrypted,
        },
        update: { encrypted },
    });
}

export async function deletePluginSecret(factoryId: string, pluginId: string, name: string) {
    await getDb().pluginSecret.deleteMany({
        where: {
            factoryId,
            pluginId,
            name,
        },
    });
}

// The env for one plugin's command: each requested name that's set, decrypted.
export async function loadPluginEnv(factoryId: string, pluginId: string, names: string[]) {
    const rows = await getDb().pluginSecret.findMany({
        where: {
            factoryId,
            pluginId,
            name: { in: names },
        },
        select: {
            name: true,
            encrypted: true,
        },
    });
    const entries = rows.map(({ name, encrypted }) => [name, decryptSecret(encrypted, pluginContext(factoryId, pluginId, name))] as const);
    return Object.fromEntries(entries);
}
