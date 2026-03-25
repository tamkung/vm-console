import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ vmid: string }> }
) {
    try {
        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;

        if (!ticket) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = cookieStore.get('PROXMOX_HOST')?.value || process.env.PROXMOX_URL;
        if (!url) {
            return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
        }

        const { vmid: vmidStr } = await params;
        const vmid = parseInt(vmidStr);
        const { searchParams } = new URL(request.url);
        const node = searchParams.get('node');
        const type = (searchParams.get('type') || 'qemu') as 'qemu' | 'lxc';

        if (!node) {
            return NextResponse.json({ error: 'Missing node parameter' }, { status: 400 });
        }

        const client = new ProxmoxClient(url);

        // Fetch status, config, and network info in parallel
        const [status, config, ips] = await Promise.all([
            client.getVmStatus(node, vmid, ticket, type),
            client.getVmConfig(node, vmid, ticket, type),
            client.getVmNetworkInfo(node, vmid, ticket, type),
        ]);

        return NextResponse.json({ status, config, ips });
    } catch (error: unknown) {
        console.error('VM detail error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('401')) {
            return NextResponse.json({ error: 'Session expired' }, { status: 401 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
