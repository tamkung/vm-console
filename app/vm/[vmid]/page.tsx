'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import Swal from 'sweetalert2';

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeStr = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
    if (days > 0) return `${days}d ${timeStr}`;
    return timeStr;
};

// Simple circular gauge component
function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
    const pct = Math.min(100, Math.max(0, value));
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (pct / 100) * circumference;

    return (
        <div className="flex flex-col items-center">
            <svg width="100" height="100" viewBox="0 0 100 100" className="transform -rotate-90">
                <circle cx="50" cy="50" r={radius} fill="none" stroke="#374151" strokeWidth="8" />
                <circle
                    cx="50" cy="50" r={radius} fill="none"
                    stroke={color}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    className="transition-all duration-700 ease-out"
                />
            </svg>
            <div className="absolute mt-8 text-center">
                <div className="text-lg font-bold text-white">{pct.toFixed(1)}%</div>
            </div>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
        </div>
    );
}

// Mini sparkline chart using SVG
function Sparkline({ data, color, label }: { data: number[]; color: string; label: string }) {
    if (!data || data.length === 0) return null;
    const max = Math.max(...data, 0.001);
    const width = 300;
    const height = 60;
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div>
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16 bg-gray-800/50 rounded">
                <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    points={points}
                />
                {/* Fill area */}
                <polygon
                    fill={color}
                    fillOpacity="0.1"
                    points={`0,${height} ${points} ${width},${height}`}
                />
            </svg>
        </div>
    );
}

export default function VmDetailPage() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const vmid = params?.vmid as string;
    const node = searchParams?.get('node') || '';
    const type = (searchParams?.get('type') || 'qemu') as 'qemu' | 'lxc';

    const [vmStatus, setVmStatus] = useState<Record<string, any> | null>(null);
    const [vmConfig, setVmConfig] = useState<Record<string, any> | null>(null);
    const [ips, setIps] = useState<string[]>([]);
    const [rrdData, setRrdData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useSessionRefresh();

    const fetchDetail = async () => {
        try {
            const res = await fetch(`/api/vms/${vmid}?node=${node}&type=${type}`);
            if (res.status === 401) { router.push('/'); return; }
            if (!res.ok) throw new Error('Failed to fetch VM details');
            const data = await res.json();
            setVmStatus(data.status);
            setVmConfig(data.config);
            setIps(data.ips || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchRrd = async () => {
        try {
            const res = await fetch(`/api/vms/${vmid}/rrddata?node=${node}&type=${type}&timeframe=hour`);
            if (res.ok) {
                const data = await res.json();
                setRrdData(data.rrddata || []);
            }
        } catch { /* ignore */ }
    };

    useEffect(() => {
        if (vmid && node) {
            fetchDetail();
            fetchRrd();
            const interval = setInterval(fetchDetail, 15000);
            return () => clearInterval(interval);
        }
    }, [vmid, node]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleAction = async (action: string) => {
        const isDestructive = ['stop', 'shutdown', 'reboot'].includes(action);
        const result = await Swal.fire({
            title: `${action} ${type === 'qemu' ? 'VM' : 'Container'} ${vmid}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: isDestructive ? '#d33' : '#3085d6',
            confirmButtonText: `Yes, ${action}!`,
            background: '#1f2937',
            color: '#fff',
        });
        if (!result.isConfirmed) return;

        try {
            const res = await fetch('/api/vms/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vmid: parseInt(vmid), node, action, type }),
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Action failed');
            await Swal.fire({ title: 'Success!', text: `Action '${action}' initiated.`, icon: 'success', timer: 1500, showConfirmButton: false, background: '#1f2937', color: '#fff' });
            fetchDetail();
        } catch (err: any) {
            Swal.fire({ title: 'Error!', text: err.message, icon: 'error', background: '#1f2937', color: '#fff' });
        }
    };

    // Loading skeleton
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
                <div className="max-w-5xl mx-auto space-y-6">
                    <div className="h-8 w-40 bg-gray-700 rounded animate-pulse" />
                    <div className="h-12 w-72 bg-gray-700 rounded animate-pulse" />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="h-28 bg-gray-800 rounded-lg border border-gray-700 animate-pulse" />
                        ))}
                    </div>
                    <div className="h-64 bg-gray-800 rounded-lg border border-gray-700 animate-pulse" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-4">
                <div className="text-red-400 text-xl">Error: {error}</div>
                <button onClick={() => router.push('/dashboard')} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
                    Back to Dashboard
                </button>
            </div>
        );
    }

    const isRunning = vmStatus?.status === 'running';
    const cpuPct = (vmStatus?.cpu || 0) * 100;
    const memPct = vmStatus?.maxmem ? ((vmStatus?.mem || 0) / vmStatus.maxmem) * 100 : 0;
    const diskPct = vmStatus?.maxdisk ? ((vmStatus?.disk || 0) / vmStatus.maxdisk) * 100 : 0;
    const vmName = vmStatus?.name || vmConfig?.name || `${type.toUpperCase()} ${vmid}`;

    // Extract RRD chart data
    const cpuHistory = rrdData.map(d => (d.cpu || 0) * 100);
    const memHistory = rrdData.map(d => d.maxmem ? ((d.mem || 0) / d.maxmem) * 100 : 0);
    const netInHistory = rrdData.map(d => d.netin || 0);
    const netOutHistory = rrdData.map(d => d.netout || 0);

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 p-6 md:p-8">
            <div className="max-w-5xl mx-auto">
                {/* Back + Header */}
                <button
                    onClick={() => router.push('/dashboard')}
                    className="text-gray-400 hover:text-white text-sm flex items-center gap-1 mb-4 transition"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back to Dashboard
                </button>

                <div className="flex flex-wrap items-center gap-4 mb-6">
                    <h1 className="text-3xl font-bold text-white">{vmName}</h1>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isRunning ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-gray-700 text-gray-300 border border-gray-600'}`}>
                        {vmStatus?.status || 'unknown'}
                    </span>
                    <span className="text-gray-500 text-sm">ID: {vmid} · Node: {node} · Type: {type.toUpperCase()}</span>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 mb-8">
                    {isRunning ? (
                        <>
                            <button onClick={() => handleAction('shutdown')} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded text-sm font-semibold">Shutdown</button>
                            <button onClick={() => handleAction('reboot')} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold">Reboot</button>
                            <button onClick={() => handleAction('stop')} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-semibold">Force Stop</button>
                            <button onClick={() => window.location.assign(`/console/${vmid}?node=${node}&type=${type}`)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded text-sm font-semibold flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                Console
                            </button>
                        </>
                    ) : (
                        <button onClick={() => handleAction('start')} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded text-sm font-semibold">Start</button>
                    )}
                </div>

                {/* Info Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-500 uppercase mb-1">vCPUs</p>
                        <p className="text-2xl font-bold">{vmConfig?.cores || vmConfig?.cpus || vmStatus?.cpus || '?'}</p>
                        {vmConfig?.sockets && <p className="text-xs text-gray-500">{vmConfig.sockets} socket(s)</p>}
                    </div>
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-500 uppercase mb-1">Memory</p>
                        <p className="text-2xl font-bold">{formatBytes(vmStatus?.maxmem || 0)}</p>
                        {isRunning && <p className="text-xs text-gray-500">Used: {formatBytes(vmStatus?.mem || 0)}</p>}
                    </div>
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-500 uppercase mb-1">Disk</p>
                        <p className="text-2xl font-bold">{formatBytes(vmStatus?.maxdisk || 0)}</p>
                        {isRunning && vmStatus?.disk > 0 && <p className="text-xs text-gray-500">Used: {formatBytes(vmStatus?.disk || 0)}</p>}
                    </div>
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-500 uppercase mb-1">IP Address</p>
                        {ips.length > 0 ? (
                            ips.map((ip, i) => <p key={i} className="text-lg font-mono">{ip}</p>)
                        ) : (
                            <p className="text-gray-500 text-sm italic">N/A</p>
                        )}
                    </div>
                </div>

                {/* Usage Gauges (only when running) */}
                {isRunning && (
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-8">
                        <h2 className="text-lg font-semibold mb-4">Resource Usage</h2>
                        <div className="flex flex-wrap justify-around items-center gap-8">
                            <div className="relative flex flex-col items-center">
                                <Gauge value={cpuPct} label="CPU" color="#3B82F6" />
                            </div>
                            <div className="relative flex flex-col items-center">
                                <Gauge value={memPct} label="Memory" color="#8B5CF6" />
                            </div>
                            {vmStatus?.maxdisk > 0 && diskPct > 0 && (
                                <div className="relative flex flex-col items-center">
                                    <Gauge value={diskPct} label="Disk" color="#F59E0B" />
                                </div>
                            )}
                            <div className="text-center space-y-2">
                                <p className="text-xs text-gray-500 uppercase">Uptime</p>
                                <p className="text-xl font-mono text-white">{formatUptime(vmStatus?.uptime || 0)}</p>
                            </div>
                            <div className="text-center space-y-2">
                                <p className="text-xs text-gray-500 uppercase">Network I/O</p>
                                <p className="text-sm text-green-400">↓ {formatBytes(vmStatus?.netin || 0)}</p>
                                <p className="text-sm text-blue-400">↑ {formatBytes(vmStatus?.netout || 0)}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Charts */}
                {isRunning && rrdData.length > 0 && (
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-8">
                        <h2 className="text-lg font-semibold mb-4">History (Last Hour)</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Sparkline data={cpuHistory} color="#3B82F6" label="CPU %" />
                            <Sparkline data={memHistory} color="#8B5CF6" label="Memory %" />
                            <Sparkline data={netInHistory} color="#10B981" label="Network In" />
                            <Sparkline data={netOutHistory} color="#60A5FA" label="Network Out" />
                        </div>
                    </div>
                )}

                {/* Config Details */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                    <h2 className="text-lg font-semibold mb-4">Configuration</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                        {vmConfig && Object.entries(vmConfig)
                            .filter(([key]) => !['digest', 'description'].includes(key))
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([key, value]) => (
                                <div key={key} className="flex justify-between py-1 border-b border-gray-700/50">
                                    <span className="text-gray-400 font-mono">{key}</span>
                                    <span className="text-gray-200 truncate max-w-[60%] text-right" title={String(value)}>{String(value)}</span>
                                </div>
                            ))
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}
