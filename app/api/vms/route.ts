import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient, ProxmoxVm } from '@/lib/proxmox';

export async function GET() { // Remove 'request' if unused
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

        const client = new ProxmoxClient(url);

        // Get nodes first
        const nodes = await client.getNodes(ticket);

        // Fetch VMs and LXCs from all nodes
        const promises = nodes.flatMap((node) => {
            const vmsPromise = client.getVms(node, ticket).catch(e => {
                console.error(`Failed to fetch VMs from node ${node}:`, e.message);
                return [];
            });
            const lxcsPromise = client.getLxcs(node, ticket).catch(e => {
                console.error(`Failed to fetch LXCs from node ${node}:`, e.message);
                return [];
            });
            return [vmsPromise, lxcsPromise];
        });

        // promises is now array of promises (flatmapped? no wait)
        // flatMap returns flattened array of return values. 
        // My return value is [Promise, Promise]. So flatMap makes it [Promise, Promise, Promise, Promise...]
        // Correct.

        const results = await Promise.all(promises);

        // Fetch User Permissions to know if they can clone (VM.Clone)
        const permissions = await client.getUserPermissions(ticket).catch(() => ({} as Record<string, Record<string, number>>));

        // Flatten the array of arrays (results from promises)
        const allResources = results.flat().sort((a, b) => a.vmid - b.vmid).map(res => {
            // Check if user has VM.Clone permission on the specific VM path or globally
            const hasCloneSourcePerm = permissions['/']?.['VM.Clone']
                || permissions['/vms']?.['VM.Clone']
                || permissions[`/vms/${res.vmid}`]?.['VM.Clone'];

            // To clone, the user also needs VM.Allocate on the path where the new VM will be created
            // Usually this is on / or /vms.
            const hasAllocatePerm = permissions['/']?.['VM.Allocate']
                || permissions['/vms']?.['VM.Allocate'];

            return { ...res, canClone: !!(hasCloneSourcePerm && hasAllocatePerm) };
        });

        return NextResponse.json({ vms: allResources });
    } catch (error: unknown) {
        console.error('Fetch VMs error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('401')) {
            return NextResponse.json({ error: 'Session expired' }, { status: 401 });
        }
        return NextResponse.json(
            { error: message || 'Failed to fetch VMs' },
            { status: 500 }
        );
    }
}
