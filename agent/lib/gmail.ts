import type { ServiceToolName } from "@foundry/factory";
import { defineTool } from "eve/tools";
import { z } from "zod";
import type { GoogleRequest } from "./google-api";

// The Gmail service's tools. The sign-in can only send (gmail.send), so there's no reading or
// searching mail.

const MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

// z.email() refuses line breaks, so a recipient can't add headers.
const recipients = z.array(z.email()).max(50);

const sendEmailInput = z.object({
    to: recipients.min(1).describe("Email addresses to send to."),
    cc: recipients.optional().describe("Email addresses to copy."),
    bcc: recipients.optional().describe("Email addresses to copy without the others seeing."),
    subject: z.string().max(500).regex(/^[^\r\n]*$/, "The subject must be one line."),
    body: z.string().min(1).max(100_000).describe("Plain text. Line breaks are kept."),
});

export function gmailTools(google: GoogleRequest) {
    return {
        send_email: defineTool({
            description: "Send an email from the signed-in Gmail account. It sends as soon as it runs, so write the final text. The body is plain text.",
            inputSchema: sendEmailInput,
            label: { start: ({ to, subject }) => `Email ${to.join(", ")}: ${subject}` },
            async execute(input, ctx) {
                const raw = Buffer.from(mimeMessage(input)).toString("base64url");
                const sent = await google<{ id: string; threadId: string }>(`${MESSAGES_URL}/send`, {
                    method: "POST",
                    body: { raw },
                    signal: ctx.abortSignal,
                });
                return {
                    sent: true,
                    messageId: sent.id,
                    threadId: sent.threadId,
                };
            },
        }),
    } satisfies Record<ServiceToolName<"gmail">, unknown>;
}

// A plain-text RFC 2822 message. The subject and body are UTF-8 in base64, so any text is safe.
function mimeMessage({ to, cc = [], bcc = [], subject, body }: z.infer<typeof sendEmailInput>) {
    const headers = [`To: ${to.join(", ")}`];
    if (cc.length > 0) {
        headers.push(`Cc: ${cc.join(", ")}`);
    }
    if (bcc.length > 0) {
        headers.push(`Bcc: ${bcc.join(", ")}`);
    }
    const encodedSubject = Buffer.from(subject).toString("base64");
    headers.push(
        `Subject: =?UTF-8?B?${encodedSubject}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
    );
    const encodedBody = Buffer.from(body).toString("base64");
    const bodyLines = encodedBody.match(/.{1,76}/g) ?? [];
    return `${headers.join("\r\n")}\r\n\r\n${bodyLines.join("\r\n")}`;
}
