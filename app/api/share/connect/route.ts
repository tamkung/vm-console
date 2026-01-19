import { NextRequest, NextResponse } from 'next/server';
import { verifyShareToken } from '@/lib/auth';
import { ProxmoxClient } from '@/lib/proxmox';

export async function POST(request: NextRequest) {
    try {
        const { token } = await request.json();

        if (!token) {
            return NextResponse.json({ error: 'Missing token' }, { status: 400 });
        }

        const payload = verifyShareToken(token);
        if (!payload) {
            return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 });
        }

        const { vmid, node, username, password, host, exp, type = 'qemu' } = payload;

        if (!username || !password || !host) {
            console.error("Invalid Token Payload: Missing credentials");
            return NextResponse.json({ error: 'Invalid token structure' }, { status: 400 });
        }

        // Initialize Proxmox Client with specific host from token
        const client = new ProxmoxClient(host);

        // Login as the embedded user
        // Note: We use 'pam' as default realm if not specified, 
        // effectively we expect username to be full user@realm if not PAM
        // But for simplicity let's assume standard login format
        // If username has @, split it.
        let user = username;
        let realm = 'pam';
        if (username.includes('@')) {
            [user, realm] = username.split('@');
        }

        const auth = await client.login(user, password, realm);
        const ticket = auth.data.ticket;

        // Get VNC or Term Ticket using this new session
        // Validates that this user actually has permission
        let vncData;
        if (type === 'lxc') {
            vncData = await client.getTermProxy(node, vmid, ticket, auth.data.CSRFPreventionToken);
        } else {
            vncData = await client.getVncProxy(node, vmid, ticket, auth.data.CSRFPreventionToken, type as 'qemu' | 'lxc');
        }

        // Create response with cookie
        const response = NextResponse.json({
            ...vncData.data,
            node,
            vmid,
            type, // Return type to frontend for constructing WebSocket URL
            expiresAt: exp ? exp * 1000 : null
        });

        // Set PVEAuthCookie so the browser is "logged in" for the WebSocket connection
        response.cookies.set('PVEAuthCookie', ticket, {
            httpOnly: true, // Secure, not accessible to JS
            secure: process.env.NODE_ENV === 'production',
            path: '/', // Allow access for all proxy routes
            sameSite: 'lax',
            maxAge: 7200 // 2 hours match
        });

        return response;

    } catch (error: any) {
        console.error('Share Connect Error:', error);
        return NextResponse.json({ error: error.message || 'Connection failed' }, { status: 500 });
    }
}
