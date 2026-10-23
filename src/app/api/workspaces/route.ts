import { NextRequest } from "next/server";
import { endpoint, jsonBody } from "@/server/http";
import { createWorkspace, listWorkspaces } from "@/server/services/finance";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  return endpoint(request, listWorkspaces);
}
export function POST(request: NextRequest) {
  return endpoint(request, async () =>
    createWorkspace(await jsonBody(request)),
  );
}
