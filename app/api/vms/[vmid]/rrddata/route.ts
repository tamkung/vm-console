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
        const timeframe = searchParams.get('timeframe') || 'hour';

        if (!node) {
            return NextResponse.json({ error: 'Missing node parameter' }, { status: 400 });
        }

        const client = new ProxmoxClient(url);
        const rrddata = await client.getVmRrdData(node, vmid, ticket, type, timeframe);

        return NextResponse.json({ rrddata });
    } catch (error: unknown) {
        console.error('VM RRD data error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
