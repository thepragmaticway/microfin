import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveEventInput, reversalInput } from "@/lib/contracts";
import { sameRequest } from "@/lib/accounting/contracts";
import type { EventInput } from "@/lib/types";
import * as dal from "../dal/finance";
import { AppError } from "../errors";

export async function recordEvent(client: SupabaseClient, workspace: string, input: unknown) {
  const {event: p, post} = saveEventInput.parse(input);
  return dal.command(client, "save_event", {w: workspace, p, post});
}
export async function reversePosting(client: SupabaseClient, workspace: string, input: unknown) {
  const p = reversalInput.parse(input);
  return dal.command(client, "reverse_event", {w: workspace, ...p});
}
/** Early lookup makes retries independent of changed balances and generated journal IDs.
 * The transactional RPC repeats this comparison under the workspace lock. */
export async function priorOperation(
  client: SupabaseClient, workspace: string, source: string, operation: string,
  request: Record<string, unknown>, module: string,
) {
  const prior = await dal.accountingOperation(client, workspace, source, operation);
  if (!prior) return null;
  if (prior.source.module !== module) throw new AppError("Source record not found", 403);
  if (!sameRequest(prior.request, request)) throw new AppError("Retry conflicts with the source operation", 409);
  return prior.transaction_id;
}
export function prepareEvent(build: () => EventInput): EventInput {
  try { return saveEventInput.parse({event: build(), post: true}).event; }
  catch (error) { throw new AppError(error instanceof Error ? error.message.slice(0, 300) : "Invalid accounting command", 400); }
}


export async function commitOperation(client: SupabaseClient, rpc: string, args: Record<string, unknown>) {
  return dal.command(client, rpc, args);
}
