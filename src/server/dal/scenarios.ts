import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseError } from "../errors";
import type { ScenarioSummary } from "@/lib/scenarios";
export async function list(client: SupabaseClient, workspace: string): Promise<ScenarioSummary[]> {
  // RPC ownership check also distinguishes an inaccessible workspace from an empty list.
  const { data: allowed, error: ownershipError } = await client.rpc("owns_workspace", { w: workspace });
  if (ownershipError) databaseError(ownershipError);
  if (!allowed) databaseError({ code: "42501", message: "Workspace not found" });
  const { data, error } = await client.from("financial_scenarios")
    .select("id,workspace_id,name,start_date,end_date,opening_mode,frozen_at").eq("workspace_id", workspace).order("frozen_at", { ascending: false });
  if (error) databaseError(error);
  return data as ScenarioSummary[];
}
