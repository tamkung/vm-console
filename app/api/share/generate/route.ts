import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signShareToken, decrypt } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const { vmid, node, duration, credentialsToken, type = 'qemu' } = await request.json(); // duration in minutes

        if (!vmid || !node || !duration || !credentialsToken) {
            return NextResponse.json({ error: 'Missing parameters (vmid, node, duration, credentialsToken)' }, { status: 400 });
        }

        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;

        if (!ticket) {
            // Even though we use passed credentials, we still want to ensure the requester is authenticated to generate links
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Decrypt the credentials blob sent from the client
        let creds;
        try {
            const jsonStr = decrypt(credentialsToken);
            creds = JSON.parse(jsonStr);
        } catch (e) {
            console.error("Failed to decrypt credentials token", e);
            return NextResponse.json({ error: 'Invalid credentials token' }, { status: 400 });
        }

        const { username, password, host } = creds;

        // Use custom host if provided, else fallback to env (effectively "self" context for the link payload)
        // If host passed is null/empty, use process.env.PROXMOX_URL
        const targetHost = host || process.env.PROXMOX_URL || '';

        // Generate Token with Encrypted Credentials
        // duration comes in minutes
        const token = signShareToken({ vmid, node, username, password, host: targetHost, type: type as 'qemu' | 'lxc' }, `${duration}m`);

        // Return full share URL
        // We need the origin to construct the full link 
        // const origin = request.nextUrl.origin;
        const proto = request.headers.get('x-forwarded-proto') ?? 'http';
        const reqHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
        const origin = `${proto}://${reqHost}`;
        
        const link = `${origin}/share?token=${token}`;

        return NextResponse.json({ link, token });
    } catch (error: any) {
        console.error('Share Generate Error:', error);
        return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 });
    }
}
