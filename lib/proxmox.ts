export interface ProxmoxTicketResponse {
    data: {
        ticket: string;
        CSRFPreventionToken: string;
        username: string;
        cap: Record<string, number>;
    };
}

export interface ProxmoxVm {
    vmid: number;
    name: string;
    status: 'running' | 'stopped' | 'paused';
    cpus: number;
    lock?: string;
    maxdisk: number;
    maxmem: number;
    node: string;
    uptime: number;
    netout: number;
    diskread: number;
    diskwrite: number;
    netin: number;
    mem: number;
    cpu: number;
}

export interface ProxmoxNodeListResponse {
    data: {
        node: string;
        status: string;
        cpu: number;
        level: string;
        maxcpu: number;
        maxmem: number;
        mem: number;
        ssl_fingerprint: string;
        uptime: number;
        id: string;
        type: string;
    }[];
}

export interface ProxmoxVmListResponse {
    data: ProxmoxVm[];
}

export interface VncProxyResponse {
    data: {
        ticket: string;
        port: string;
        upi: string;
        cert: string;
        user: string;
    };
}

export class ProxmoxClient {
    private fileUrl: string;

    constructor(url: string) {
        this.fileUrl = url.replace(/\/$/, '');
    }

    private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.fileUrl}${path}`;
        // Handle self-signed certs in development


        // Note: In Next.js edge runtime or standard fetch, 'agent' isn't directly supported in the same way as node-fetch
        // But for Node.js runtime (default for API routes), we might need a custom agent if we want to ignore SSL errors.
        // simpler approach for MVP: Assume user configures NODE_TLS_REJECT_UNAUTHORIZED=0 in env if needed,
        // OR use a specific dispatcher if using undici (Next.js 13+ default).

        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...options.headers,
            },
        });

        if (!res.ok) {
            let errorMessage = `Proxmox API error: ${res.status} ${res.statusText}`;
            try {
                const text = await res.text();
                // Check if response is likely HTML
                if (text.trim().startsWith('<')) {
                    errorMessage += ' (HTML Response)';
                } else if (text.length > 200) {
                    errorMessage += ` - ${text.substring(0, 200)}...`;
                } else {
                    errorMessage += ` - ${text}`;
                }
            } catch (e) {
                // Ignore body read error
            }
            throw new Error(errorMessage);
        }

        return res.json() as Promise<T>;
    }

    async login(username: string, password: string, realm: string = 'pam'): Promise<ProxmoxTicketResponse> {
        const params = new URLSearchParams();
        params.append('username', `${username}@${realm}`);
        params.append('password', password);

        return this.fetch<ProxmoxTicketResponse>('/api2/json/access/ticket', {
            method: 'POST',
            body: params,
        });
    }

    async getNodes(ticket: string): Promise<string[]> {
        const res = await this.fetch<ProxmoxNodeListResponse>('/api2/json/nodes', {
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
            }
        });
        return res.data.map(n => n.node);
    }

    async getVms(node: string, ticket: string): Promise<ProxmoxVm[]> {
        const res = await this.fetch<ProxmoxVmListResponse>(`/api2/json/nodes/${node}/qemu`, {
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
            },
        });
        return res.data.map(vm => ({ ...vm, node }));
    }

    async getVncProxy(node: string, vmid: number, ticket: string, csrfToken: string): Promise<VncProxyResponse> {
        const params = new URLSearchParams();
        params.append('websocket', '1');

        return this.fetch<VncProxyResponse>(`/api2/json/nodes/${node}/qemu/${vmid}/vncproxy`, {
            method: 'POST',
            body: params,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
    }

    async vmStatus(node: string, vmid: number, action: 'start' | 'stop' | 'reset' | 'shutdown' | 'suspend' | 'resume' | 'reboot', ticket: string, csrfToken: string): Promise<string> {
        const params = new URLSearchParams();

        return this.fetch<string>(`/api2/json/nodes/${node}/qemu/${vmid}/status/${action}`, {
            method: 'POST',
            body: params,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
    }
}
