import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/auth/");
}

// Refreshes the Supabase session on every request (official @supabase/ssr
// pattern) and sends signed-out visitors to /login.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Keep this call right after creating the client: it validates the JWT and
  // refreshes the session if needed. Never use getSession() for this.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "צריך להתחבר מחדש" } },
      { status: 401 },
    );
  }
  if (!isSignedIn && !isPublicPath(pathname)) {
    return redirectKeepingCookies(request, response, "/login");
  }
  if (isSignedIn && pathname === "/login") {
    return redirectKeepingCookies(request, response, "/");
  }

  return response;
}

// A redirect must carry any refreshed auth cookies, or the session is lost.
function redirectKeepingCookies(request: NextRequest, from: NextResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  const cacheControl = from.headers.get("cache-control");
  if (cacheControl) {
    redirect.headers.set("cache-control", cacheControl);
  }
  return redirect;
}
