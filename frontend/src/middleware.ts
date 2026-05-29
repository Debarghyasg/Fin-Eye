/**
 * Clerk middleware — @clerk/nextjs v5 + Next.js 15 compatible.
 *
 * v4 used `authMiddleware` which called `headers()` synchronously.
 * Next.js 15 made `headers()` async-only, so v4 throws:
 *   "Route used `...headers()` — should be awaited before using its value."
 *
 * v5 ships `clerkMiddleware` + `createRouteMatcher` which are fully
 * compatible with Next.js 15's async Request APIs.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  // Run on every route except Next.js internals and static files.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
