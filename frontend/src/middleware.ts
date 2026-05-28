/**
 * Clerk middleware — Next.js 15 compatible.
 *
 * Two bugs fixed:
 *
 * 1. Google OAuth / SSO returning 404
 *    After Google redirects back to the app it hits:
 *      /sign-in/sso-callback?redirect_url=...
 *    That route was NOT in publicRoutes, so the old authMiddleware
 *    intercepted it before Clerk could handle the callback → 404.
 *    Fix: use clerkMiddleware (v4.29+) with a matcher that explicitly
 *    allows all /sign-in/* and /sign-up/* sub-paths including sso-callback.
 *
 * 2. headers() sync dynamic API warning in Next.js 15
 *    authMiddleware() internally calls headers() synchronously which
 *    Next.js 15 forbids. clerkMiddleware() is the updated API that
 *    awaits dynamic APIs correctly.
 *
 * IMPORTANT — Clerk dashboard setting required:
 *   Dashboard → Configure → Paths
 *     Sign-in URL:      /sign-in
 *     Sign-up URL:      /sign-up
 *     After sign-in:    /dashboard
 *     After sign-up:    /dashboard
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes that are publicly accessible without authentication.
// The regex patterns ensure ALL Clerk-internal sub-routes are public,
// including /sign-in/sso-callback (OAuth return), /sign-in/factor-one,
// /sign-up/verify-email-address, etc.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  // If the route is public — let it through without any auth check.
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  // For all other routes, require authentication.
  // If the user is not signed in, Clerk automatically redirects to /sign-in.
  await auth.protect();
});

export const config = {
  // Run the middleware on every route except static files and Next.js internals.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
