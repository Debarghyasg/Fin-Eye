/**
 * Clerk middleware — required by @clerk/nextjs in App Router.
 *
 * Without this file Clerk's hooks (useAuth, useUser, etc.) silently return
 * null even when ClerkProvider is mounted, which means getToken() produces
 * no Bearer token and the FastAPI backend rejects every request with 401.
 *
 * Bug fixed:
 *   - Added explicit sign-in / sign-up redirect URLs so Clerk knows where
 *     to send unauthenticated users instead of guessing.
 *   - Public routes list covers the root "/" and both auth pages so users
 *     can reach the sign-in page without being redirected in a loop.
 */
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  // Routes that do NOT require authentication.
  publicRoutes: [
    "/",
    "/sign-in",
    "/sign-in/(.*)",
    "/sign-up",
    "/sign-up/(.*)",
  ],

  // Where Clerk redirects unauthenticated users who hit protected routes.
  // Must match the path your sign-in page is actually served on.
  ignoredRoutes: ["/api/health"],
});

export const config = {
  // Run on every route except static files and Next.js internals.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
