import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ node: string }> }
) {
    try {
        const { node } = await params;
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
        const type = request.nextUrl.searchParams.get('type') || 'bridge';
        const network = await client.getNodesNetwork(node, ticket, type);

        return NextResponse.json({ network });
    } catch (error: unknown) {
        console.error('Fetch Node Network error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Failed to fetch network' },
            { status: 500 }
        );
    }
}
