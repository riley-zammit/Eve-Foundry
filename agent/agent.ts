import { defineAgent } from "eve";
import { factoryModel } from "./lib/factory";

export default defineAgent({
    model: factoryModel(),
    reasoning: "high",
    // Each factory opts into tools in the builder; see agent/tools/factory.ts.
    defaultTools: false,
});
