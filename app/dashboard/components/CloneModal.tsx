'use client';

import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import { ProxmoxVm } from '@/lib/proxmox';

const isValidIp = (ip: string) => {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

const isValidCidr = (cidr: string) => {
    if (cidr.toLowerCase() === 'dhcp') return true;
    const parts = cidr.split('/');
    if (parts.length === 1) return isValidIp(parts[0]);
    if (parts.length !== 2) return false;
    const ip = parts[0];
    const mask = parseInt(parts[1]);
    if (isNaN(mask)) return false;
    const isIpv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip);
    if (isIpv4) return mask >= 0 && mask <= 32 && isValidIp(ip);
    return mask >= 0 && mask <= 128 && isValidIp(ip);
};

const isValidDnsList = (dns: string) => {
    if (!dns) return true;
    const servers = dns.split(/[,\s]+/).filter(Boolean);
    return servers.every(isValidIp);
};

interface CloneModalProps {
    onClose: () => void;
    onSuccess: () => void;
    templates: ProxmoxVm[];
}

export default function CloneModal({ onClose, onSuccess, templates }: CloneModalProps) {
    const [activeTab, setActiveTab] = useState<'basic' | 'specs' | 'cloudinit' | 'network'>('basic');
    const [selectedTemplate, setSelectedTemplate] = useState<ProxmoxVm | null>(templates[0] || null);
    
    // Basic settings
    const [newName, setNewName] = useState('');
    const [newVmid, setNewVmid] = useState<number | ''>('');
    const [isFullClone, setIsFullClone] = useState(false);
    
    // Specs
    const [cpuCores, setCpuCores] = useState<number | ''>('');
    const [ramMb, setRamMb] = useState<number | ''>('');
    const [diskAddGb, setDiskAddGb] = useState<number | ''>('');
    
    // Nodes
    const [targetNode, setTargetNode] = useState('');
    const [nodes, setNodes] = useState<string[]>([]);
    const [fetchingNodes, setFetchingNodes] = useState(false);

    // Cloud-Init settings
    const [ciUser, setCiUser] = useState('');
    const [ciPassword, setCiPassword] = useState('');
    const [sshKey, setSshKey] = useState('');
    const [ipAddr, setIpAddr] = useState('');
    const [gateway, setGateway] = useState('');
    const [dns, setDns] = useState('');

    // Network settings
    const [selectedBridge, setSelectedBridge] = useState('');
    const [bridges, setBridges] = useState<any[]>([]);
    const [fetchingBridges, setFetchingBridges] = useState(false);

    const [loading, setLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [fetchingNextId, setFetchingNextId] = useState(false);

    useEffect(() => {
        fetchNextId();
        fetchNodes();
    }, []);

    const fetchNodes = async () => {
        setFetchingNodes(true);
        try {
            const res = await fetch('/api/nodes');
            if (res.ok) {
                const data = await res.json();
                setNodes(data.nodes || []);
            }
        } catch (error) {
            console.error("Failed to fetch nodes", error);
        } finally {
            setFetchingNodes(false);
        }
    };

    useEffect(() => {
        if (selectedTemplate) {
            if (!targetNode) {
                setTargetNode(selectedTemplate.node);
            }
            
            // Set default specs based on template
            setCpuCores(selectedTemplate.cpus || 1);
            setRamMb(Math.floor(selectedTemplate.maxmem ? selectedTemplate.maxmem / (1024 * 1024) : 1024));
            setDiskAddGb('');
        }
    }, [selectedTemplate]);

    useEffect(() => {
        if (targetNode) {
            fetchBridges(targetNode);
        }
    }, [targetNode]);

    const fetchNextId = async () => {
        setFetchingNextId(true);
        try {
            const res = await fetch('/api/vms/nextid');
            if (res.ok) {
                const data = await res.json();
                setNewVmid(data.nextId);
            }
        } catch (error) {
            console.error("Failed to fetch next ID", error);
        } finally {
            setFetchingNextId(false);
        }
    };

    const fetchBridges = async (node: string) => {
        setFetchingBridges(true);
        try {
            const res = await fetch(`/api/nodes/${node}/network?type=bridge`);
            if (res.ok) {
                const data = await res.json();
                setBridges(data.network || []);
            }
        } catch (error) {
            console.error("Failed to fetch bridges", error);
        } finally {
            setFetchingBridges(false);
        }
    };

    const pollTask = async (node: string, upid: string) => {
        let isComplete = false;
        while (!isComplete) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                // Encode UPID to handle special characters correctly in URL
                const res = await fetch(`/api/tasks/${node}/${encodeURIComponent(upid)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.status?.status === 'stopped') {
                        isComplete = true;
                        
                        if (data.status?.exitstatus !== 'OK') {
                            throw new Error(`Task failed: ${data.status?.exitstatus}`);
                        }
                    }
                }
            } catch (err: any) {
                console.error("Polling error", err);
                // Continue polling on transient errors, break on permanent errors if needed
            }
        }
    };

    const handleClone = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation Results
        const ipError = ipAddr && !isValidCidr(ipAddr);
        const gwError = gateway && !isValidIp(gateway);
        const dnsError = dns && !isValidDnsList(dns);

        if (ipError || gwError || dnsError) {
            setActiveTab('cloudinit');
            let errorMsg = 'Please fix the following issues:';
            if (ipError) errorMsg += '\n- Invalid IP or CIDR (e.g. 192.168.1.10/24)';
            if (gwError) errorMsg += '\n- Invalid Gateway IP address';
            if (dnsError) errorMsg += '\n- Invalid DNS server IP(s)';

            Swal.fire({
                title: 'Validation Error',
                text: errorMsg,
                icon: 'error',
                background: '#1f2937',
                color: '#fff'
            });
            return;
        }

        if (!selectedTemplate || !newVmid) return;

        setLoading(true);
        setLoadingMessage('Initiating clone...');

        // 1. Prepare configuration
        const config: Record<string, string | number> = {};
        
        // Specs
        if (cpuCores) config['cores'] = cpuCores;
        if (ramMb) config['memory'] = ramMb;

        // Cloud-Init config
        if (ciUser) config['ciuser'] = ciUser;
        if (ciPassword) config['cipassword'] = ciPassword;
        if (sshKey) config['sshkeys'] = sshKey;
        
        if (ipAddr) {
            const formattedIp = ipAddr.includes('/') ? ipAddr : `${ipAddr}/24`;
            config['ipconfig0'] = `ip=${formattedIp}${gateway ? `,gw=${gateway}` : ''}`;
        }
        if (dns) config['nameserver'] = dns;

        // Network Config
        if (selectedBridge) config['net0'] = `virtio,bridge=${selectedBridge}`;

        const resizeDisk = diskAddGb ? `+${diskAddGb}G` : undefined;
        let finalMessage = 'VM cloned and configured successfully!';
        let finalWarning = false;

        try {
            // STEP 1: Request Clone
            const cloneRes = await fetch('/api/vms/clone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node: selectedTemplate.node,
                    vmid: selectedTemplate.vmid,
                    newid: newVmid,
                    name: newName || undefined,
                    full: isFullClone,
                    targetNode: targetNode !== selectedTemplate.node ? targetNode : undefined
                })
            });

            if (!cloneRes.ok) throw new Error((await cloneRes.json()).error || 'Cloning request failed');
            const cloneData = await cloneRes.json();
            
            // Return early if no config is needed
            if (Object.keys(config).length === 0 && !resizeDisk) {
                Swal.fire({ title: 'Success!', text: cloneData.message, icon: 'success', background: '#1f2937', color: '#fff' });
                onSuccess();
                onClose();
                return;
            }

            // STEP 2: Poll Task Completion (Crucial for full clones)
            if (cloneData.upid) {
                setLoadingMessage('Waiting for clone to complete... (This may take a while)');
                await pollTask(selectedTemplate.node, cloneData.upid);
            }

            // STEP 3: Apply Configurations
            setLoadingMessage('Applying configuration...');
            const configRes = await fetch('/api/vms/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node: targetNode,
                    vmid: newVmid,
                    config: config,
                    resizeDisk: resizeDisk
                })
            });

            if (!configRes.ok) throw new Error((await configRes.json()).error || 'Configuration failed');
            const configData = await configRes.json();
            
            if (configData.warning) {
                finalWarning = true;
                finalMessage = configData.message;
            }

            await Swal.fire({
                title: finalWarning ? 'Partial Success' : 'Success!',
                text: finalMessage,
                icon: finalWarning ? 'warning' : 'success',
                background: '#1f2937',
                color: '#fff',
                timer: 3000,
                showConfirmButton: true
            });

            onSuccess();
            onClose();
        } catch (err: any) {
            Swal.fire({
                title: 'Error!',
                text: err.message,
                icon: 'error',
                background: '#1f2937',
                color: '#fff'
            });
        } finally {
            setLoading(false);
            setLoadingMessage('');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-gray-800 border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl relative my-auto">
                {!loading && (
                    <button 
                        onClick={onClose}
                        className="absolute top-4 right-4 text-gray-400 hover:text-white z-10"
                    >
                        ✕
                    </button>
                )}
                
                <div className="p-6">
                    <h2 className="text-xl font-bold text-white mb-4">Clone VM with Config</h2>
                    
                    {/* Tabs */}
                    <div className="flex flex-wrap border-b border-gray-700 mb-6">
                        <button 
                            className={`py-2 px-3 text-sm font-medium transition-colors ${activeTab === 'basic' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setActiveTab('basic')}
                            disabled={loading}
                        >
                            Basic
                        </button>
                        <button 
                            className={`py-2 px-3 text-sm font-medium transition-colors ${activeTab === 'specs' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setActiveTab('specs')}
                            disabled={loading}
                        >
                            Specs
                        </button>
                        <button 
                            className={`py-2 px-3 text-sm font-medium transition-colors ${activeTab === 'cloudinit' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setActiveTab('cloudinit')}
                            disabled={loading}
                        >
                            Cloud-Init
                        </button>
                        <button 
                            className={`py-2 px-3 text-sm font-medium transition-colors ${activeTab === 'network' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setActiveTab('network')}
                            disabled={loading}
                        >
                            Network
                        </button>
                    </div>

                    <form onSubmit={handleClone} className="space-y-4">
                        {loading && (
                            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-900/90 rounded-lg">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                                <p className="text-white font-medium animate-pulse text-center px-4">{loadingMessage}</p>
                            </div>
                        )}

                        {/* Basic Settings Tab */}
                        {activeTab === 'basic' && (
                            <div className="space-y-4 animate-fadeIn">
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">Select Template</label>
                                    <select 
                                        value={selectedTemplate?.vmid || ''}
                                        onChange={(e) => {
                                            const vmid = parseInt(e.target.value);
                                            const found = templates.find(t => t.vmid === vmid);
                                            if (found) setSelectedTemplate(found);
                                        }}
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 text-white"
                                        required
                                    >
                                        {templates.map(t => (
                                            <option key={t.vmid} value={t.vmid}>
                                                [{t.vmid}] {t.name} ({t.node})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">Target Node</label>
                                    <select 
                                        value={targetNode}
                                        onChange={(e) => setTargetNode(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 text-white"
                                        required
                                        disabled={fetchingNodes}
                                    >
                                        {nodes.length > 0 ? (
                                            nodes.map(n => (
                                                <option key={n} value={n}>
                                                    {n} {selectedTemplate?.node === n ? '(local)' : ''}
                                                </option>
                                            ))
                                        ) : (
                                            <option value={selectedTemplate?.node}>{selectedTemplate?.node}</option>
                                        )}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">New VM Name</label>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 text-white"
                                        placeholder="e.g. web-server-01"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">New VM ID</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            value={newVmid}
                                            onChange={(e) => setNewVmid(e.target.value === '' ? '' : parseInt(e.target.value))}
                                            className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 text-white"
                                            required
                                        />
                                        <button 
                                            type="button"
                                            onClick={fetchNextId}
                                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded border border-gray-600"
                                            disabled={fetchingNextId}
                                        >
                                            {fetchingNextId ? '...' : '🔄'}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center space-x-2 py-2">
                                    <input 
                                        type="checkbox" 
                                        id="fullClone"
                                        checked={isFullClone} 
                                        onChange={(e) => setIsFullClone(e.target.checked)}
                                        className="h-4 w-4 text-blue-500 rounded bg-gray-900 border-gray-600"
                                    />
                                    <label htmlFor="fullClone" className="text-sm text-gray-300 cursor-pointer">
                                        <strong>Full Clone</strong> (Independent disk)
                                    </label>
                                </div>
                            </div>
                        )}

                        {/* Specs Tab */}
                        {activeTab === 'specs' && (
                            <div className="space-y-4 animate-fadeIn">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-gray-300">CPU Cores</label>
                                        <input
                                            type="number"
                                            value={cpuCores}
                                            onChange={(e) => setCpuCores(e.target.value === '' ? '' : parseInt(e.target.value))}
                                            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                            placeholder="e.g. 2"
                                            min="1"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-gray-300">Memory (MB)</label>
                                        <input
                                            type="number"
                                            value={ramMb}
                                            onChange={(e) => setRamMb(e.target.value === '' ? '' : parseInt(e.target.value))}
                                            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                            placeholder="e.g. 2048"
                                            min="512"
                                            step="512"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">Add Disk Size (GB)</label>
                                    <div className="relative">
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                            +
                                        </span>
                                        <input
                                            type="number"
                                            value={diskAddGb}
                                            onChange={(e) => setDiskAddGb(e.target.value === '' ? '' : parseInt(e.target.value))}
                                            className="w-full bg-gray-900 border border-gray-600 rounded py-2 pl-8 pr-2 text-white"
                                            placeholder="e.g. 10"
                                            min="1"
                                        />
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">Increase the primary disk size by this amount (GB) after cloning.</p>
                                </div>
                            </div>
                        )}

                        {/* Cloud-Init Tab */}
                        {activeTab === 'cloudinit' && (
                            <div className="space-y-4 animate-fadeIn">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-gray-300">User</label>
                                        <input
                                            type="text"
                                            value={ciUser}
                                            onChange={(e) => setCiUser(e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                            placeholder="ubuntu"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-gray-300">Password</label>
                                        <input
                                            type="password"
                                            value={ciPassword}
                                            onChange={(e) => setCiPassword(e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">SSH Public Key</label>
                                    <textarea
                                        value={sshKey}
                                        onChange={(e) => setSshKey(e.target.value)}
                                        rows={3}
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-xs font-mono"
                                        placeholder="ssh-rsa AAAAB3..."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-gray-300">IP / CIDR</label>
                                        <input
                                            type="text"
                                            value={ipAddr}
                                            onChange={(e) => setIpAddr(e.target.value)}
                                            className={`w-full bg-gray-900 border ${ipAddr && !isValidCidr(ipAddr) ? 'border-red-500' : 'border-gray-600'} rounded p-2 text-white transition-colors`}
                                            placeholder="192.168.1.10/24 or dhcp"
                                        />
                                        {ipAddr && !isValidCidr(ipAddr) && <p className="text-[10px] text-red-500 mt-1">Invalid format</p>}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 text-gray-300">Gateway</label>
                                        <input
                                            type="text"
                                            value={gateway}
                                            onChange={(e) => setGateway(e.target.value)}
                                            className={`w-full bg-gray-900 border ${gateway && !isValidIp(gateway) ? 'border-red-500' : 'border-gray-600'} rounded p-2 text-white transition-colors`}
                                            placeholder="192.168.1.1"
                                        />
                                        {gateway && !isValidIp(gateway) && <p className="text-[10px] text-red-500 mt-1">Invalid IP</p>}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">DNS Servers</label>
                                    <input
                                        type="text"
                                        value={dns}
                                        onChange={(e) => setDns(e.target.value)}
                                        className={`w-full bg-gray-900 border ${dns && !isValidDnsList(dns) ? 'border-red-500' : 'border-gray-600'} rounded p-2 text-white transition-colors`}
                                        placeholder="8.8.8.8, 1.1.1.1"
                                    />
                                    {dns && !isValidDnsList(dns) && <p className="text-[10px] text-red-500 mt-1">Invalid DNS list</p>}
                                </div>
                            </div>
                        )}

                        {/* Network Tab */}
                        {activeTab === 'network' && (
                            <div className="space-y-4 animate-fadeIn">
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-gray-300">Network Bridge</label>
                                    <div className="flex gap-2">
                                        <select 
                                            value={selectedBridge}
                                            onChange={(e) => setSelectedBridge(e.target.value)}
                                            className="flex-1 bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                        >
                                            <option value="">-- No changes --</option>
                                            {bridges.map(b => (
                                                <option key={b.iface} value={b.iface}>
                                                    {b.iface} {b.active ? ' (active)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <button 
                                            type="button"
                                            onClick={() => targetNode && fetchBridges(targetNode)}
                                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded border border-gray-600"
                                            disabled={fetchingBridges}
                                        >
                                            {fetchingBridges ? '...' : '🔄'}
                                        </button>
                                    </div>
                                </div>

                                <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded text-xs text-blue-300">
                                    <p>Selecting a bridge will configure <strong>net0</strong> on the new VM using the <strong>VirtIO</strong> model.</p>
                                </div>
                            </div>
                        )}

                        <div className="pt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading || !selectedTemplate || !newVmid}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-bold py-3 px-4 rounded transition flex items-center justify-center gap-2"
                            >
                                {loading ? 'Processing...' : 'Clone & Configure'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
            
            <style jsx>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.3s ease-out forwards;
                }
            `}</style>
        </div>
    );
}
