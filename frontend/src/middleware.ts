/**
 * Clerk middleware — required by @clerk/nextjs in App Router.
 *
 * Without this file Clerk's hooks (`useAuth`, `useUser`, etc.) silently
 * return `null` even when ClerkProvider is mounted, which means
 * `getToken()` produces no Bearer token and the FastAPI backend rejects
 * every request with 401.
 */
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  // Routes Clerk should treat as public (no auth required).
  publicRoutes: [
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/api/health(.*)",
  ],
});

export const config = {
  // Match everything except static files and Next internals.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
