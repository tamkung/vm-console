import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

interface ConnectionRequest {
    protocol: 'rdp' | 'vnc' | 'ssh';
    host: string;
    port: number;
    username: string;
    password: string;
}

// Simple in-memory session store (in production, use Redis or similar)
const sessionStore = new Map<string, { url: string; expiresAt: number }>();

// Clean up expired sessions
function cleanupSessions() {
    const now = Date.now();
    for (const [key, value] of sessionStore.entries()) {
        if (value.expiresAt < now) {
            sessionStore.delete(key);
        }
    }
}

/**
 * Creates encrypted JSON payload for Guacamole auth
 * Uses HMAC-SHA256 for signing and AES-128-CBC for encryption
 */
function createEncryptedPayload(json: string, secretKeyHex: string): string {
    // Convert hex key to buffer (128-bit = 16 bytes)
    const key = Buffer.from(secretKeyHex, 'hex');

    if (key.length !== 16) {
        throw new Error('Secret key must be 32 hex characters (128 bits)');
    }

    // Sign with HMAC-SHA256
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(json, 'utf8');
    const signature = hmac.digest();

    // Combine signature + plaintext
    const dataToEncrypt = Buffer.concat([signature, Buffer.from(json, 'utf8')]);

    // Encrypt with AES-128-CBC, IV = all zeros
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(dataToEncrypt), cipher.final()]);

    // Return base64 encoded
    return encrypted.toString('base64');
}

export async function POST(request: NextRequest) {
    try {
        const body: ConnectionRequest = await request.json();
        const { protocol, host, port, username, password } = body;

        // Validate required fields
        if (!protocol || !host || !username) {
            return NextResponse.json(
                { error: 'Missing required fields: protocol, host, username' },
                { status: 400 }
            );
        }

        // Get environment variables
        const guacamoleUrl = process.env.GUACAMOLE_URL;
        const secretKey = process.env.GUACAMOLE_SECRET_KEY;

        if (!guacamoleUrl) {
            return NextResponse.json(
                { error: 'GUACAMOLE_URL not configured' },
                { status: 500 }
            );
        }

        if (!secretKey) {
            return NextResponse.json(
                { error: 'GUACAMOLE_SECRET_KEY not configured' },
                { status: 500 }
            );
        }

        // Build connection parameters based on protocol
        const connectionParams: Record<string, string> = {
            hostname: host,
            port: port.toString(),
            username: username
        };

        if (password) {
            connectionParams.password = password;
        }

        // Protocol-specific parameters
        if (protocol === 'rdp') {
            connectionParams['ignore-cert'] = 'true';
            connectionParams['security'] = 'any';

            // Dynamic resolution (like Windows Admin Center)
            connectionParams['resize-method'] = 'display-update';

            // Clipboard support
            connectionParams['enable-clipboard'] = 'true';
            connectionParams['disable-copy'] = 'false';
            connectionParams['disable-paste'] = 'false';

            // Better color depth and quality
            connectionParams['color-depth'] = '32';

            // Enable audio (optional)
            connectionParams['enable-audio'] = 'true';
            connectionParams['enable-audio-input'] = 'true';

            // Enable printing (optional)
            connectionParams['enable-printing'] = 'true';

            // Enable drive sharing (optional)
            connectionParams['enable-drive'] = 'true';
            connectionParams['drive-name'] = 'Shared';
            connectionParams['drive-path'] = '/tmp/guac-drive';
            connectionParams['create-drive-path'] = 'true';
        } else if (protocol === 'vnc') {
            // VNC clipboard
            connectionParams['enable-clipboard'] = 'true';
        } else if (protocol === 'ssh') {
            // SSH specific
            connectionParams['color-scheme'] = 'white-black';
            connectionParams['font-size'] = '12';
        }

        // Create JSON payload for Guacamole
        const connectionName = `${protocol.toUpperCase()}-${host}`;
        const expiresAt = Date.now() + (30 * 60 * 1000); // 30 minutes expiry

        const payload = {
            username: 'guac_user',
            expires: expiresAt,
            connections: {
                [connectionName]: {
                    protocol: protocol,
                    parameters: connectionParams
                }
            }
        };

        const jsonPayload = JSON.stringify(payload);

        // Encrypt the payload
        const encryptedData = createEncryptedPayload(jsonPayload, secretKey);

        // POST to Guacamole /api/tokens
        const tokenUrl = `${guacamoleUrl}/guacamole/api/tokens`;
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `data=${encodeURIComponent(encryptedData)}`
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('Guacamole token error:', errorText);
            return NextResponse.json(
                { error: 'Failed to authenticate with Guacamole. Check server configuration.' },
                { status: 502 }
            );
        }

        const tokenData = await tokenResponse.json();
        const authToken = tokenData.authToken;

        if (!authToken) {
            return NextResponse.json(
                { error: 'No auth token received from Guacamole' },
                { status: 502 }
            );
        }

        // Build the connection URL (using direct Guacamole URL - proxy doesn't work with hash routing)
        const connectionId = Buffer.from(`${connectionName}\0c\0json`).toString('base64');
        const consoleUrl = `${guacamoleUrl}/guacamole/#/client/${connectionId}?token=${authToken}`;

        // Generate session ID and store the URL server-side
        cleanupSessions();
        const sessionId = crypto.randomBytes(32).toString('hex');
        sessionStore.set(sessionId, {
            url: consoleUrl,
            expiresAt: Date.now() + (30 * 60 * 1000) // 30 minutes to match Guacamole token
        });

        // Return only the session ID, not the actual URL
        return NextResponse.json({ sessionId });

    } catch (error) {
        console.error('Guacamole connect error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// Export session store for use by other routes
export { sessionStore };
