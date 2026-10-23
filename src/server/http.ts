import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
export function requestOrigin(request: NextRequest) {
  return `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
}
export async function endpoint(
  request: NextRequest,
  run: () => Promise<unknown>,
) {
  try {
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (!origin || origin !== requestOrigin(request))
        throw new AppError("Request origin is not allowed", 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new AppError("Use a JSON request", 415);
      if (Number(request.headers.get("content-length") ?? 0) > 200000)
        throw new AppError("Request is too large", 413);
    }
    return NextResponse.json(
      { data: await run() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 500;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof ZodError
          ? error.issues
              .map((i) => i.message)
              .slice(0, 3)
              .join(". ")
          : "Something went wrong. Please try again";
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          status,
          path: request.nextUrl.pathname,
        }),
      );
    if (status === 401 || status === 403)
      console.warn(
        JSON.stringify({
          event: "access_denied",
          status,
          path: request.nextUrl.pathname,
        }),
      );
    return NextResponse.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function jsonBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("A JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 200000) {
      await reader.cancel();
      throw new AppError("Request is too large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("Invalid JSON request");
  }
}
