'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProxmoxVm, ProxmoxLxc } from '@/lib/proxmox';
import ShareModal from './components/ShareModal';
import GuacamoleModal from '../components/GuacamoleModal';
import CloneModal from './components/CloneModal';

import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import Swal from 'sweetalert2';


const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeStr = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;

  if (days > 0) {
    return `${days} days ${timeStr}`;
  }
  return timeStr;
};

export default function DashboardPage() {
  const router = useRouter();
  const [resources, setResources] = useState<(ProxmoxVm | ProxmoxLxc)[]>([]);
  const [activeTab, setActiveTab] = useState<'qemu' | 'lxc'>('qemu');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareVm, setShareVm] = useState<{vmid: number, node: string, type: 'qemu' | 'lxc'} | null>(null);
  const [openMenuVmId, setOpenMenuVmId] = useState<number | null>(null);
  const [showGuacModal, setShowGuacModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [sortBy, setSortBy] = useState<'vmid' | 'name' | 'status' | 'cpu' | 'memory' | 'uptime'>('vmid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [username, setUsername] = useState<string>('');
  useSessionRefresh();

  // Get username from cookie on mount
  useEffect(() => {
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return decodeURIComponent(parts.pop()?.split(';').shift() || '');
      return '';
    };
    setUsername(getCookie('PVE_USER'));
  }, []);

  const fetchResources = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vms');
      if (res.status === 401) {
        router.push('/');
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to fetch resources');
      }
      const data = await res.json();
      setResources(data.vms);
      setError('');
    } catch (err: unknown) {
      if (err instanceof Error) {
          setError(err.message);
      } else {
          setError('Failed to fetch resources');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchResources, 30000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResourceClick = (vmid: number, node: string, type: 'qemu' | 'lxc' = 'qemu') => {
    window.location.assign(`/console/${vmid}?node=${node}&type=${type}`);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'stopped': return 'bg-gray-500';
      case 'paused': return 'bg-yellow-500';
      default: return 'bg-red-500';
    }
  };

  const handleAction = async (e: React.MouseEvent, vmid: number, node: string, action: string, type: 'qemu' | 'lxc') => {
    e.stopPropagation(); // Prevent card click
    
    // Custom colors for actions
    const isDestructive = action === 'stop' || action === 'shutdown' || action === 'reboot';
    const confirmButtonColor = isDestructive ? '#d33' : '#3085d6';

    const result = await Swal.fire({
      title: `Are you sure?`,
      text: `Do you want to ${action} ${type === 'qemu' ? 'VM' : 'Container'} ${vmid}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: confirmButtonColor,
      cancelButtonColor: '#3085d6',
      confirmButtonText: `Yes, ${action} it!`,
      background: '#1f2937', // dark mode bg
      color: '#fff' // dark mode text
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch('/api/vms/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vmid, node, action, type })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Action failed');
        }

        // Show success alert before reloading
        await Swal.fire({
             title: 'Success!',
             text: `Action '${action}' initiated.`,
             icon: 'success',
             timer: 1500,
             showConfirmButton: false,
             background: '#1f2937',
             color: '#fff'
        });

        // Refresh list
        fetchResources();
    } catch (err: any) {
        Swal.fire({
            title: 'Error!',
            text: err.message,
            icon: 'error',
            background: '#1f2937',
            color: '#fff'
        });
    }
  };

  const filteredResources = resources.filter(r => {
    if ((r.type || 'qemu') !== activeTab) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const name = (r.name || '').toLowerCase();
    const vmid = String(r.vmid);
    return name.includes(q) || vmid.includes(q);
  }).sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'name': cmp = (a.name || '').localeCompare(b.name || ''); break;
      case 'status': cmp = a.status.localeCompare(b.status); break;
      case 'cpu': cmp = (a.cpu || 0) - (b.cpu || 0); break;
      case 'memory': cmp = (a.mem || 0) - (b.mem || 0); break;
      case 'uptime': cmp = (a.uptime || 0) - (b.uptime || 0); break;
      default: cmp = a.vmid - b.vmid;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredResources.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedResources = filteredResources.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);

  if (loading && resources.length === 0) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="h-10 w-56 bg-gray-700 rounded animate-pulse mb-6" />
          <div className="h-8 w-80 bg-gray-800 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="p-6 space-y-4">
                  <div className="flex justify-between">
                    <div className="h-6 w-36 bg-gray-700 rounded animate-pulse" />
                    <div className="h-3 w-3 bg-gray-700 rounded-full animate-pulse" />
                  </div>
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="flex justify-between">
                        <div className="h-4 w-16 bg-gray-700/50 rounded animate-pulse" />
                        <div className="h-4 w-24 bg-gray-700/50 rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-700/30 px-4 py-3 border-t border-gray-700">
                  <div className="h-6 w-20 bg-gray-700/50 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-blue-400">Proxmox Console</h1>
            {username && (
              <span className="text-sm text-gray-400 flex items-center gap-1 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {username}
              </span>
            )}
          </div>
          <div className="flex space-x-3">
              <button 
                onClick={() => setShowGuacModal(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Guacamole
              </button>
              <button 
                onClick={fetchResources}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              {resources.some((r) => r.type === 'qemu' && (r as any).template === 1 && (r as any).canClone) && (
                  <button 
                    onClick={() => setShowCloneModal(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    Clone Template
                  </button>
              )}
              <button 
                onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' });
                    router.push('/');
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm"
              >
                Logout
              </button>
          </div>
        </div>

        {/* Tabs + Search */}
        <div className="flex items-center justify-between mb-6 border-b border-gray-700">
            <div className="flex space-x-4">
                <button
                    className={`py-2 px-4 font-semibold border-b-2 transition-colors duration-200 ${activeTab === 'qemu' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                    onClick={() => { setActiveTab('qemu'); setCurrentPage(1); }}
                >
                    Virtual Machines
                </button>
                <button
                    className={`py-2 px-4 font-semibold border-b-2 transition-colors duration-200 ${activeTab === 'lxc' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                    onClick={() => { setActiveTab('lxc'); setCurrentPage(1); }}
                >
                    LXC Containers
                </button>
            </div>

            <div className="relative ml-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                    placeholder="Search by name or VMID..."
                    className="w-64 bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-8 py-1.5 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition"
                />
                {searchQuery && (
                    <button
                        onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>

        {/* Filters + Sort */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Status Filter */}
            <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 overflow-hidden text-sm">
                {(['all', 'running', 'stopped'] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                        className={`px-3 py-1.5 capitalize transition ${statusFilter === s ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                        {s === 'all' ? 'All' : s === 'running' ? '🟢 Running' : '⏹ Stopped'}
                    </button>
                ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1 ml-auto">
                <span className="text-xs text-gray-500 mr-1">Sort:</span>
                <select
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value as typeof sortBy); setCurrentPage(1); }}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                >
                    <option value="vmid">VMID</option>
                    <option value="name">Name</option>
                    <option value="status">Status</option>
                    <option value="cpu">CPU</option>
                    <option value="memory">Memory</option>
                    <option value="uptime">Uptime</option>
                </select>
                <button
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:text-white transition"
                    title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                >
                    {sortDir === 'asc' ? '↑' : '↓'}
                </button>
            </div>

            {/* Count */}
            <span className="text-xs text-gray-500">
                {filteredResources.length} item{filteredResources.length !== 1 ? 's' : ''}
            </span>
        </div>        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-4 rounded mb-6">
            Error: {error}
          </div>
        )}

        {filteredResources.length === 0 && !error ? (
          <div className="text-center text-gray-500 mt-10">
            {searchQuery 
              ? `No results for "${searchQuery}"` 
              : `No ${activeTab === 'qemu' ? 'VMs' : 'Containers'} found.`
            }
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedResources.map((res) => {
              const isRunning = res.status === 'running';
              const type = res.type || 'qemu';
              return (
              <div 
                key={`${type}-${res.vmid}`} 
                className={`bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700 transition relative ${isRunning ? 'border-blue-500/30' : 'opacity-90'}`}
              >
                {/* Main Card Content - Clickable for VM Detail */}
                <div 
                    className="p-6 cursor-pointer hover:bg-gray-700/50"
                    onClick={() => router.push(`/vm/${res.vmid}?node=${res.node}&type=${type}`)}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col truncate">
                        <h2 className="text-xl font-semibold text-white truncate">{res.name || `${type.toUpperCase()} ${res.vmid}`}</h2>
                        {(res as any).template === 1 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-900/50 text-purple-300 border border-purple-500/50 mt-1 w-fit">
                                📄 Template
                            </span>
                        )}
                    </div>
                    <span className={`w-3 h-3 rounded-full mt-2 flex-shrink-0 ${statusColor(res.status)}`} title={res.status}></span>
                  </div>
                  
                  <div className="space-y-2 text-sm text-gray-400">
                    <div className="flex justify-between">
                      <span>ID:</span>
                      <span className="text-gray-200">{res.vmid}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Node:</span>
                      <span className="text-gray-200">{res.node}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CPU:</span>
                      <span className="text-gray-200">{res.cpus} vCPUs</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Memory:</span>
                      <span className="text-gray-200">{(res.maxmem / (1024 * 1024 * 1024)).toFixed(1)} GB</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Uptime:</span>
                      <span className="text-gray-200">
                        {res.status === 'running' 
                          ? formatUptime(res.uptime) 
                          : '00:00:00'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer with Actions */}
                <div className="bg-gray-700/50 px-4 py-3 border-t border-gray-700 flex flex-row flex-wrap justify-between items-center gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                         {/* Action Buttons */}
                        {isRunning ? (
                            <>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleResourceClick(res.vmid, res.node, type);
                                    }}
                                    className="cursor-pointer text-cyan-500 hover:text-cyan-400 text-xs uppercase font-bold px-2 py-1 rounded hover:bg-cyan-900/30 border border-cyan-700/50"
                                    title="Open Console"
                                >
                                    Console &rarr;
                                </button>
                            </>
                        ) : (res as any).template !== 1 && (
                            <button 
                                onClick={(e) => handleAction(e, res.vmid, res.node, 'start', type)}
                                className="cursor-pointer text-green-500 hover:text-green-400 text-xs uppercase font-bold px-2 py-1 rounded hover:bg-green-900/30 border border-green-700/50"
                                title="Start"
                            >
                                Start
                            </button>
                        )}
                    </div>
                    
                    {isRunning && (
                        <>
                            {/* Actions Menu (Dropdown) - Visible on all screens to prevent overflow */}
                            <div className="flex relative justify-end">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuVmId(openMenuVmId === res.vmid ? null : res.vmid);
                                    }}
                                    className="text-gray-400 hover:text-white rounded hover:bg-gray-600 focus:outline-none"
                                    title="More Options"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                    </svg>
                                </button>

                                {openMenuVmId === res.vmid && (
                                    <div className="absolute right-0 bottom-full mb-2 w-32 bg-gray-800 border border-gray-600 rounded shadow-xl z-20 flex flex-col overflow-hidden">
                                        <button
                                            className="px-4 py-2 text-left text-sm text-yellow-500 hover:bg-gray-700 hover:text-yellow-400 border-b border-gray-700"
                                            onClick={(e) => { e.stopPropagation(); setOpenMenuVmId(null); handleAction(e, res.vmid, res.node, 'shutdown', type); }}
                                        >
                                            Shutdown
                                        </button>
                                        <button
                                            className="px-4 py-2 text-left text-sm text-blue-500 hover:bg-gray-700 hover:text-blue-400 border-b border-gray-700"
                                            onClick={(e) => { e.stopPropagation(); setOpenMenuVmId(null); handleAction(e, res.vmid, res.node, 'reboot', type); }}
                                        >
                                            Reboot
                                        </button>
                                        <button
                                            className="px-4 py-2 text-left text-sm text-red-500 hover:bg-gray-700 hover:text-red-400 border-b border-gray-700"
                                            onClick={(e) => { e.stopPropagation(); setOpenMenuVmId(null); handleAction(e, res.vmid, res.node, 'stop', type); }}
                                        >
                                            Force Stop
                                        </button>
                                        <button
                                            className="px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuVmId(null);
                                                setShareVm({vmid: res.vmid, node: res.node, type});
                                            }}
                                        >
                                            Share 🔗
                                        </button>
                                    </div>
                                )}
                                
                                {/* Overlay to close menu when clicking outside */}
                                {openMenuVmId === res.vmid && (
                                    <div 
                                        className="fixed inset-0 z-10" 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenMenuVmId(null);
                                        }}
                                    />
                                )}
                            </div>
                        </>
                    )}
                </div>
              </div>
            )})}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 rounded text-sm bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                ← Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => {
                  // Show first, last, current, and neighbors
                  if (page === 1 || page === totalPages) return true;
                  if (Math.abs(page - safePage) <= 1) return true;
                  return false;
                })
                .reduce<(number | 'ellipsis')[]>((acc, page, idx, arr) => {
                  if (idx > 0 && page - (arr[idx - 1] as number) > 1) {
                    acc.push('ellipsis');
                  }
                  acc.push(page);
                  return acc;
                }, [])
                .map((item, idx) => (
                  item === 'ellipsis' ? (
                    <span key={`e-${idx}`} className="px-2 text-gray-500">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setCurrentPage(item as number)}
                      className={`px-3 py-1.5 rounded text-sm border transition ${
                        safePage === item
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {item}
                    </button>
                  )
                ))}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-3 py-1.5 rounded text-sm bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {shareVm && (
        <ShareModal 
            vmid={shareVm.vmid} 
            node={shareVm.node}
            type={shareVm.type}
            onClose={() => setShareVm(null)} 
        />
      )}

      {showGuacModal && (
        <GuacamoleModal 
          onClose={() => setShowGuacModal(false)}
          vms={resources.map(r => ({
            vmid: r.vmid,
            name: r.name,
            status: r.status,
            node: r.node,
            type: (r.type || 'qemu') as 'qemu' | 'lxc'
          }))}
        />
      )}

      {showCloneModal && (
        <CloneModal 
          onClose={() => setShowCloneModal(false)}
          onSuccess={fetchResources}
          templates={resources.filter(r => r.type === 'qemu' && (r as any).template === 1 && (r as any).canClone) as ProxmoxVm[]}
        />
      )}
    </div>
  );
}
