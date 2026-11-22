import { BROWSER_TOOL_PREFIX, type PluginTool } from "@foundry/factory";
import { defineTool, toolOutput, toolOutputPart, type ToolDefinition } from "eve/tools";

// The browser plugin's tools are eve's agent-browser tools, renamed `browser_<tool>` so they can't
// clash with other tools. Each runs the agent-browser CLI in the session's sandbox, which keeps one
// browser per sandbox. The sandbox template installs the CLI and Chromium (agent/sandbox.ts), and a
// tool installs them itself when they're missing. They use the package's default settings, such as
// no domain allow list.

// Imported only when an agent has the plugin, so other turns don't load the package.
export async function browserToolEntries(tools: PluginTool[]) {
    if (tools.length === 0) {
        return [];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool has its own input and output
    const definitions: Record<string, ToolDefinition<any, any>> = await import("@eve/agent-browser/tools");
    return tools.map(({ name }) => {
        const eveName = name.slice(BROWSER_TOOL_PREFIX.length);
        const definition = definitions[eveName];
        if (!definition) {
            throw new Error(`eve's agent-browser has no tool named ${eveName}.`);
        }
        if (eveName === "screenshot") {
            return [name, withVisibleScreenshot(definition)] as const;
        }
        return [name, definition] as const;
    });
}

// eve attaches each screenshot as a data URL for the chat to show and tells the model the person
// saw it. Foundry's chat shows no images yet, so the model gets the image instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the package types its output loosely
function withVisibleScreenshot(screenshot: ToolDefinition<any, any>) {
    return defineTool({
        ...screenshot,
        toModelOutput(output: { imageDataUrl?: string }) {
            const { imageDataUrl, ...details } = output;
            const dataUrl = imageDataUrl ? /^data:([^;,]+);base64,(.+)$/.exec(imageDataUrl) : null;
            if (!dataUrl) {
                return toolOutput.json(details);
            }
            const [, mediaType, base64] = dataUrl;
            return toolOutput.content([
                toolOutputPart.text(JSON.stringify(details)),
                toolOutputPart.file(base64, { mediaType }),
            ]);
        },
    });
}
