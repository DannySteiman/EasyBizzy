import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextFetchEvent, NextResponse } from "next/server";

// Define public routes that don't require authentication
// Note: /checkout/success is public to support anonymous checkout flow
// The page itself handles auth state appropriately
const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing",
  "/checkout/success",
  "/checkout/cancel",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const clerkHandler = clerkMiddleware(async (auth, req) => {
  // Protect all routes except public ones
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default async function middleware(
  req: NextRequest,
  event: NextFetchEvent
) {
  try {
    return await clerkHandler(req, event);
  } catch (error) {
    console.error("[Middleware] Clerk error:", error);
    // Fail secure: redirect to sign-in rather than exposing a 500
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
