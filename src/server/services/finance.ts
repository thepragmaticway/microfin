import "server-only";
import { verifiedClient } from "../auth";
import * as dal from "../dal/finance";
import {
  accountInput,
  partyInput,
  queryInput,
  reversalInput,
  saveEventInput,
  workspaceInput,
} from "@/lib/contracts";
export async function listWorkspaces() {
  const { client } = await verifiedClient();
  return dal.workspaces(client);
}
export async function getSnapshot(workspace: string) {
  const { workspace: w } = queryInput.parse({ workspace });
  const { client } = await verifiedClient();
  return dal.snapshot(client, w);
}
export async function createWorkspace(input: unknown) {
  const p = workspaceInput.parse(input),
    { client, user } = await verifiedClient();
  const display_name =
    p.display_name ??
    (String(user.user_metadata.display_name ?? "Microfin user")
      .trim()
      .slice(0, 100) ||
      "Microfin user");
  return dal.command(client, "create_workspace", { p: { ...p, display_name } });
}
export async function saveAccount(workspace: string, input: unknown) {
  const { workspace: w } = queryInput.parse({ workspace }),
    p = accountInput.parse(input),
    { client } = await verifiedClient();
  return dal.command(client, "save_account", { w, p });
}
export async function saveParty(workspace: string, input: unknown) {
  const { workspace: w } = queryInput.parse({ workspace }),
    p = partyInput.parse(input),
    { client } = await verifiedClient();
  return dal.command(client, "save_party", { w, p });
}
export async function saveEvent(workspace: string, input: unknown) {
  const { workspace: w } = queryInput.parse({ workspace }),
    { event: p, post } = saveEventInput.parse(input),
    { client } = await verifiedClient();
  return dal.command(client, "save_event", { w, p, post });
}
export async function reverseEvent(workspace: string, input: unknown) {
  const { workspace: w } = queryInput.parse({ workspace }),
    p = reversalInput.parse(input),
    { client } = await verifiedClient();
  return dal.command(client, "reverse_event", { w, ...p });
}
