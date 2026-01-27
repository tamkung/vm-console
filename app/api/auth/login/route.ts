import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProxmoxClient } from '@/lib/proxmox';
import { encrypt } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        let { username, password, realm, customHost } = body;

        // Decode obfuscated password
        if (password) {
            try {
                password = Buffer.from(password, 'base64').toString('utf-8');
            } catch (e) {
                // Keep original if decoding fails (backward compatibility/edge case)
            }
        }

        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // Determine Proxmox URL: Use customHost if provided, otherwise env var
        let url = customHost;
        if (!url) {
            url = process.env.PROXMOX_URL;
        }

        if (!url) {
            console.error('PROXMOX_URL is not defined in environment variables and no custom host provided');
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            );
        }

        // Basic URL validation/cleanup
        try {
            // Add protocol if missing
            if (!url.startsWith('http')) {
                url = `https://${url}`;
            }
            new URL(url); // Test if valid URL
        } catch (e) {
            return NextResponse.json(
                { error: 'Invalid Custom Host URL' },
                { status: 400 }
            );
        }

        const client = new ProxmoxClient(url);
        const auth = await client.login(username, password, realm || 'pam');

        const cookieStore = await cookies();

        // Set PVEAuthCookie
        cookieStore.set('PVEAuthCookie', auth.data.ticket, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            sameSite: 'lax',
            maxAge: 7200, // 2 hours usually
        });

        // Set CSRF Token
        cookieStore.set('PVE_CSRF_TOKEN', auth.data.CSRFPreventionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            sameSite: 'lax',
        });

        // Set Username for display
        cookieStore.set('PVE_USER', auth.data.username, {
            httpOnly: false, // Accessible to client
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            sameSite: 'lax',
        });

        // Set Custom Host Cookie if used
        if (customHost) {
            cookieStore.set('PROXMOX_HOST', url, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                path: '/',
                sameSite: 'lax',
                maxAge: 7200, // Match session
            });
        } else {
            // Clear it if not using custom host to fall back to env var
            cookieStore.delete('PROXMOX_HOST');
        }

        // Create encrypted credentials blob for client to store (for sharing features)
        const credsPayload = {
            username: auth.data.username, // Use the returned full username
            password: password, // The password used for login
            host: url // The host used
        };
        const credentialsToken = encrypt(JSON.stringify(credsPayload));

        return NextResponse.json({
            success: true,
            username: auth.data.username,
            credentialsToken
        });
    } catch (error: unknown) {
        console.error('Login error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message || 'Authentication failed' },
            { status: 401 }
        );
    }
}
