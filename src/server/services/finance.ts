import "server-only";
import { verifiedClient } from "../auth";
import * as dal from "../dal/finance";
import { recordEvent, reversePosting, priorOperation, prepareEvent, commitOperation } from "../accounting/commands";
import { accountingCommandInput, sourceRequest } from "@/lib/accounting/contracts";
import { prepareBookkeeping } from "@/lib/modules/bookkeeping";
export {accrueSalary, paySalary} from "../modules/payroll";
import {
  accountInput,
  partyInput,
  queryInput,
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
  const {workspace: w} = queryInput.parse({workspace}), {client} = await verifiedClient();
  return recordEvent(client, w, input);
}
export async function reverseEvent(workspace: string, input: unknown) {
  const {workspace: w} = queryInput.parse({workspace}), {client} = await verifiedClient();
  return reversePosting(client, w, input);
}
export async function executeCommand(workspace: string, input: unknown) {
  const {workspace: w} = queryInput.parse({workspace});
  const command = accountingCommandInput.parse(input);
  const {client} = await verifiedClient();
  const snapshot = await dal.snapshot(client, w);
  const request = {command:command.type,...sourceRequest(command.input)};
  const source = command.source_id ?? command.input.id;
  const moduleName = command.type === "guided" && ["invoice","bill"].includes(command.input.kind) ? "invoicing" : "bookkeeping";
  if (command.post) {
    const prior = await priorOperation(client,w,source,"record",request,moduleName);
    if(prior) return prior;
  }
  const event = prepareEvent(() => prepareBookkeeping(snapshot,command));
  if(!command.post) return recordEvent(client,w,{event,post:false});
  return commitOperation(client,"save_bookkeeping_event",{w,source_id:source,request,p:event});
}
