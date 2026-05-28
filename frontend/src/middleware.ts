/**
 * Clerk middleware — compatible with @clerk/nextjs v4 (installed: ^4.31.8).
 *
 * clerkMiddleware + createRouteMatcher only exist in Clerk v5+.
 * This project uses @clerk/nextjs ^4.31.8, so we use authMiddleware from
 * "@clerk/nextjs" (NOT from "@clerk/nextjs/server").
 *
 * The key fix for /sign-in/sso-callback 404:
 *   The catch-all folders [[...sign-in]] and [[...sign-up]] handle every
 *   Clerk sub-route (sso-callback, factor-one, verify-email, etc.).
 *   authMiddleware's publicRoutes must match those same paths so Clerk
 *   can complete the OAuth handshake without being intercepted.
 */
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  // Public routes — accessible without being signed in.
  // The regex patterns (.*) cover ALL Clerk sub-routes:
  //   /sign-in/sso-callback     ← Google / GitHub OAuth return
  //   /sign-in/factor-one       ← MFA step
  //   /sign-up/verify-email-address ← email verification
  publicRoutes: [
    "/",
    "/sign-in",
    "/sign-in/(.*)",
    "/sign-up",
    "/sign-up/(.*)",
    "/api/health",
    "/api/health/(.*)",
  ],
});

export const config = {
  // Run on every route except Next.js internals and static files.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
