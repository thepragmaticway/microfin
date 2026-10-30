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

export interface AccountingOperation {
  transaction_id: string;
  obligation_id: string | null;
  request: Record<string, unknown>;
  source: {module: string};
}
export async function accountingOperation(client: SupabaseClient, w: string, source: string, operation: string): Promise<AccountingOperation | null> {
  const {data,error} = await client.from("accounting_operations")
    .select("transaction_id,obligation_id,request,source:accounting_sources!inner(module)")
    .eq("workspace_id",w).eq("source_id",source).eq("operation",operation).maybeSingle();
  if(error) databaseError(error);
  return data as unknown as AccountingOperation | null;
}
export async function payrollSource(client: SupabaseClient, w: string, source: string) {
  const {data,error} = await client.from("payroll_items").select("id,employee_party_id,period")
    .eq("workspace_id",w).eq("id",source).maybeSingle();
  if(error) databaseError(error);
  return data as {id:string;employee_party_id:string;period:string} | null;
}
