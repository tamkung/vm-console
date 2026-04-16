import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ node: string, upid: string }> }
) {
    try {
        const { node, upid } = await params;
        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;

        if (!ticket) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = cookieStore.get('PROXMOX_HOST')?.value || process.env.PROXMOX_URL;
        if (!url) {
            return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
        }

        const client = new ProxmoxClient(url);
        
        // UPID strings often contain special characters like '@' or ':' that might be URL encoded
        const decodedUpid = decodeURIComponent(upid);
        
        const status = await client.getTaskStatus(node, decodedUpid, ticket);

        return NextResponse.json({ status });
    } catch (error: unknown) {
        console.error('Fetch Task Status error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Failed to fetch task status' },
            { status: 500 }
        );
    }
}
