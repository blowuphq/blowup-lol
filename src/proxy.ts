import { NextRequest, NextResponse } from 'next/server';

/**
 * Coming-soon gate (Phase 5.1).
 *
 * When COMING_SOON_MODE=true the prod domain shows a simple launch page at /
 * while keeping legal pages (/privacy, /terms, /refund-policy) reachable for
 * Dodo Payments' compliance review.  Any other non-API, non-static request
 * redirects to /.
 *
 * When the env var is unset or any value other than "true", the proxy is a
 * no-op — the full app runs exactly as before.
 */

const ALLOWED_PATHS = new Set(['/', '/privacy', '/terms', '/refund-policy']);

export function proxy(request: NextRequest) {
  if (process.env.COMING_SOON_MODE !== 'true') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (ALLOWED_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // Everything else → redirect to the coming-soon landing
  return NextResponse.redirect(new URL('/', request.url));
}

/**
 * Only run on "real" page requests. API routes, static assets, image
 * optimiser, favicon and SEO files are excluded by the negative lookahead.
 * Pattern from Next.js 16 proxy docs.
 */
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|favicon-512x512-transparent\\.png|favicon-512x512\\.png|favicon-48x48\\.png|favicon-32x32\\.png|favicon-16x16\\.png|blowup_logo_main\\.png|sitemap\\.xml|robots\\.txt).*)',
  ],
};
