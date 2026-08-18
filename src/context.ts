export type ToolCtx = { origin: string; token: string; fetchImpl?: typeof fetch };

export class ToolError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

// Agent-recoverable messages per status (spec §8: no stack traces, no bare codes).
const STATUS_HINTS: Record<number, [string, string]> = {
  401: ['Invalid or missing API key', 'Check the Authorization header contains a valid pf_ key.'],
  403: ['This API key cannot perform that action', 'Bootstrap keys can only create mailboxes; use an api-scope key for other tools.'],
  402: ['Monthly quota exhausted', 'The account hit its send/extraction quota. See plans at https://postfleet.ai/pricing or wait for the monthly reset.'],
  404: ['Not found', 'The mailbox or message id does not exist or belongs to another account.'],
  422: ['Recipient is suppressed', 'This address previously bounced, complained, or unsubscribed. Postfleet will not send to it.'],
  502: ['Email provider is temporarily unavailable', 'This is transient — retry the same call in a few seconds.'],
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
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const [msg, hint] = STATUS_HINTS[res.status] ?? [`Request failed (${res.status})`, json.error ?? 'Retry or check inputs.'];
    throw new ToolError(json.error ? `${msg}: ${json.error}` : msg, hint);
  }
  return json;
}
