import { NextRequest } from "next/server";
import { endpoint, jsonBody, requestOrigin } from "@/server/http";
import { authAction } from "@/server/services/auth";
export function POST(request: NextRequest) {
  return endpoint(request, async () =>
    authAction(await jsonBody(request), requestOrigin(request)),
  );
}
