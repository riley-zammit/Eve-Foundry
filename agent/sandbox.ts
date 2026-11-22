import { installAgentBrowser } from "@eve/agent-browser/sandbox";
import { PLUGINS } from "@foundry/factory";
import { DefaultSandbox, defineSandbox, type SandboxSession } from "eve/sandbox";

// Everything plugins run is baked into the sandbox template, so a factory can turn any plugin on
// without an install at chat time. eve picks Vercel on Vercel, Docker when it's running, and
// just-bash in dev without Docker. just-bash runs no native programs, so it skips the install.

const pluginClis = Object.values(PLUGINS).flatMap((plugin) => plugin.clis);
const aptPackages = pluginClis.flatMap((cli) => cli.aptPackages);

async function installPlugins(sandbox: SandboxSession) {
    const hasApt = await hasCommand(sandbox, "apt-get");
    const hasDnf = await hasCommand(sandbox, "dnf");
    if (hasApt) {
        await installAptPackages(sandbox);
    }
    // The browser plugin runs eve's agent-browser: its CLI, Chromium, and Chromium's libraries
    // from apt or dnf.
    if (hasApt || hasDnf) {
        await installAgentBrowser(sandbox);
    }
}

async function installAptPackages(sandbox: SandboxSession) {
    const packages = aptPackages.join(" ");
    const result = await sandbox.run({
        command: `sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packages}`,
    });
    if (result.exitCode !== 0) {
        throw new Error(`Installing plugin CLIs failed: ${result.stderr || result.stdout}`);
    }
}

// `program` is always one of ours, never model input.
async function hasCommand(sandbox: SandboxSession, program: string) {
    const result = await sandbox.run({ command: `command -v ${program}` });
    return result.exitCode === 0;
}

export const environment = DefaultSandbox.environment({ prepare: installPlugins });

export default defineSandbox(() => environment.open());
