import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function POST(request: NextRequest) {
    try {
        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;
        const csrfToken = cookieStore.get('PVE_CSRF_TOKEN')?.value;

        if (!ticket || !csrfToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = cookieStore.get('PROXMOX_HOST')?.value || process.env.PROXMOX_URL;
        if (!url) {
            return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
        }

        const { node, vmid, newid, name, full, additionalConfig } = await request.json();

        if (!node || !vmid || !newid) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        const client = new ProxmoxClient(url);
        const upid = await client.cloneVm(node, vmid, { newid, name, full: full ? 1 : 0 }, ticket, csrfToken);

        return NextResponse.json({ 
            success: true, 
            upid: upid,
            message: `Cloning VM ${vmid} to ${newid} initiated.` 
        });
    } catch (error: unknown) {
        console.error('Clone VM error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Failed to clone VM' },
            { status: 500 }
        );
    }
}
