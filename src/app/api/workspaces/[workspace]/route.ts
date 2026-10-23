import { NextRequest } from "next/server";
import { endpoint } from "@/server/http";
import { getSnapshot } from "@/server/services/finance";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspace: string }> },
) {
  const { workspace } = await params;
  return endpoint(request, () => getSnapshot(workspace));
}
