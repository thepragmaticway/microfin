import "server-only";
import { z } from "zod";
import { verifiedClient } from "../auth";
import { queryInput } from "@/lib/contracts";
import { scenarioInput } from "@/lib/scenario-contracts";
import * as dal from "../dal/scenarios";
import { command } from "../dal/finance";
export async function listScenarios(workspace: string) {
  const { workspace: w } = queryInput.parse({ workspace }), { client } = await verifiedClient();
  return dal.list(client, w);
}
export async function saveScenario(workspace: string, input: unknown) {
  const { workspace: w } = queryInput.parse({ workspace }), p = scenarioInput.parse(input), { client } = await verifiedClient();
  return command(client, "save_scenario", { w, p });
}
export async function readScenario(workspace: string, scenario: string) {
  const { workspace: w } = queryInput.parse({ workspace }), scenario_id = z.uuid().parse(scenario), { client } = await verifiedClient();
  return command(client, "read_scenario", { w, scenario_id });
}
export async function deleteScenario(workspace: string, scenario: string, input: unknown) {
  z.object({ action: z.literal("delete") }).strict().parse(input);
  const { workspace: w } = queryInput.parse({ workspace }), scenario_id = z.uuid().parse(scenario), { client } = await verifiedClient();
  return command(client, "delete_scenario", { w, scenario_id });
}
