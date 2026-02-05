'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Swal from 'sweetalert2';

interface VM {
    vmid: number;
    name: string;
    status: string;
    node: string;
    type: 'qemu' | 'lxc';
}

interface GuacamoleModalProps {
    onClose: () => void;
    vms?: VM[]; // Optional - only available after login
}

type Protocol = 'rdp' | 'vnc' | 'ssh';

const DEFAULT_PORTS: Record<Protocol, number> = {
    rdp: 3389,
    vnc: 5901,
    ssh: 22
};

export default function GuacamoleModal({ onClose, vms = [] }: GuacamoleModalProps) {
    const router = useRouter();
    const [protocol, setProtocol] = useState<Protocol>('rdp');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('3389');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loadingVmIp, setLoadingVmIp] = useState<number | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Update port when protocol changes
    const handleProtocolChange = (newProtocol: Protocol) => {
        setProtocol(newProtocol);
        setPort(DEFAULT_PORTS[newProtocol].toString());
    };

    // Fetch VM IP when selecting from dropdown
    const handleVmSelect = async (vm: VM) => {
        setShowDropdown(false);
        setLoadingVmIp(vm.vmid);
        
        try {
            const res = await fetch(`/api/vms/network?vmid=${vm.vmid}&node=${vm.node}&type=${vm.type}`);
            const data = await res.json();
            
            if (data.ips && data.ips.length > 0) {
                setHost(data.ips[0]); // Use first IP
            } else {
                // No IP found, set VM name as placeholder
                setHost('');
                Swal.fire({
                    icon: 'info',
                    title: 'No IP Found',
                    text: `Could not get IP for ${vm.name}. Please enter manually. (Guest agent may not be running)`,
                    background: '#1f2937',
                    color: '#fff',
                    timer: 3000,
                    showConfirmButton: false
                });
            }
        } catch (error) {
            console.error('Failed to fetch VM IP:', error);
            setHost('');
        } finally {
            setLoadingVmIp(null);
        }
    };

    const handleConnect = async () => {
        // Validation
        if (!host.trim()) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Host',
                text: 'Please enter a valid host address or IP',
                background: '#1f2937',
                color: '#fff'
            });
            return;
        }

        if (!username.trim()) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Username',
                text: 'Please enter a username',
                background: '#1f2937',
                color: '#fff'
            });
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/guacamole/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    protocol,
                    host: host.trim(),
                    port: parseInt(port) || DEFAULT_PORTS[protocol],
                    username: username.trim(),
                    password
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Connection failed');
            }

            const data = await res.json();
            
            // Navigate to embedded console page
            if (data.sessionId) {
                router.push(`/console/guac?session=${data.sessionId}`);
                onClose();
            } else {
                throw new Error('No session received');
            }
        } catch (err: unknown) {
            Swal.fire({
                icon: 'error',
                title: 'Connection Failed',
                text: err instanceof Error ? err.message : 'Could not establish connection',
                background: '#1f2937',
                color: '#fff'
            });
        } finally {
            setLoading(false);
        }
    };

    const hasVms = vms.length > 0;
    const runningVms = vms.filter(vm => vm.status === 'running');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-2xl relative">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                >
                    ✕
                </button>
                
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Guacamole Remote Console
                </h2>
                
                <div className="space-y-4">
                    {/* Protocol */}
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Protocol</label>
                        <select 
                            value={protocol} 
                            onChange={(e) => handleProtocolChange(e.target.value as Protocol)}
                            className="w-full bg-gray-900 border border-gray-600 text-white rounded p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
                        >
                            <option value="rdp">RDP (Remote Desktop)</option>
                            <option value="vnc">VNC</option>
                            <option value="ssh">SSH</option>
                        </select>
                    </div>

                    {/* Host & Port - Combined dropdown and input */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 relative" ref={dropdownRef}>
                            <label className="block text-sm text-gray-300 mb-2">Host / IP</label>
                            <div className="relative">
                                <input 
                                    type="text"
                                    value={host}
                                    onChange={(e) => setHost(e.target.value)}
                                    onFocus={() => hasVms && setShowDropdown(true)}
                                    placeholder={hasVms ? "Type or select from VMs" : "192.168.1.100"}
                                    className="w-full bg-gray-900 border border-gray-600 text-white rounded p-2.5 pr-10 focus:ring-2 focus:ring-emerald-500 outline-none placeholder-gray-500"
                                />
                                {hasVms && (
                                    <button
                                        type="button"
                                        onClick={() => setShowDropdown(!showDropdown)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            
                            {/* VM Dropdown */}
                            {showDropdown && hasVms && (
                                <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-600 rounded shadow-lg max-h-48 overflow-y-auto">
                                    {runningVms.length > 0 ? (
                                        runningVms.map(vm => (
                                            <button
                                                key={vm.vmid}
                                                type="button"
                                                onClick={() => handleVmSelect(vm)}
                                                disabled={loadingVmIp === vm.vmid}
                                                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white flex items-center justify-between disabled:opacity-50"
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                                    <span className="truncate">{vm.name}</span>
                                                    <span className="text-gray-500 text-xs">({vm.vmid})</span>
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${vm.type === 'lxc' ? 'bg-orange-600/30 text-orange-400' : 'bg-blue-600/30 text-blue-400'}`}>
                                                        {vm.type === 'lxc' ? 'LXC' : 'VM'}
                                                    </span>
                                                </span>
                                                {loadingVmIp === vm.vmid && (
                                                    <svg className="animate-spin h-4 w-4 text-emerald-400" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                )}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="px-3 py-2 text-gray-500 text-sm">No running VMs</div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm text-gray-300 mb-2">Port</label>
                            <input 
                                type="number"
                                value={port}
                                onChange={(e) => setPort(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 text-white rounded p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                        </div>
                    </div>

                    {/* Username */}
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Username</label>
                        <input 
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="administrator"
                            className="w-full bg-gray-900 border border-gray-600 text-white rounded p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none placeholder-gray-500"
                        />
                    </div>

                    {/* Password */}
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Password</label>
                        <input 
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full bg-gray-900 border border-gray-600 text-white rounded p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none placeholder-gray-500"
                        />
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 px-4 rounded transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConnect}
                            disabled={loading}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 text-white font-semibold py-2.5 px-4 rounded transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Connecting...
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Connect
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
