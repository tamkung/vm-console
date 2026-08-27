import net from 'net';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { parse } from 'url';
import { Buffer } from 'buffer';
import crypto from 'crypto';
import { decryptPayload, encryptPayload } from './crypto';

// Track consumed tokens to enforce single-use tickets (One-Time Tokens)
const usedTokens = new Map<string, number>();

// Clean up expired tokens every minute
setInterval(() => {
    const now = Date.now();
    for (const [key, expiry] of usedTokens.entries()) {
        if (now > expiry) {
            usedTokens.delete(key);
        }
    }
}, 60 * 1000);

// Helper to calculate Unicode code point length for Guacamole instruction elements
function getRuneLength(str: string): number {
    return Array.from(str).length;
}

export function buildGuacInstruction(opcode: string, ...args: string[]): string {
    const parts = [opcode, ...args];
    return parts.map(p => `${getRuneLength(p)}.${p}`).join(',') + ';';
}

/**
 * Guacamole stream framer to buffer TCP stream until full instruction(s) ending with ';' are available
 */
export class GuacStreamFramer {
    private buffer: Buffer = Buffer.alloc(0);

    public feed(chunk: Buffer): Buffer[] {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const completeInstructions: Buffer[] = [];

        let offset = 0;
        let instructionStart = 0;

        while (offset < this.buffer.length) {
            // Read length prefix
            let dotIndex = -1;
            for (let i = offset; i < this.buffer.length; i++) {
                if (this.buffer[i] === 0x2e /* '.' */) {
                    dotIndex = i;
                    break;
                }
                // If not a digit, something is wrong
                if (this.buffer[i] < 0x30 || this.buffer[i] > 0x39) {
                    break;
                }
            }

            if (dotIndex === -1) {
                break; // Incomplete length
            }

            const lenStr = this.buffer.toString('utf8', offset, dotIndex);
            const elementLen = parseInt(lenStr, 10);
            if (isNaN(elementLen)) {
                break;
            }

            // Guacamole lengths are in UTF-8 code points (characters).
            // Scan forward elementLen characters
            let charCount = 0;
            const valOffset = dotIndex + 1;
            let endValOffset = valOffset;

            while (endValOffset < this.buffer.length && charCount < elementLen) {
                const b = this.buffer[endValOffset];
                // Check UTF-8 byte boundary
                if ((b & 0xc0) !== 0x80) {
                    charCount++;
                }
                endValOffset++;
            }

            if (charCount < elementLen || endValOffset >= this.buffer.length) {
                break; // Incomplete element value or delimiter
            }

            const delimiter = this.buffer[endValOffset];
            if (delimiter === 0x3b /* ';' */) {
                // End of full instruction
                offset = endValOffset + 1;
                completeInstructions.push(this.buffer.subarray(instructionStart, offset));
                instructionStart = offset;
            } else if (delimiter === 0x2c /* ',' */) {
                // Next element
                offset = endValOffset + 1;
            } else {
                // Protocol parse error, advance 1 byte
                offset++;
                instructionStart = offset;
            }
        }

        if (instructionStart > 0) {
            this.buffer = this.buffer.subarray(instructionStart);
        }

        return completeInstructions;
    }
}

/**
 * Checks if client instruction is a Guacamole tunnel ping (e.g. `0.,4.ping,timestamp;` or `4.ping,timestamp;`)
 */
function isTunnelPing(str: string): boolean {
    return str.includes('ping');
}

/**
 * Asynchronously read a single complete Guacamole instruction from a TCP socket
 */
function readNextInstruction(socket: net.Socket, timeoutMs = 8000): Promise<{ opcode: string; args: string[]; remainingBuffer: Buffer }> {
    return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);

        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout reading instruction from guacd'));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timeout);
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('close', onClose);
        };

        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };

        const onClose = () => {
            cleanup();
            reject(new Error('Socket closed while waiting for instruction'));
        };

        const onData = (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            const str = buffer.toString('utf8');
            const semiIndex = str.indexOf(';');
            if (semiIndex !== -1) {
                cleanup();
                const instructionStr = str.substring(0, semiIndex);
                const remaining = buffer.subarray(Buffer.byteLength(str.substring(0, semiIndex + 1), 'utf8'));

                // Parse instruction elements
                const elements: string[] = [];
                let idx = 0;
                while (idx < instructionStr.length) {
                    const dot = instructionStr.indexOf('.', idx);
                    if (dot === -1) break;
                    const len = parseInt(instructionStr.substring(idx, dot), 10);
                    if (isNaN(len)) break;
                    const rest = instructionStr.substring(dot + 1);
                    const chars = Array.from(rest);
                    const val = chars.slice(0, len).join('');
                    elements.push(val);
                    idx = dot + 1 + val.length + 1;
                }

                if (elements.length > 0) {
                    resolve({ opcode: elements[0], args: elements.slice(1), remainingBuffer: remaining });
                } else {
                    resolve({ opcode: '', args: [], remainingBuffer: remaining });
                }
            }
        };

        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
    });
}

/**
 * Handles incoming WebSocket connection for /ws/guacd
 */
export async function handleGuacdConnection(ws: WebSocket, req: IncomingMessage) {
    const parsedUrl = parse(req.url || '', true);
    const query = parsedUrl.query;

    let protocol = (query.protocol as string) || 'rdp';
    let hostname = (query.hostname as string) || '';
    let port = (query.port as string) || '';
    let username = (query.username as string) || '';
    let password = (query.password as string) || '';
    const width = (query.width as string) || '1920';
    const height = (query.height as string) || '1080';
    const dpi = (query.dpi as string) || '96';
    const token = (query.token as string) || '';

    if (token) {
        try {
            // Check if token has already been consumed (One-Time Token protection)
            const tokenFingerprint = crypto.createHash('sha256').update(token).digest('hex');
            if (usedTokens.has(tokenFingerprint)) {
                console.warn('[guacd-tunnel] Security alert: Rejected re-use of already consumed token');
                ws.send(buildGuacInstruction('error', 'Session token has already been used or expired. Please generate a new connection from the dashboard.', '519'));
                ws.close();
                return;
            }

            const payload = decryptPayload(token);
            if (payload.consoleType) protocol = payload.consoleType;
            if (payload.url) hostname = payload.url;
            if (payload.port) port = String(payload.port);
            if (payload.user) username = payload.user;
            if (payload.password) password = payload.password;

            // Mark token as consumed immediately
            const expiryTime = (payload.exp ? payload.exp * 1000 : Date.now() + 60000) + 60000;
            usedTokens.set(tokenFingerprint, expiryTime);
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : 'Invalid or expired session token';
            console.error('[guacd-tunnel] Failed to decrypt/validate token:', errorMsg);
            ws.send(buildGuacInstruction('error', errorMsg, '519'));
            ws.close();
            return;
        }
    }

    const proto = (protocol || 'rdp').toLowerCase();
    if (!port) {
        port = proto === 'ssh' ? '22' : proto === 'vnc' ? '5900' : '3389';
    }

    if (!hostname) {
        ws.send(buildGuacInstruction('error', 'Target hostname is missing', '519'));
        ws.close();
        return;
    }

    const guacdHost = process.env.GUACD_HOST || '127.0.0.1';
    const guacdPort = parseInt(process.env.GUACD_PORT || '4822', 10);

    console.log(`[guacd-tunnel] Connecting to guacd at ${guacdHost}:${guacdPort} for target ${proto.toUpperCase()} ${hostname}:${port} (user: ${username})...`);

    const tcpSocket = net.connect({ host: guacdHost, port: guacdPort });
    tcpSocket.setNoDelay(true);

    let isHandshakeComplete = false;

    const cleanup = () => {
        clearInterval(heartbeatTimer);
        tcpSocket.destroy();
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    };

    // Heartbeat ping every 20s
    const heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 20000);

    tcpSocket.on('error', (err) => {
        console.error(`[guacd-tunnel] TCP socket error with guacd:`, err.message);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(buildGuacInstruction('error', `Failed to connect to guacd daemon at ${guacdHost}:${guacdPort} (${err.message})`, '519'));
        }
        cleanup();
    });

    tcpSocket.on('close', () => {
        console.log(`[guacd-tunnel] TCP connection with guacd closed`);
        cleanup();
    });

    try {
        await new Promise<void>((resolve, reject) => {
            tcpSocket.once('connect', () => resolve());
            tcpSocket.once('error', (err) => reject(err));
        });

        // Step 1: Send select instruction with dynamic protocol (rdp, ssh, vnc)
        tcpSocket.write(buildGuacInstruction('select', proto));

        // Step 2: Read args instruction from guacd
        const { opcode: argsOp, args: argsNames } = await readNextInstruction(tcpSocket, 8000);
        if (argsOp !== 'args') {
            throw new Error(`Expected args from guacd, got opcode=${argsOp}`);
        }

        // Step 3: Send client capabilities (size, audio, video, image)
        tcpSocket.write(buildGuacInstruction('size', width, height, dpi));
        tcpSocket.write(buildGuacInstruction('audio'));
        tcpSocket.write(buildGuacInstruction('video'));
        tcpSocket.write(buildGuacInstruction('image', 'image/webp', 'image/jpeg', 'image/png'));

        // Step 4: Map connection arguments
        const sessionUUID = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const paramMap: Record<string, string> = {
            hostname,
            port,
            username,
            password,
            'disable-copy': 'false',
            'disable-paste': 'false'
        };

        if (proto === 'rdp') {
            Object.assign(paramMap, {
                security: 'any',
                'ignore-cert': 'true',
                'enable-wallpaper': 'false',
                'enable-theming': 'false',
                'enable-font-smoothing': 'false',
                'enable-full-window-drag': 'false',
                'enable-desktop-composition': 'false',
                'enable-menu-animations': 'false',
                'resize-method': 'display-update',
                'color-depth': '16',
                'server-layout': 'en-us-qwerty',
                'normalize-keyboard': 'true',
                'enable-audio': 'false',
                'enable-audio-input': 'false',
                'force-lossless': 'false',
                'enable-drive': 'true',
                'drive-path': `/tmp/guac-${sessionUUID}`,
                'create-drive-path': 'true',
                'drive-name': 'Shared Files'
            });
        } else if (proto === 'ssh') {
            Object.assign(paramMap, {
                'font-size': '14',
                'color-scheme': 'white-black',
                'server-layout': 'en-us-qwerty',
                'enable-sftp': 'true',
                'scrollback': '2000'
            });
        } else if (proto === 'vnc') {
            Object.assign(paramMap, {
                'server-layout': 'en-us-qwerty'
            });
        }

        const connectArgs = argsNames.map(name => paramMap[name] || '');
        tcpSocket.write(buildGuacInstruction('connect', ...connectArgs));

        // Step 5: Read ready instruction from guacd
        const { opcode: readyOp, args: readyArgs, remainingBuffer: readyRemaining } = await readNextInstruction(tcpSocket, 12000);
        if (readyOp !== 'ready') {
            const errorMsg = readyArgs[0] || 'RDP authentication failed or host unreachable';
            ws.send(buildGuacInstruction('error', errorMsg, '519'));
            cleanup();
            return;
        }

        isHandshakeComplete = true;

        // Step 6: Send tunnel initialization and ready instruction to WebSocket client
        ws.send(buildGuacInstruction('', sessionUUID));
        ws.send(buildGuacInstruction('ready', ...readyArgs));

        // Generate a fresh rotating reconnect token for this session (One-Time Token Rotation)
        const reconnectToken = encryptPayload({
            url: hostname,
            port: port,
            user: username,
            password: password,
            vmName: (query.title as string) || 'Remote Desktop',
            consoleType: proto,
            exp: Math.floor(Date.now() / 1000) + 7200,
        });
        ws.send(buildGuacInstruction('msg', '100', reconnectToken));

        console.log(`[guacd-tunnel] RDP session established for ${hostname}:${port} (session: ${sessionUUID})`);

        // Step 7: Stream framing from guacd TCP -> WebSocket
        const framer = new GuacStreamFramer();

        // Forward any frames received in the ready buffer (e.g. filesystem instruction)
        if (readyRemaining && readyRemaining.length > 0) {
            const initialFrames = framer.feed(readyRemaining);
            for (const frame of initialFrames) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(frame.toString('utf8'));
                }
            }
        }

        tcpSocket.on('data', (chunk) => {
            if (!isHandshakeComplete) return;
            const completeFrames = framer.feed(chunk);
            for (const frame of completeFrames) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(frame.toString('utf8'));
                }
            }
        });

        // Step 8: Stream from WebSocket -> guacd TCP
        ws.on('message', (data) => {
            const msgStr = data.toString();
            if (isTunnelPing(msgStr)) {
                // Echo tunnel ping back directly to client
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(msgStr);
                }
                return;
            }
            if (tcpSocket.writable) {
                tcpSocket.write(msgStr);
            }
        });

        ws.on('close', () => {
            console.log(`[guacd-tunnel] WebSocket client disconnected`);
            cleanup();
        });

        ws.on('error', (err) => {
            console.error(`[guacd-tunnel] WebSocket error:`, err.message);
            cleanup();
        });

    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[guacd-tunnel] Handshake failed:`, errorMsg);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(buildGuacInstruction('error', errorMsg || 'RDP Handshake failed', '519'));
        }
        cleanup();
    }
}
