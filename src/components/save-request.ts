/**
 * A create request is sent under one idempotency key. A retry of the unchanged form must resend that exact body
 * (same timestamp, same confirmed item); only a changed form builds a new one.
 */
export type SentRequest = {form: string; body: Record<string, unknown>};
export function requestToSend(sent: SentRequest | null, form: string, build: () => Record<string, unknown>): SentRequest {
  return sent && sent.form === form ? sent : {form, body: build()};
}
