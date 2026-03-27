import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { shareStore } from './lib/store';
import { getGuacamoleServerBaseUrl, GUACAMOLE_PROXY_PREFIX } from './lib/guacamole';
// import jwt from 'jsonwebtoken';

const dev = process.env.NODE_ENV !== 'production';
const server = createServer();
const app = next({ dev, httpServer: server });
const handle = app.getRequestHandler();

// Allow self-signed certs for the proxy
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

app.prepare().then(() => {
    const guacProxyPort = Number(process.env.GUACAMOLE_PROXY_PORT || 3001);
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

    const guacamoleProxy = createProxyMiddleware({
        target: getGuacamoleServerBaseUrl(process.env.GUACAMOLE_URL),
        changeOrigin: true,
        ws: true,
        secure: false,
        pathRewrite: (path: string) => path.replace(new RegExp(`^${GUACAMOLE_PROXY_PREFIX}`), '/guacamole'),
        onError: (err: any) => {
            console.error('Guacamole Proxy Error:', err);
        }
    } as any);

    server.on('request', (req, res) => {
        const parsedUrl = parse(req.url!, true);

        if (parsedUrl.pathname?.startsWith(GUACAMOLE_PROXY_PREFIX)) {
            guacamoleProxy(req, res, (err: unknown) => {
                if (err) {
                    console.error('Guacamole proxy request failed:', err);
                    if (!res.headersSent) {
                        res.statusCode = 502;
                        res.end('Bad gateway');
                    }
                }
            });
            return;
        }

        if (parsedUrl.pathname?.startsWith('/api/proxy')) {
            // @ts-ignore
            proxy(req, res, (err: unknown) => {
                if (err) {
                    console.error('Proxmox proxy request failed:', err);
                    if (!res.headersSent) {
                        res.statusCode = 502;
                        res.end('Bad gateway');
                    }
                }
            });
            return;
        }

        // Let Next.js handle all other requests
        handle(req, res, parsedUrl);
    });

    // Proxy Configuration
    const proxy = createProxyMiddleware({
        target: process.env.PROXMOX_URL,
        changeOrigin: true,
        ws: true,
        secure: false, // Ignore self-signed certs
        xfwd: true,   // Add x-forwarded-for headers
        proxyTimeout: 0, // Disable timeout to prevent frequent disconnects
        timeout: 0,
        pathRewrite: {
            '^/api/proxy': '', // Remove /api/proxy prefix
        },
        router: (req: any) => {
            return resolveProxyTarget(req);
        },
        onProxyReqWs: (proxyReq: any, req: any, socket: any, options: any, head: any) => {
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
        onError: (err: any, req: any, res: any) => {
            console.error('Proxy Error:', err);
        }
    } as any);

    const guacServer = createServer((req, res) => {
        const parsedUrl = parse(req.url!, true);
        const pathname = parsedUrl.pathname || '';

        if (pathname.startsWith(GUACAMOLE_PROXY_PREFIX)) {
            guacamoleProxy(req, res, (err: unknown) => {
                if (err) {
                    console.error('Isolated Guacamole proxy request failed:', err);
                    if (!res.headersSent) {
                        res.statusCode = 502;
                        res.end('Bad gateway');
                    }
                }
            });
            return;
        }

        const isGuacPage =
            pathname === '/console/guac' ||
            pathname.startsWith('/api/guacamole/session') ||
            pathname.startsWith('/_next/') ||
            pathname === '/favicon.ico';

        if (isGuacPage) {
            handle(req, res, parsedUrl);
            return;
        }

        const hostHeader = req.headers.host || `localhost:${guacProxyPort}`;
        const hostname = hostHeader.split(':')[0];
        res.statusCode = 302;
        res.setHeader('Location', `http://${hostname}:${mainAppPort}/dashboard`);
        res.end();
    });

    // Manually upgrade the WebSocket connection
    server.on('upgrade', (req, socket, head) => {
        const parsedUrl = parse(req.url!, true);

        if (parsedUrl.pathname?.startsWith('/api/proxy')) {
            console.log('Proxying WebSocket:', req.url);
            // @ts-expect-error - http-proxy-middleware types are a bit tricky with 'upgrade'
            proxy.upgrade(req, socket, head);
        } else {
            // socket.destroy();
        }
    });

    guacServer.on('upgrade', (req, socket, head) => {
        const parsedUrl = parse(req.url!, true);

        if (parsedUrl.pathname?.startsWith(GUACAMOLE_PROXY_PREFIX)) {
            console.log('Proxying Guacamole WebSocket:', req.url);
            // @ts-expect-error - http-proxy-middleware types are a bit tricky with 'upgrade'
            guacamoleProxy.upgrade(req, socket, head);
        } else {
            socket.destroy();
        }
    });

    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`> Ready on http://localhost:${port}`);
        console.log(`> WebSocket Proxy ready on /api/proxy`);
        console.log(`> Main app excludes Guacamole proxy traffic`);
        console.log(`> Guacamole Proxy ready on http://localhost:${guacProxyPort}${GUACAMOLE_PROXY_PREFIX}`);

        // Auto-cleanup expired shares every 5 minutes
        setInterval(() => {
            shareStore.cleanup();
        }, 5 * 60 * 1000);
        shareStore.cleanup(); // Run on startup
        console.log('> Share auto-cleanup enabled (every 5 min)');
    });

    guacServer.listen(guacProxyPort, () => {
        console.log(`> Isolated Guacamole server listening on http://localhost:${guacProxyPort}`);
    });
});
