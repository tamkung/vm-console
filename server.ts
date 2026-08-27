import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import http from 'http';
import https from 'https';
import { WebSocketServer } from 'ws';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { shareStore } from './lib/store';
import { handleGuacdConnection } from './lib/guacd-tunnel';
import { handleSSHConnection } from './lib/ssh-tunnel';

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== 'production';
const server = createServer();
const app = next({ dev, httpServer: server });
const handle = app.getRequestHandler();

// Allow self-signed certs for the proxy
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Configure Keep-Alive agents for stabilized proxy connections
const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: 10000, // Send TCP Keep-Alive every 10s
    maxSockets: 256,
    maxFreeSockets: 256,
    timeout: 60000,
};

const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

const getAgent = (url: string | undefined) => {
    return url?.startsWith('https') ? httpsAgent : httpAgent;
};

app.prepare().then(() => {
    const mainAppPort = Number(process.env.PORT || 3000);

    const getCookieValue = (cookieHeader: string, name: string) => {
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
    };

    const resolveProxyTarget = (req: { headers?: { cookie?: string } }) => {
        const cookieHeader = req.headers?.cookie || '';
        const customHost = getCookieValue(cookieHeader, 'PROXMOX_HOST');
        return customHost || process.env.PROXMOX_URL;
    };

    // Proxmox Proxy Configuration for VNC / API
    const proxy = createProxyMiddleware({
        target: process.env.PROXMOX_URL,
        changeOrigin: true,
        ws: true,
        secure: false,
        xfwd: true,
        agent: getAgent(process.env.PROXMOX_URL),
        proxyTimeout: 300000, // 5 minutes
        timeout: 300000,
        pathRewrite: {
            '^/api/proxy': '', // Remove /api/proxy prefix
        },
        router: (req: any) => {
            return resolveProxyTarget(req);
        },
        on: {
            proxyReqWs: (proxyReq: any, req: any, socket: any, options: any) => {
                const targetUrl = resolveProxyTarget(req) || options.target;
                if (targetUrl) {
                    proxyReq.setHeader('Origin', targetUrl.toString().replace(/\/$/, ''));
                }

                const cookieHeader = req.headers?.cookie || '';
                const pveAuthCookie = getCookieValue(cookieHeader, 'PVEAuthCookie');
                if (pveAuthCookie) {
                    proxyReq.setHeader('Cookie', `PVEAuthCookie=${encodeURIComponent(pveAuthCookie)}`);
                }

                proxyReq.removeHeader('Sec-WebSocket-Extensions');

                console.log('WebSocket Connection Attempt:', req.url, {
                    target: targetUrl,
                    hasAuthCookie: Boolean(pveAuthCookie),
                });
            },
            error: (err: any, req: any) => {
                console.error(`[Proxmox Proxy Error] ${req.url}:`, err.message || err);
            }
        }
    } as any);

    // Native Guacamole WebSocket Server (/ws/guacd)
    const guacWss = new WebSocketServer({
        noServer: true,
        handleProtocols: (protocols) => {
            // guacamole-common-js requests 'guacamole' subprotocol
            if (protocols.has('guacamole')) {
                return 'guacamole';
            }
            return false;
        }
    });

    guacWss.on('connection', (ws, req) => {
        handleGuacdConnection(ws, req);
    });

    // Native SSH + SFTP WebSocket Server (/ws/ssh)
    const sshWss = new WebSocketServer({ noServer: true });
    sshWss.on('connection', (ws, req) => {
        handleSSHConnection(ws, req);
    });

    server.on('request', (req, res) => {
        const parsedUrl = parse(req.url!, true);
        const { pathname } = parsedUrl;

        // Custom API / Tunnel routes
        if (pathname === '/api/tunnel' || pathname === '/api/guacamole/tunnel') {
            res.writeHead(501, { 'Content-Type': 'text/plain' });
            res.end('HTTP tunnel endpoint is disabled. Use direct WebSocket connection to /ws/guacd.');
            return;
        }

        // Forward normal API / Proxmox calls
        if (pathname?.startsWith('/api/proxy')) {
            const target = resolveProxyTarget(req);
            (proxy as any)(req, res, (err: any) => {
                if (err) {
                    console.error('[Proxy Error]:', err);
                    if (!res.headersSent) {
                        res.writeHead(502, { 'Content-Type': 'text/plain' });
                        res.end('Bad gateway');
                    }
                }
            });
            return;
        }

        // Let Next.js handle all other requests
        handle(req, res, parsedUrl);
    });

    const upgradeHandler = (app as any).getUpgradeHandler ? (app as any).getUpgradeHandler() : null;

    // Handle WebSocket Upgrades
    server.on('upgrade', (req, socket, head) => {
        const parsedUrl = parse(req.url!, true);
        const pathname = parsedUrl.pathname || '';

        if (pathname === '/ws/guacd' || pathname.startsWith('/ws/guacd')) {
            guacWss.handleUpgrade(req, socket, head, (ws) => {
                guacWss.emit('connection', ws, req);
            });
            return;
        }

        if (pathname === '/ws/ssh' || pathname.startsWith('/ws/ssh')) {
            sshWss.handleUpgrade(req, socket, head, (ws) => {
                sshWss.emit('connection', ws, req);
            });
            return;
        }

        if (pathname.startsWith('/api/proxy')) {
            req.url = req.url!.replace(/^\/api\/proxy/, '');
            console.log('Proxying WebSocket (rewritten):', req.url);

            socket.on('error', (err: any) => {
                console.error('WebSocket socket error:', err.message);
            });

            // @ts-expect-error - http-proxy-middleware types
            proxy.upgrade(req, socket, head);
            return;
        }

        // Allow Next.js to handle internal WebSockets (e.g. HMR /_next/hmr)
        if (upgradeHandler) {
            upgradeHandler(req, socket, head);
            return;
        }

        socket.destroy();
    });

    server.listen(mainAppPort, () => {
        console.log(`> Ready on http://localhost:${mainAppPort}`);
        console.log(`> Proxmox WebSocket Proxy ready on /api/proxy`);
        console.log(`> Native Guacamole RDP WebSocket ready on /ws/guacd`);

        // Auto-cleanup expired shares every 5 minutes
        setInterval(() => {
            shareStore.cleanup();
        }, 5 * 60 * 1000);
        shareStore.cleanup(); // Run on startup
        console.log('> Share auto-cleanup enabled (every 5 min)');
    });
});
