export interface ProxmoxTicketResponse {
    data: {
        ticket: string;
        CSRFPreventionToken: string;
        username: string;
        cap: Record<string, number>;
    };
}

export interface ProxmoxLxc {
    vmid: number;
    name: string;
    status: 'running' | 'stopped' | 'paused';
    cpus: number;
    lock?: string;
    maxdisk: number;
    maxmem: number;
    maxswap: number;
    node: string;
    uptime: number;
    netout: number;
    diskread: number;
    diskwrite: number;
    netin: number;
    mem: number;
    swap: number;
    cpu: number;
    type?: 'lxc';
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
    type?: 'qemu';
    template?: number;
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

export interface ProxmoxLxcListResponse {
    data: ProxmoxLxc[];
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

        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...options.headers,
            },
        });

        if (!res.ok) {
            let errorMessage = `Proxmox Error (${res.status})`;
            try {
                const text = await res.text();
                if (text.trim().startsWith('<')) {
                    errorMessage += ': Unexpected HTML response';
                } else {
                    try {
                        const jsonObj = JSON.parse(text);
                        // If Proxmox sends a JSON error with a specific message
                        if (jsonObj && jsonObj.message) {
                            errorMessage += `: ${jsonObj.message.trim()}`;
                        } else {
                            errorMessage += `: ${text}`;
                        }
                    } catch (parseError) {
                        // Not JSON, fallback to raw text
                        if (text.length > 200) {
                            errorMessage += `: ${text.substring(0, 200)}...`;
                        } else {
                            errorMessage += `: ${text}`;
                        }
                    }
                }
            } catch (e) {
                // Request read failed
                errorMessage += `: ${res.statusText}`;
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

    async renewTicket(ticket: string): Promise<ProxmoxTicketResponse> {
        // Proxmox allows renewing a ticket by POSTing with the existing ticket as password
        return this.fetch<ProxmoxTicketResponse>('/api2/json/access/ticket', {
            method: 'POST',
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
            },
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
        return res.data.map(vm => ({ ...vm, node, type: 'qemu' }));
    }

    async getLxcs(node: string, ticket: string): Promise<ProxmoxLxc[]> {
        const res = await this.fetch<ProxmoxLxcListResponse>(`/api2/json/nodes/${node}/lxc`, {
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
            },
        });
        return res.data.map(lxc => ({ ...lxc, node, type: 'lxc' }));
    }

    async getVncProxy(node: string, vmid: number, ticket: string, csrfToken: string, type: 'qemu' | 'lxc' = 'qemu'): Promise<VncProxyResponse> {
        const params = new URLSearchParams();
        params.append('websocket', '1');

        return this.fetch<VncProxyResponse>(`/api2/json/nodes/${node}/${type}/${vmid}/vncproxy`, {
            method: 'POST',
            body: params,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
    }

    async getTermProxy(node: string, vmid: number, ticket: string, csrfToken: string, type: 'qemu' | 'lxc' = 'lxc'): Promise<VncProxyResponse> {
        const params = new URLSearchParams();

        return this.fetch<VncProxyResponse>(`/api2/json/nodes/${node}/${type}/${vmid}/termproxy`, {
            method: 'POST',
            body: params,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
    }

    async vmStatus(node: string, vmid: number, action: 'start' | 'stop' | 'reset' | 'shutdown' | 'suspend' | 'resume' | 'reboot', ticket: string, csrfToken: string, type: 'qemu' | 'lxc' = 'qemu'): Promise<string> {
        const params = new URLSearchParams();

        return this.fetch<string>(`/api2/json/nodes/${node}/${type}/${vmid}/status/${action}`, {
            method: 'POST',
            body: params,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
    }

    async getVmNetworkInfo(node: string, vmid: number, ticket: string, type: 'qemu' | 'lxc' = 'qemu'): Promise<string[]> {
        const ips: string[] = [];

        try {
            if (type === 'qemu') {
                // Use QEMU guest agent to get network info
                const res = await this.fetch<{ data: { result: Array<{ name: string; 'ip-addresses'?: Array<{ 'ip-address': string; 'ip-address-type': string }> }> } }>(
                    `/api2/json/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
                    {
                        headers: {
                            Cookie: `PVEAuthCookie=${ticket}`,
                        },
                    }
                );

                if (res.data?.result) {
                    for (const iface of res.data.result) {
                        // Skip loopback interface
                        if (iface.name === 'lo' || iface.name === 'Loopback Pseudo-Interface 1') continue;

                        if (iface['ip-addresses']) {
                            for (const addr of iface['ip-addresses']) {
                                // Only get IPv4 addresses
                                if (addr['ip-address-type'] === 'ipv4' && !addr['ip-address'].startsWith('127.')) {
                                    ips.push(addr['ip-address']);
                                }
                            }
                        }
                    }
                }
            } else {
                // For LXC, get config and parse net interfaces
                const res = await this.fetch<{ data: Record<string, string> }>(
                    `/api2/json/nodes/${node}/lxc/${vmid}/config`,
                    {
                        headers: {
                            Cookie: `PVEAuthCookie=${ticket}`,
                        },
                    }
                );

                // Parse net0, net1, etc. for IP addresses
                for (const [key, value] of Object.entries(res.data)) {
                    if (key.startsWith('net') && typeof value === 'string') {
                        // Format: name=eth0,bridge=vmbr0,ip=192.168.1.100/24,...
                        const ipMatch = value.match(/ip=([^/,]+)/);
                        if (ipMatch && ipMatch[1] && ipMatch[1] !== 'dhcp') {
                            ips.push(ipMatch[1]);
                        }
                    }
                }
            }
        } catch (error) {
            // Guest agent not running or other error - return empty
            console.error('Failed to get VM network info:', error);
        }

        return ips;
    }

    async getVmStatus(node: string, vmid: number, ticket: string, type: 'qemu' | 'lxc' = 'qemu'): Promise<Record<string, any>> {
        const res = await this.fetch<{ data: Record<string, any> }>(`/api2/json/nodes/${node}/${type}/${vmid}/status/current`, {
            headers: { Cookie: `PVEAuthCookie=${ticket}` },
        });
        return res.data;
    }

    async getVmConfig(node: string, vmid: number, ticket: string, type: 'qemu' | 'lxc' = 'qemu'): Promise<Record<string, any>> {
        const res = await this.fetch<{ data: Record<string, any> }>(`/api2/json/nodes/${node}/${type}/${vmid}/config`, {
            headers: { Cookie: `PVEAuthCookie=${ticket}` },
        });
        return res.data;
    }

    async getVmRrdData(node: string, vmid: number, ticket: string, type: 'qemu' | 'lxc' = 'qemu', timeframe: string = 'hour'): Promise<any[]> {
        const res = await this.fetch<{ data: any[] }>(`/api2/json/nodes/${node}/${type}/${vmid}/rrddata?timeframe=${timeframe}`, {
            headers: { Cookie: `PVEAuthCookie=${ticket}` },
        });
        return res.data || [];
    }

    async getNextId(ticket: string): Promise<number> {
        const res = await this.fetch<{ data: string }>('/api2/json/cluster/nextid', {
            headers: { Cookie: `PVEAuthCookie=${ticket}` },
        });
        return parseInt(res.data, 10);
    }

    async cloneVm(node: string, vmid: number, params: { newid: number, name?: string, full?: number, target?: string }, ticket: string, csrfToken: string): Promise<string> {
        const body = new URLSearchParams();
        body.append('newid', params.newid.toString());
        if (params.name) body.append('name', params.name);
        if (params.full !== undefined) body.append('full', params.full.toString());
        if (params.target) body.append('target', params.target);

        const res = await this.fetch<{ data: string }>(`/api2/json/nodes/${node}/qemu/${vmid}/clone`, {
            method: 'POST',
            body: body,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
        return res.data;
    }

    async updateVmConfig(node: string, vmid: number, config: Record<string, string>, ticket: string, csrfToken: string): Promise<string> {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(config)) {
            body.append(key, value);
        }

        const res = await this.fetch<{ data: string }>(`/api2/json/nodes/${node}/qemu/${vmid}/config`, {
            method: 'POST',
            body: body,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
        return res.data;
    }

    async getNodesNetwork(node: string, ticket: string, type?: string): Promise<any[]> {
        let path = `/api2/json/nodes/${node}/network`;
        if (type) path += `?type=${type}`;

        const res = await this.fetch<{ data: any[] }>(path, {
            headers: { Cookie: `PVEAuthCookie=${ticket}` }
        });
        return res.data;
    }

    async getTaskStatus(node: string, upid: string, ticket: string): Promise<any> {
        const res = await this.fetch<{ data: any }>(`/api2/json/nodes/${node}/tasks/${upid}/status`, {
            headers: { Cookie: `PVEAuthCookie=${ticket}` }
        });
        return res.data;
    }

    async resizeVmDisk(node: string, vmid: number, disk: string, size: string, ticket: string, csrfToken: string): Promise<string> {
        const body = new URLSearchParams();
        body.append('disk', disk);
        body.append('size', size);

        const res = await this.fetch<{ data: string }>(`/api2/json/nodes/${node}/qemu/${vmid}/resize`, {
            method: 'PUT',
            body: body,
            headers: {
                Cookie: `PVEAuthCookie=${ticket}`,
                CSRFPreventionToken: csrfToken
            },
        });
        return res.data;
    }

    async getUserPermissions(ticket: string): Promise<Record<string, Record<string, number>>> {
        const res = await this.fetch<{ data: Record<string, Record<string, number>> }>('/api2/json/access/permissions', {
            headers: { Cookie: `PVEAuthCookie=${ticket}` }
        });
        return res.data;
    }
}
