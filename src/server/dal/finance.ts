import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Snapshot, Workspace } from "@/lib/types";
import { databaseError } from "../errors";
export async function workspaces(client: SupabaseClient) {
  const { data, error } = await client
    .from("workspaces")
    .select("*")
    .order("created_at");
  if (error) databaseError(error);
  return data as Workspace[];
}
export async function snapshot(
  client: SupabaseClient,
  w: string,
): Promise<Snapshot> {
  const { data, error } = await client.rpc("read_snapshot", { w });
  if (error) databaseError(error);
  return data as Snapshot;
}
export async function command(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) databaseError(error);
  return data;
}
