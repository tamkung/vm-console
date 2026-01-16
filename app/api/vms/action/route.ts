import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function POST(request: NextRequest) {
    try {
        const { vmid, node, action, type = 'qemu' } = await request.json();

        if (!vmid || !node || !action) {
            return NextResponse.json({ error: 'Missing vmid, node, or action' }, { status: 400 });
        }

        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;
        const csrfToken = cookieStore.get('PVE_CSRF_TOKEN')?.value;
        const customHost = cookieStore.get('PROXMOX_HOST')?.value;

        if (!ticket || !csrfToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = customHost || process.env.PROXMOX_URL;
        if (!url) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const client = new ProxmoxClient(url);

        await client.vmStatus(node, vmid, action, ticket, csrfToken, type as 'qemu' | 'lxc');

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error('VM Action error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Failed to perform action' },
            { status: 500 }
        );
    }
}
