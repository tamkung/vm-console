import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { shareStore } from './lib/store';
// import jwt from 'jsonwebtoken';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Allow self-signed certs for the proxy
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

app.prepare().then(() => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url!, true);

        // Let Next.js handle all other requests
        handle(req, res, parsedUrl);
    });

    // Proxy Configuration
    const proxy = createProxyMiddleware({
        target: process.env.PROXMOX_URL,
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
        secure: false, // Ignore self-signed certs
        pathRewrite: {
            '^/api/proxy': '', // Remove /api/proxy prefix
        },
        router: (req: any) => {
            // Dynamically resolve target from PROXMOX_HOST cookie (set when using custom host)
            const cookieHeader = req.headers?.cookie || '';
            const match = cookieHeader.match(/(?:^|;\s*)PROXMOX_HOST=([^;]*)/);
            const customHost = match ? decodeURIComponent(match[1]) : null;
            const target = customHost || process.env.PROXMOX_URL;
            console.log('Proxy target resolved to:', target);
            return target;
        },
        onProxyReqWs: (proxyReq: any, req: any, socket: any, options: any, head: any) => {
            console.log('WebSocket Connection Attempt:', req.url);
        },
        onError: (err: any, req: any, res: any) => {
            console.error('Proxy Error:', err);
        }
    } as any);

    // Manually upgrade the WebSocket connection
    server.on('upgrade', (req, socket, head) => {
        const parsedUrl = parse(req.url!, true);

        if (parsedUrl.pathname?.startsWith('/api/proxy')) {
            console.log('Proxying WebSocket:', req.url);
            // @ts-ignore - http-proxy-middleware types are a bit tricky with 'upgrade'
            proxy.upgrade(req, socket, head);
        } else {
            // socket.destroy();
        }
    });

    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`> Ready on http://localhost:${port}`);
        console.log(`> WebSocket Proxy ready on /api/proxy`);

        // Auto-cleanup expired shares every 5 minutes
        setInterval(() => {
            shareStore.cleanup();
        }, 5 * 60 * 1000);
        shareStore.cleanup(); // Run on startup
        console.log('> Share auto-cleanup enabled (every 5 min)');
    });
});
