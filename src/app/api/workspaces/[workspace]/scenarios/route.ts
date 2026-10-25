import { NextRequest } from "next/server";
import { endpoint, jsonBody } from "@/server/http";
import { listScenarios, saveScenario } from "@/server/services/scenarios";
export async function GET(request: NextRequest, { params }: { params: Promise<{ workspace: string }> }) {
  return endpoint(request, async () => listScenarios((await params).workspace));
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ workspace: string }> }) {
  return endpoint(request, async () => saveScenario((await params).workspace, await jsonBody(request)));
}
