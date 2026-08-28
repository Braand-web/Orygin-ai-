/** Verified Paddle webhook ingestion for the SaaS host. */

import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Paddle } from '@paddle/paddle-node-sdk'

const MAX_WEBHOOK_BYTES = 1024 * 1024

/**
 * Whether Paddle webhook ingestion has every server-only secret it requires.
 * @returns current configuration readiness.
 */
export function paddleWebhookConfigured(): boolean {
  return requiredEnvironment('PADDLE_API_KEY') !== undefined
    && requiredEnvironment('PADDLE_WEBHOOK_SECRET') !== undefined
    && requiredEnvironment('SUPABASE_URL') !== undefined
    && requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY') !== undefined
}

/**
 * Verify one raw Paddle delivery and durably enqueue it exactly once.
 * @param request - untouched Node request stream.
 * @param response - response completed after the event is durably inserted.
 * @returns completion after the HTTP response is sent.
 */
export async function handlePaddleWebhook(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    respond(response, 405, 'method not allowed')
    return
  }
  const apiKey = requiredEnvironment('PADDLE_API_KEY')
  const webhookSecret = requiredEnvironment('PADDLE_WEBHOOK_SECRET')
  const supabaseUrl = requiredEnvironment('SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  if (apiKey === undefined || webhookSecret === undefined
    || supabaseUrl === undefined || serviceRoleKey === undefined) {
    respond(response, 503, 'billing unavailable')
    return
  }
  const signature = firstHeader(request.headers['paddle-signature'])
  if (signature === undefined) {
    respond(response, 400, 'invalid webhook')
    return
  }

  let rawBody: string
  try {
    rawBody = await readBody(request, MAX_WEBHOOK_BYTES)
  } catch {
    respond(response, 413, 'payload too large')
    return
  }

  try {
    const event = await new Paddle(apiKey).webhooks.unmarshal(rawBody, webhookSecret, signature)
    const payload = JSON.parse(rawBody) as unknown
    const persisted = await fetch(new URL('/rest/v1/rpc/ingest_paddle_event', supabaseUrl), {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_provider_event_id: event.eventId,
        p_event_type: event.eventType,
        p_occurred_at: event.occurredAt,
        p_payload_hash: createHash('sha256').update(rawBody).digest('hex'),
        p_payload: payload,
      }),
    })
    if (!persisted.ok) {
      respond(response, 503, 'billing unavailable')
      return
    }
    respond(response, 200, 'ok')
  } catch {
    // Signature failures and malformed event payloads share one opaque response.
    respond(response, 400, 'invalid webhook')
  }
}

function requiredEnvironment(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const raw: unknown = chunk
    let bytes: Uint8Array
    if (typeof raw === 'string') bytes = Buffer.from(raw)
    else if (raw instanceof Uint8Array) bytes = raw
    else throw new Error('invalid webhook body chunk')
    total += bytes.length
    if (total > limit) throw new Error('webhook body limit exceeded')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}
