import { NextResponse } from "next/server";

import { auth, isAuthenticationConfigured } from "@/server/auth";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";

const handlers = auth.handler();

type AuthRouteContext = {
  params: Promise<{ all: string[] }>;
};

type NeonAuthRouteContext = Parameters<typeof handlers.GET>[1];

function authenticationUnavailable() {
  return NextResponse.json(
    {
      error: "authentication_not_configured",
    },
    { status: 503 },
  );
}

function protectedMutation(
  handler: (request: Request, context: NeonAuthRouteContext) => Promise<Response>,
) {
  return async (request: Request, context: AuthRouteContext) => {
    try {
      assertRequestSize(request, 64_000);
      await enforceRequestRateLimit(request, {
        bucket: "authentication",
        limit: 60,
        windowSeconds: 600,
      });
      return handler(request, awaitableNeonContext(context));
    } catch (error) {
      return requestProtectionResponse(error) ?? authenticationUnavailable();
    }
  };
}

export const GET = isAuthenticationConfigured
  ? (request: Request, context: AuthRouteContext) =>
      handlers.GET(request, awaitableNeonContext(context))
  : authenticationUnavailable;
export const POST = isAuthenticationConfigured
  ? protectedMutation(handlers.POST)
  : authenticationUnavailable;
export const PUT = isAuthenticationConfigured
  ? protectedMutation(handlers.PUT)
  : authenticationUnavailable;
export const DELETE = isAuthenticationConfigured
  ? protectedMutation(handlers.DELETE)
  : authenticationUnavailable;
export const PATCH = isAuthenticationConfigured
  ? protectedMutation(handlers.PATCH)
  : authenticationUnavailable;

function awaitableNeonContext(context: AuthRouteContext): NeonAuthRouteContext {
  return {
    params: context.params.then(({ all }) => ({ path: all })),
  };
}
