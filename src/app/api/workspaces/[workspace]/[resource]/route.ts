import { NextRequest } from "next/server";
import { AppError } from "@/server/errors";
import { endpoint, jsonBody } from "@/server/http";
import {
  saveAccount,
  saveEvent,
  saveParty,
  reverseEvent,
} from "@/server/services/finance";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspace: string; resource: string }> },
) {
  return endpoint(request, async () => {
    const { workspace, resource } = await params,
      input = await jsonBody(request);
    if (resource === "accounts") return saveAccount(workspace, input);
    if (resource === "parties") return saveParty(workspace, input);
    if (resource === "events") return saveEvent(workspace, input);
    if (resource === "reversals") return reverseEvent(workspace, input);
    throw new AppError("Endpoint not found", 404);
  });
}
