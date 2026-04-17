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

        const { node, vmid, config, resizeDisk } = await request.json();

        if (!node || !vmid) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        const client = new ProxmoxClient(url);

        // 1. Apply general config (CPU, RAM, Cloud-Init, Network)
        if (config && Object.keys(config).length > 0) {
            try {
                await client.updateVmConfig(node, vmid, config, ticket, csrfToken);
            } catch (err: any) {
                console.error("Config apply error:", err);
                return NextResponse.json({ error: `Failed to configure VM: ${err.message}` }, { status: 500 });
            }
        }

        // 2. Apply Disk Resize if requested
        if (resizeDisk) {
            try {
                // First, find the primary disk
                const vmConfig = await client.getVmConfig(node, vmid, ticket, 'qemu');
                
                // Typical Proxmox boot disks
                const possibleDisks = ['scsi0', 'virtio0', 'sata0', 'ide0'];
                let targetDisk = null;

                for (const disk of possibleDisks) {
                    if (vmConfig[disk]) {
                        targetDisk = disk;
                        break;
                    }
                }

                if (targetDisk) {
                    // Ensure size is formatted with a + if it's meant to be incremental, 
                    // or passed correctly by the frontend. The Proxmox API allows "+10G" or "100G"
                    await client.resizeVmDisk(node, vmid, targetDisk, resizeDisk, ticket, csrfToken);
                } else {
                    console.warn(`Could not find a valid primary disk to resize on VM ${vmid}`);
                    return NextResponse.json({ 
                        success: true, 
                        message: `VM configured, but disk resize skipped (No clear primary disk found).` 
                    });
                }
            } catch (err: any) {
                console.error("Disk resize error:", err);
                return NextResponse.json({ 
                    success: true, 
                    warning: true,
                    message: `VM config applied, but disk resize failed: ${err.message}` 
                });
            }
        }

        return NextResponse.json({ success: true, message: `VM ${vmid} configured successfully.` });
    } catch (error: unknown) {
        console.error('Configure VM error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Failed to configure VM' },
            { status: 500 }
        );
    }
}
