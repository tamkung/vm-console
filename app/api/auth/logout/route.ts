import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    const cookieStore = await cookies();

    // Clear all auth-related cookies
    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        sameSite: 'lax' as const,
        maxAge: 0, // Expire immediately
    };

    cookieStore.set('PVEAuthCookie', '', cookieOptions);
    cookieStore.set('PVE_CSRF_TOKEN', '', cookieOptions);
    cookieStore.set('PROXMOX_HOST', '', cookieOptions);

    // Clear user display cookie (not httpOnly, but good to clean up)
    cookieStore.set('PVE_USER', '', { ...cookieOptions, httpOnly: false });

    return NextResponse.json({ success: true });
}
