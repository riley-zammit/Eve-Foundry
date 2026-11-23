// Calls Google's APIs for a service connection's tools, with the connection's sign-in. The token
// is read for each call and never reaches the model. Tools only pass Google API URLs, so the token
// goes nowhere else.

const REQUEST_TIMEOUT_MS = 30_000;

type CallOptions = {
    method?: string;
    body?: unknown;
    signal: AbortSignal;
};

// Resolves to Google's JSON answer, typed by the caller.
export type GoogleRequest = <T>(url: string, options: CallOptions) => Promise<T>;

export function googleApi(factoryId: string, connection: { id: string; name: string }): GoogleRequest {
    async function token() {
        const { connectionToken, isNotSignedIn } = await import("@foundry/factory/auth");
        try {
            const { token } = await connectionToken({
                factoryId,
                connectionId: connection.id,
                url: "",
            });
            return token;
        } catch (error) {
            if (isNotSignedIn(error)) {
                throw new Error(`${connection.name} isn't signed in. Someone needs to sign in to it from the connection in the Foundry builder.`);
            }
            throw error;
        }
    }

    async function request<T>(url: string, { method = "GET", body, signal }: CallOptions): Promise<T> {
        const send = async (accessToken: string) => fetch(url, {
            method,
            headers: {
                authorization: `Bearer ${accessToken}`,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        let response = await send(await token());
        // Google rejected the token before it expired, so get a fresh one and try once more.
        if (response.status === 401) {
            const { forgetConnectionToken } = await import("@foundry/factory/auth");
            await forgetConnectionToken(factoryId, connection.id);
            response = await send(await token());
        }
        const parsed = readJson(await response.text());
        if (!response.ok) {
            throw new Error(errorMessage(parsed) ?? `Google returned ${response.status}.`);
        }
        return parsed as T;
    }

    return request;
}

// Deletes answer with an empty body, and an outage can answer with HTML.
function readJson(text: string): unknown {
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}

// Google's errors look like `{ error: { message } }`.
function errorMessage(body: unknown) {
    if (typeof body !== "object" || body === null || !("error" in body)) {
        return null;
    }
    const { error } = body;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return `Google said: ${error.message}`;
    }
    return null;
}
