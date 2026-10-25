import { NextRequest } from "next/server";
import { endpoint, jsonBody } from "@/server/http";
import { deleteScenario, readScenario } from "@/server/services/scenarios";
type Context = { params: Promise<{ workspace: string; scenario: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return endpoint(request, async () => { const { workspace, scenario } = await params; return readScenario(workspace, scenario); });
}
export async function POST(request: NextRequest, { params }: Context) {
  return endpoint(request, async () => { const { workspace, scenario } = await params; return deleteScenario(workspace, scenario, await jsonBody(request)); });
}
