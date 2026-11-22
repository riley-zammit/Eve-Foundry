import { PREBUILT_TOOLS } from "@foundry/factory";
import type { DecisionAnswer, DecisionQuestion } from "eve/ai";
import { defineTool } from "eve/tools";
import { decideInputSchema, type DecideInput } from "./decide-spec";

// The `decide` built-in tool: typed questions about some text, answered by an evaluation model
// (TypeSafe AI's Jev unless the factory picks another). It returns the answers and nothing else.

// Answers keyed by question id.
export type DecideOutput = Record<string, DecisionAnswer<DecisionQuestion>>;

// `model` is an AI Gateway id. Null leaves it to eve, which uses Jev.
export async function runDecision({ state, questions }: DecideInput, model: string | null, signal: AbortSignal): Promise<DecideOutput> {
    const questionEntries = questions.map((question) => [question.id, toDecisionQuestion(question)]);
    const decisionQuestions: Record<string, DecisionQuestion> = Object.fromEntries(questionEntries);
    if (Object.keys(decisionQuestions).length < questions.length) {
        throw new Error("Each question needs its own id.");
    }
    const { decide } = await import("eve/ai");
    const result = await decide({
        model: model ?? undefined,
        state,
        questions: decisionQuestions,
        signal,
    });
    return result.answers;
}

function toDecisionQuestion({ id, type, question, options = [] }: DecideInput["questions"][number]): DecisionQuestion {
    if (type === "boolean") {
        return {
            type,
            instructions: question,
        };
    }
    const uniqueOptions = new Set(options);
    if (uniqueOptions.size < 2 || uniqueOptions.size < options.length) {
        throw new Error(`Question "${id}" needs at least two different options.`);
    }
    if (type === "choice") {
        // The labels are what the model picks between, so each one describes itself.
        const criteriaEntries = options.map((option) => [option, option]);
        return {
            type,
            instructions: question,
            criteria: Object.fromEntries(criteriaEntries),
        };
    }
    return {
        type,
        instructions: question,
        criteria: options,
    };
}

// One per configured tool, so each copy runs its own model.
export function decideTool(model: string | null) {
    return defineTool({
        description: PREBUILT_TOOLS.decide.description,
        inputSchema: decideInputSchema,
        execute: (input, ctx) => runDecision(input, model, ctx.abortSignal),
    });
}
