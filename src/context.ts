export type ToolCtx = { origin: string; token: string; fetchImpl?: typeof fetch };

export class ToolError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

// Agent-recoverable messages (spec §8: no stack traces, no bare codes).
//
// Status alone is too coarse to advise on. A 409 is a name collision for create_domain but an
// already-claimed draft for send_draft/update_draft/delete_draft; a 403 is far more often a key
// scope than a plan limit. Domain-specific advice on a draft conflict sends an agent down the
// wrong recovery path, so match the API's own `code` discriminator first and keep the status
// table generic enough to be true for every route that can return it.
const CODE_HINTS: Record<string, [string, string]> = {
  approval_conflict: [
    'Draft is no longer actionable',
    'The draft already left the draft state — sent, sending, rejected, or deleted. Call get_draft to see where it landed. Do NOT create a replacement draft: the atomic claim means a second send delivers nothing.',
  ],
  key_scope: [
    'This API key cannot perform that action',
    'The key is scoped to a different mailbox or lacks this permission. Call list_mailboxes to see what it can reach; a wider scope needs a new key from https://postfleet.ai.',
  ],
  mailbox_limit: [
    'Mailbox limit reached for this plan',
    'Reuse an existing mailbox from list_mailboxes, or raise the limit at https://postfleet.ai/pricing. Retrying create_mailbox fails the same way.',
  ],
  provider_domain_limit: [
    'The email provider has reached its domain cap',
    'This is the email-provider domain cap, not the Postfleet $20 plan. Do not retry until an operator raises provider capacity.',
  ],
};

const STATUS_HINTS: Record<number, [string, string]> = {
  400: ['Invalid request', 'Check the arguments against the tool schema — the error text names the field — and retry.'],
  401: ['Invalid or missing API key', 'Check the Authorization header contains a valid pf_ key.'],
  403: ['Not permitted', 'Either the scope of the API key or the account plan forbids this; the error text says which. Bootstrap keys can only create mailboxes, and custom domains need a paid plan.'],
  402: ['Monthly quota exhausted', 'The account hit its send/extraction quota. See plans at https://postfleet.ai/pricing or wait for the monthly reset.'],
  404: ['Not found', 'The mailbox, message, or domain id does not exist or belongs to another account.'],
  409: ['Conflict', 'Something already claimed this. For a domain, list_domains shows what is attached; for a draft, get_draft shows its current state. Retrying the same call will not clear it.'],
  422: ['Recipient is suppressed', 'This address previously bounced, complained, or unsubscribed. Postfleet will not send to it.'],
  502: ['Email provider error', 'For send_email/reply_email this can be transient — retry with the SAME client_id. For create_domain/verify_domain a 502 is usually a permanent provider rejection; do not retry the same call.'],
  503: ['Email provider is not configured', 'The hosted API is missing its provider key. Retrying or using the dashboard will not help until the operator configures the provider.'],
};

export async function callRest(ctx: ToolCtx, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object): Promise<unknown> {
  const f = ctx.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${ctx.origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${ctx.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // The retry advice is only safe because sends can be idempotent: a network failure can strike
    // AFTER the API accepted the send, so a bare "retry" would double-deliver. Reusing client_id
    // makes the retry replay the stored outcome instead of sending again.
    throw new ToolError(
      'Postfleet API unreachable',
      'Transient network failure — retry in a few seconds. If this was send_email or reply_email, retry with the SAME client_id so an email that already went out is not sent twice.',
    );
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const [msg, hint] =
      (json.code ? CODE_HINTS[json.code] : undefined) ??
      STATUS_HINTS[res.status] ?? [`Request failed (${res.status})`, json.error ?? 'Retry or check inputs.'];
    throw new ToolError(json.error ? `${msg}: ${json.error}` : msg, hint);
  }
  return json;
}
