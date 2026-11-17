import { PLUGINS } from "@foundry/factory";
import { DefaultSandbox, defineSandbox, type SandboxSession } from "eve/sandbox";

// Every plugin's CLIs are baked into the sandbox template, so a factory can turn any plugin on
// without an install at chat time. eve picks Vercel on Vercel, Docker when it's running, and
// just-bash in dev without Docker. just-bash runs no native programs, so it skips the install.

const pluginClis = Object.values(PLUGINS).flatMap((plugin) => plugin.clis);
const aptPackages = pluginClis.flatMap((cli) => cli.aptPackages);

async function installPluginClis(sandbox: SandboxSession) {
    const hasApt = await sandbox.run({ command: "command -v apt-get" });
    if (hasApt.exitCode !== 0) {
        return;
    }
    const packages = aptPackages.join(" ");
    const result = await sandbox.run({
        command: `sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packages}`,
    });
    if (result.exitCode !== 0) {
        throw new Error(`Installing plugin CLIs failed: ${result.stderr || result.stdout}`);
    }
}

export const environment = DefaultSandbox.environment({ prepare: installPluginClis });

export default defineSandbox(() => environment.open());
