import { NextRequest, NextResponse } from 'next/server';
import { encryptPayload } from '@/lib/crypto';

interface ConnectionRequest {
    protocol: 'rdp' | 'vnc' | 'ssh';
    host: string;
    port: number | string;
    username: string;
    password?: string;
    vmName?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: ConnectionRequest = await request.json();
        const { protocol, host, port, username, password, vmName } = body;

        // Validate required fields
        if (!host || (protocol !== 'vnc' && !username)) {
            return NextResponse.json(
                { error: 'Missing required fields: host (and username) are required' },
                { status: 400 }
            );
        }

        const effectivePort = String(port || (protocol === 'ssh' ? '22' : protocol === 'vnc' ? '5900' : '3389'));

        // Create encrypted token using AES-256-GCM
        const token = encryptPayload({
            url: host.trim(),
            port: effectivePort,
            user: (username || '').trim(),
            password: password || '',
            vmName: vmName || `${(protocol || 'rdp').toUpperCase()} Console`,
            consoleType: protocol || 'rdp',
        });

        // Direct console URL in same app
        const consoleUrl = `/console/guac?token=${encodeURIComponent(token)}${vmName ? `&title=${encodeURIComponent(vmName)}` : ''}&proto=${protocol || 'rdp'}&user=${encodeURIComponent((username || '').trim())}`;

        return NextResponse.json({
            success: true,
            token,
            isolatedUrl: consoleUrl
        });

    } catch (error) {
        console.error('[Guacamole Connect] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
