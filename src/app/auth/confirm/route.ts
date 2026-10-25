import { NextRequest, NextResponse } from "next/server";
import { confirmAuth } from "@/server/services/auth";
import { requestOrigin } from "@/server/http";
export async function GET(request: NextRequest) {
  try {
    return NextResponse.redirect(
      new URL(await confirmAuth(request.nextUrl), requestOrigin(request)),
    );
  } catch {
    return NextResponse.redirect(
      new URL(
        "/login?error=Confirmation%20link%20expired.%20Request%20a%20fresh%20link.",
        requestOrigin(request),
      ),
    );
  }
}
