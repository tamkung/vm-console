import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ vmid: string }> }
) {
    try {
        const { vmid } = await params;
        const { searchParams } = new URL(request.url);
        const node = searchParams.get('node');
        const type = searchParams.get('type') || 'qemu';

        if (!vmid || !node) {
            return NextResponse.json({ error: 'Missing vmid or node' }, { status: 400 });
        }

        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;
        const csrfToken = cookieStore.get('PVE_CSRF_TOKEN')?.value;

        if (!ticket || !csrfToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = cookieStore.get('PROXMOX_HOST')?.value || process.env.PROXMOX_URL;
        if (!url) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Extract hostname from PROXMOX_URL for the client to connect to
        // This assumes the client can reach the same URL
        // We remove protocol and port to get the hostname, but actually we likely need the full base for the wss connection
        // Proxmox usage: wss://<host>:8006/...
        // We will return the host to the client.

        const client = new ProxmoxClient(url);

        // Start VNC Proxy
        const vncData = await client.getVncProxy(node, parseInt(vmid), ticket, csrfToken, type as 'qemu' | 'lxc');

        return NextResponse.json({
            ...vncData.data,
            node, // Pass back node
            baseUrl: url, // Pass back configured URL
        });

    } catch (error: unknown) {
        console.error('VNC Proxy error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Failed to start VNC proxy' },
            { status: 500 }
        );
    }
}
