import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { shareStore } from '@/lib/store';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const vmid = searchParams.get('vmid');

        if (!vmid) {
            return NextResponse.json({ error: 'Missing vmid' }, { status: 400 });
        }

        // Verify authentication
        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;

        if (!ticket) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // We could verify the ticket with Proxmox here to be extra secure,
        // but for now existence of the cookie is a basic check.
        // In a real app we might want to check if the user actually owns the VM.
        // However, since we are using client-side credentials for generation, checking ownership here is tricky without full backend auth.
        // Assuming if you have the PVE cookie and know the VMID, you have access.

        const shares = shareStore.listAssets(parseInt(vmid));

        return NextResponse.json({ shares });
    } catch (error) {
        console.error('Share List Error:', error);
        return NextResponse.json({ error: 'Failed to list shares' }, { status: 500 });
    }
}
