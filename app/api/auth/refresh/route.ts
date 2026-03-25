import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function POST() {
    try {
        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;

        if (!ticket) {
            return NextResponse.json({ error: 'No session to refresh' }, { status: 401 });
        }

        const url = cookieStore.get('PROXMOX_HOST')?.value || process.env.PROXMOX_URL;
        if (!url) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const client = new ProxmoxClient(url);
        const auth = await client.renewTicket(ticket);

        // Update cookies with new ticket and CSRF token
        cookieStore.set('PVEAuthCookie', auth.data.ticket, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            sameSite: 'lax',
            maxAge: 7200,
        });

        cookieStore.set('PVE_CSRF_TOKEN', auth.data.CSRFPreventionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            sameSite: 'lax',
        });

        return NextResponse.json({ success: true, username: auth.data.username });
    } catch (error: unknown) {
        console.error('Token refresh error:', error);
        const message = error instanceof Error ? error.message : 'Refresh failed';
        
        // If renewal fails (ticket too old), return 401 so client redirects to login
        return NextResponse.json({ error: message }, { status: 401 });
    }
}
