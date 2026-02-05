import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // Define protected routes (exclude /console/guac which uses Guacamole auth, not Proxmox)
    const isProtectedRoute = (path.startsWith('/dashboard') || path.startsWith('/console'))
        && !path.startsWith('/console/guac');

    // Check for auth cookie
    const authCookie = request.cookies.get('PVEAuthCookie')?.value;

    if (isProtectedRoute && !authCookie) {
        // Redirect to login page if trying to access protected route without auth
        return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/dashboard/:path*', '/console/:path*'],
};
