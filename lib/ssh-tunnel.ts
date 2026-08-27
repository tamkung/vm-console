import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { parse } from 'url';
import crypto from 'crypto';
import { Client as SSHClient, SFTPWrapper } from 'ssh2';
import { decryptPayload, encryptPayload } from './crypto';
import { Writable } from 'stream';

// Track consumed tokens to enforce single-use tickets (One-Time Tokens)
const usedSSHTokens = new Map<string, number>();

setInterval(() => {
    const now = Date.now();
    for (const [key, expiry] of usedSSHTokens.entries()) {
        if (now > expiry) {
            usedSSHTokens.delete(key);
        }
    }
}, 60 * 1000);

export function handleSSHConnection(ws: WebSocket, req: IncomingMessage) {
    const parsedUrl = parse(req.url || '', true);
    const token = (parsedUrl.query?.token as string) || '';

    if (!token) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing session token' }));
        ws.close(1008, 'Missing token');
        return;
    }

    // 1. One-Time Token Verification & Burning
    const tokenFingerprint = crypto.createHash('sha256').update(token).digest('hex');
    if (usedSSHTokens.has(tokenFingerprint)) {
        console.warn('[ssh-tunnel] Rejected replayed/already used session token');
        ws.send(JSON.stringify({ type: 'error', message: 'Session token has already been used. Please reconnect from dashboard.' }));
        ws.close(1008, 'Token already consumed');
        return;
    }

    let host = '';
    let port = 22;
    let username = '';
    let password = '';
    let vmName = 'SSH Console';

    try {
        const payload = decryptPayload(token);
        if (payload.url) host = payload.url;
        if (payload.port) port = Number(payload.port || 22);
        if (payload.user) username = payload.user;
        if (payload.password) password = payload.password;
        if (payload.vmName) vmName = payload.vmName;

        // Mark token as consumed
        const expiryTime = (payload.exp ? payload.exp * 1000 : Date.now() + 60000) + 60000;
        usedSSHTokens.set(tokenFingerprint, expiryTime);
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid or expired session token';
        console.error('[ssh-tunnel] Failed to decrypt/validate token:', errorMsg);
        ws.send(JSON.stringify({ type: 'error', message: errorMsg }));
        ws.close(1008, errorMsg);
        return;
    }

    if (!host || !username) {
        console.error('[ssh-tunnel] Missing target host or username');
        ws.send(JSON.stringify({ type: 'error', message: 'Missing target host or username' }));
        ws.close(1008, 'Invalid payload');
        return;
    }

    console.log(`[ssh-tunnel] Connecting to ${username}@${host}:${port}...`);

    const sshClient = new SSHClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let shellStream: any = null;
    let sftpClient: SFTPWrapper | null = null;
    let isConnected = false;

    // Active upload write streams
    const activeUploads = new Map<string, { stream: Writable; path: string }>();

    const cleanup = () => {
        for (const [, upload] of activeUploads) {
            try {
                upload.stream.destroy();
            } catch {
                // ignore
            }
        }
        activeUploads.clear();

        if (shellStream) {
            try {
                shellStream.end();
            } catch {
                // ignore
            }
            shellStream = null;
        }

        if (sftpClient) {
            try {
                sftpClient.end();
            } catch {
                // ignore
            }
            sftpClient = null;
        }

        try {
            sshClient.end();
        } catch {
            // ignore
        }
    };

    ws.on('close', () => {
        console.log(`[ssh-tunnel] WebSocket client disconnected from ${username}@${host}:${port}`);
        cleanup();
    });

    ws.on('error', (err) => {
        console.error(`[ssh-tunnel] WebSocket error:`, err.message);
        cleanup();
    });

    sshClient.on('ready', () => {
        isConnected = true;
        console.log(`[ssh-tunnel] SSH connection established to ${username}@${host}:${port}`);

        // Issue fresh one-time token for Reconnect capability
        try {
            const freshToken = encryptPayload({
                url: host,
                port: String(port),
                user: username,
                password: password,
                vmName: vmName,
                consoleType: 'ssh',
            });
            ws.send(JSON.stringify({ type: 'reconnect_token', token: freshToken }));
        } catch (err) {
            console.warn('[ssh-tunnel] Failed to generate rotating reconnect token:', err);
        }

        // 1. Open Interactive Shell (PTY)
        sshClient.shell(
            {
                term: 'xterm-256color',
                cols: 80,
                rows: 24,
            },
            (err, stream) => {
                if (err) {
                    console.error('[ssh-tunnel] Failed to open shell:', err.message);
                    ws.send(JSON.stringify({ type: 'error', message: `Failed to open shell: ${err.message}` }));
                    cleanup();
                    return;
                }

                shellStream = stream;

                // Notify frontend that terminal is ready
                ws.send(JSON.stringify({ type: 'ready' }));

                stream.on('data', (data: Buffer) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') }));
                    }
                });

                stream.on('close', () => {
                    console.log('[ssh-tunnel] SSH shell closed');
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'disconnected', reason: 'SSH session ended' }));
                        ws.close(1000, 'SSH session ended');
                    }
                    cleanup();
                });

                stream.stderr.on('data', (data: Buffer) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') }));
                    }
                });
            }
        );

        // 2. Open SFTP Subsystem
        sshClient.sftp((err, sftp) => {
            if (err) {
                console.warn('[ssh-tunnel] SFTP subsystem not available or failed:', err.message);
                return;
            }
            sftpClient = sftp;
            console.log('[ssh-tunnel] SFTP subsystem attached successfully');
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'sftp_ready' }));
            }
        });
    });

    sshClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        if (prompts.length > 0 && password) {
            finish([password]);
        } else {
            finish([]);
        }
    });

    sshClient.on('error', (err: any) => {
        console.error(`[ssh-tunnel] SSH client error for ${username}@${host}:`, err.message || err);
        if (ws.readyState === WebSocket.OPEN) {
            const msg = err.level === 'client-authentication' 
                ? 'SSH Authentication failed. Please check username & password.' 
                : (err.message || 'SSH authentication failed or host unreachable');
            ws.send(JSON.stringify({ type: 'error', message: msg }));
            ws.close(1008, msg);
        }
        cleanup();
    });

    sshClient.on('close', () => {
        if (isConnected) {
            console.log(`[ssh-tunnel] SSH connection closed for ${username}@${host}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'disconnected', reason: 'Remote host closed connection' }));
                ws.close(1000, 'SSH closed');
            }
        }
        cleanup();
    });

    // Handle incoming messages from Frontend xterm.js & SFTP UI
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            // 1. Terminal Data Input
            if (msg.type === 'data' && shellStream) {
                shellStream.write(msg.data);
            }

            // 2. Terminal Resize
            else if (msg.type === 'resize' && shellStream) {
                const cols = Number(msg.cols || 80);
                const rows = Number(msg.rows || 24);
                shellStream.setWindow(rows, cols, 0, 0);
            }

            // 3. SFTP: List directory
            else if (msg.type === 'sftp_list') {
                const reqId = msg.id;
                const targetPath = msg.path || '/';

                if (!sftpClient) {
                    ws.send(JSON.stringify({ type: 'sftp_list_res', id: reqId, error: 'SFTP not available' }));
                    return;
                }

                sftpClient.readdir(targetPath, (err, list) => {
                    if (err) {
                        ws.send(JSON.stringify({ type: 'sftp_list_res', id: reqId, error: err.message, path: targetPath }));
                        return;
                    }

                    const files = list.map((item) => {
                        const isDir = (item.attrs.mode & 0o40000) !== 0;
                        const fullItemPath = targetPath === '/' ? `/${item.filename}` : `${targetPath.replace(/\/$/, '')}/${item.filename}`;
                        return {
                            name: item.filename,
                            path: fullItemPath,
                            isDirectory: isDir,
                            size: item.attrs.size,
                            modifyTime: item.attrs.mtime,
                        };
                    });

                    ws.send(JSON.stringify({ type: 'sftp_list_res', id: reqId, path: targetPath, files }));
                });
            }

            // 4. SFTP: Read file / Download
            else if (msg.type === 'sftp_read') {
                const reqId = msg.id;
                const filePath = msg.path;

                if (!sftpClient) {
                    ws.send(JSON.stringify({ type: 'sftp_read_res', id: reqId, error: 'SFTP not available' }));
                    return;
                }

                const readStream = sftpClient.createReadStream(filePath);

                readStream.on('data', (chunk: Buffer) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'sftp_read_chunk',
                            id: reqId,
                            data: chunk.toString('base64'),
                            done: false,
                        }));
                    }
                });

                readStream.on('end', () => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'sftp_read_chunk', id: reqId, done: true }));
                    }
                });

                readStream.on('error', (err: Error) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'sftp_read_res', id: reqId, error: err.message }));
                    }
                });
            }

            // 5. SFTP: Start Upload Write Stream
            else if (msg.type === 'sftp_write_start') {
                const reqId = msg.id;
                const targetFilePath = msg.path;

                if (!sftpClient) {
                    ws.send(JSON.stringify({ type: 'sftp_write_res', id: reqId, error: 'SFTP not available' }));
                    return;
                }

                const writeStream = sftpClient.createWriteStream(targetFilePath, {
                    flags: 'w',
                    mode: 0o644,
                });

                activeUploads.set(reqId, { stream: writeStream, path: targetFilePath });

                let isDone = false;
                const onComplete = () => {
                    if (isDone) return;
                    isDone = true;
                    activeUploads.delete(reqId);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'sftp_write_res', id: reqId, success: true }));
                    }
                };

                writeStream.on('error', (err: Error) => {
                    console.error('[ssh-tunnel] SFTP write stream error:', err.message);
                    activeUploads.delete(reqId);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'sftp_write_res', id: reqId, error: err.message }));
                    }
                });

                writeStream.on('finish', onComplete);
                writeStream.on('close', onComplete);
            }

            // 6. SFTP: Write chunk to stream
            else if (msg.type === 'sftp_write_chunk') {
                const reqId = msg.id;
                const upload = activeUploads.get(reqId);
                if (upload && msg.data) {
                    const buffer = Buffer.from(msg.data, 'base64');
                    upload.stream.write(buffer);
                }
            }

            // 7. SFTP: End upload stream
            else if (msg.type === 'sftp_write_end') {
                const reqId = msg.id;
                const upload = activeUploads.get(reqId);
                if (upload) {
                    upload.stream.end();
                }
            }

            // 8. SFTP: Abort upload stream
            else if (msg.type === 'sftp_write_abort') {
                const reqId = msg.id;
                const upload = activeUploads.get(reqId);
                if (upload) {
                    upload.stream.destroy();
                    activeUploads.delete(reqId);
                }
            }
        } catch (err) {
            console.error('[ssh-tunnel] Error parsing message from frontend:', err);
        }
    });

    // Connect to SSH Server
    try {
        sshClient.connect({
            host,
            port,
            username,
            password,
            readyTimeout: 20000,
            keepaliveInterval: 10000,
            keepaliveCountMax: 3,
            tryKeyboard: true,
        });
    } catch (err) {
        console.error('[ssh-tunnel] Failed to initiate SSH connection:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to initiate connection' }));
        ws.close(1008, 'Connection failed');
    }
}
