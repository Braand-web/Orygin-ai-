/**
 * TypeScript client SDK for the Orygin runtime: spawn the
 * `dsh-jsonrpc-agent` runtime as a subprocess and drive agent turns over
 * stdio JSON-RPC. `OryginHarness` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; the runtime process it spawns is a
 * complete harness configured by its own `cordis.yml`.
 *
 * @module @orygin-ai/dsh-sdk-client
 */

export { OryginHarness, HarnessSession } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@orygin-ai/dsh-sdk-protocol'
export type {
  ContentBlock,
  OryginHarnessOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
