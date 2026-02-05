import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const ticket = cookieStore.get('PVEAuthCookie')?.value;
    const savedHost = cookieStore.get('proxmox_host')?.value;

    if (!ticket) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const proxmoxUrl = savedHost || process.env.PROXMOX_URL;
    if (!proxmoxUrl) {
        return NextResponse.json({ error: 'Proxmox URL not configured' }, { status: 500 });
    }

    const searchParams = request.nextUrl.searchParams;
    const vmid = searchParams.get('vmid');
    const node = searchParams.get('node');
    const type = (searchParams.get('type') || 'qemu') as 'qemu' | 'lxc';

    if (!vmid || !node) {
        return NextResponse.json({ error: 'Missing vmid or node parameter' }, { status: 400 });
    }

    try {
        const client = new ProxmoxClient(proxmoxUrl);
        const ips = await client.getVmNetworkInfo(node, parseInt(vmid), ticket, type);

        return NextResponse.json({
            vmid: parseInt(vmid),
            node,
            type,
            ips
        });
    } catch (error) {
        console.error('Failed to get VM network info:', error);
        return NextResponse.json({
            vmid: parseInt(vmid),
            node,
            type,
            ips: [],
            error: error instanceof Error ? error.message : 'Failed to get network info'
        });
    }
}
