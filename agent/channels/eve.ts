import { eveChannel, defaultEveAuth } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { FACTORY_HEADER } from "@foundry/factory";

export default eveChannel({
    auth: [
        // Lets the eve TUI and your Vercel deployments reach the deployed agent.
        vercelOidc(),
        // Open on localhost for `eve dev` and the REPL; ignored in production.
        localDev(),
        // This placeholder will not allow browser requests in production.
        // Replace it with your app's auth provider, like Auth.js or Clerk,
        // or use none() for a public demo.
        placeholderAuth(),
    ],
    // Pins the requested factory into session auth. The first message's auth becomes the
    // session's initiator, which the dynamic agent files read the factory from.
    async onMessage(ctx) {
        const auth = defaultEveAuth(ctx);
        const factoryId = ctx.eve.request.headers.get(FACTORY_HEADER);
        if (!factoryId || !auth) {
            return { auth };
        }
        const { getFactoryName } = await import("@foundry/factory/db");
        const factoryName = await getFactoryName(factoryId);
        if (factoryName === null) {
            throw new Error(`Unknown factory: ${factoryId}`);
        }
        return {
            auth: {
                ...auth,
                attributes: {
                    ...auth.attributes,
                    factoryId,
                },
            },
            title: factoryName,
        };
    },
});
