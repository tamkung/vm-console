'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProxmoxVm, ProxmoxLxc } from '@/lib/proxmox';
import ShareModal from './components/ShareModal';
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResourceClick = (vmid: number, node: string, type: 'qemu' | 'lxc' = 'qemu') => {
    router.push(`/console/${vmid}?node=${node}&type=${type}`);
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

  const filteredResources = resources.filter(r => (r.type || 'qemu') === activeTab);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-pulse">Loading Resources...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue-400">Proxmox Console</h1>
          <div className="flex space-x-3">
              <button 
                onClick={fetchResources}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
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

        {/* Tabs */}
        <div className="flex space-x-4 mb-6 border-b border-gray-700">
            <button
                className={`py-2 px-4 font-semibold border-b-2 transition-colors duration-200 ${activeTab === 'qemu' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                onClick={() => setActiveTab('qemu')}
            >
                Virtual Machines
            </button>
            <button
                className={`py-2 px-4 font-semibold border-b-2 transition-colors duration-200 ${activeTab === 'lxc' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                onClick={() => setActiveTab('lxc')}
            >
                LXC Containers
            </button>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-4 rounded mb-6">
            Error: {error}
          </div>
        )}

        {filteredResources.length === 0 && !error ? (
          <div className="text-center text-gray-500 mt-10">No {activeTab === 'qemu' ? 'VMs' : 'Containers'} found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredResources.map((res) => {
              const isRunning = res.status === 'running';
              const type = res.type || 'qemu';
              return (
              <div 
                key={`${type}-${res.vmid}`} 
                className={`bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700 transition relative ${isRunning ? 'border-blue-500/30' : 'opacity-90'}`}
              >
                {/* Main Card Content - Clickable for Console if Running */}
                <div 
                    className={`p-6 ${isRunning ? 'cursor-pointer hover:bg-gray-700/50' : ''}`}
                    onClick={() => isRunning && handleResourceClick(res.vmid, res.node, type)}
                >
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white truncate">{res.name || `${type.toUpperCase()} ${res.vmid}`}</h2>
                    <span className={`w-3 h-3 rounded-full ${statusColor(res.status)}`} title={res.status}></span>
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
                                    onClick={(e) => handleAction(e, res.vmid, res.node, 'shutdown', type)}
                                    className="cursor-pointer text-yellow-500 hover:text-yellow-400 text-xs uppercase font-bold px-2 py-1 rounded hover:bg-yellow-900/30 border border-yellow-700/50"
                                    title="Shutdown"
                                >
                                    Shutdown
                                </button>
                                <button 
                                    onClick={(e) => handleAction(e, res.vmid, res.node, 'reboot', type)}
                                    className="cursor-pointer text-blue-500 hover:text-blue-400 text-xs uppercase font-bold px-2 py-1 rounded hover:bg-blue-900/30 border border-blue-700/50"
                                    title="Reboot"
                                >
                                    Reboot
                                </button>
                                <button 
                                    onClick={(e) => handleAction(e, res.vmid, res.node, 'stop', type)}
                                    className="cursor-pointer text-red-500 hover:text-red-400 text-xs uppercase font-bold px-2 py-1 rounded hover:bg-red-900/30 border border-red-700/50"
                                    title="Force Stop"
                                >
                                    Stop
                                </button>
                            </>
                        ) : (
                            <button 
                                onClick={(e) => handleAction(e, res.vmid, res.node, 'start', type)}
                                className="cursor-pointer text-green-500 hover:text-green-400 text-xs uppercase font-bold px-2 py-1 rounded hover:bg-green-900/30 border border-green-700/50 w-full md:w-auto"
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
                                            className="px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white border-b border-gray-700"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuVmId(null);
                                                setShareVm({vmid: res.vmid, node: res.node, type});
                                            }}
                                        >
                                            Share 🔗
                                        </button>
                                        <button
                                            className="px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuVmId(null);
                                                handleResourceClick(res.vmid, res.node, type);
                                            }}
                                        >
                                            Console &rarr;
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
    </div>
  );
}
