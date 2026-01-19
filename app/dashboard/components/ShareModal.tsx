'use client';

import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';

interface ShareModalProps {
    vmid: number;
    node: string;
    type?: 'qemu' | 'lxc';
    onClose: () => void;
}

interface Share {
    id: string;
    vmid: number;
    node: string;
    createdAt: number;
    expiresAt: number;
    revoked: boolean;
}

export default function ShareModal({ vmid, node, type = 'qemu', onClose }: ShareModalProps) {
    const [duration, setDuration] = useState('60'); // 1 hour default
    const [link, setLink] = useState('');
    const [loading, setLoading] = useState(false);
    const [shares, setShares] = useState<Share[]>([]);
    
    useEffect(() => {
        fetchShares();
    }, [vmid]);

    const fetchShares = async () => {
        try {
            const res = await fetch(`/api/share/list?vmid=${vmid}`);
            if (res.ok) {
                const data = await res.json();
                setShares(data.shares || []);
            }
        } catch (error) {
            console.error("Failed to fetch shares", error);
        }
    };

    const generateLink = async () => {
        const credentialsToken = sessionStorage.getItem('vm_console_creds');
        
        if (!credentialsToken) {
             Swal.fire({ 
                 icon: 'error', 
                 title: 'Session Expired', 
                 text: 'Your session credentials are missing. Please log out and log in again to generate share links.' 
             });
             return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/share/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    vmid, 
                    node, 
                    type,
                    duration: parseInt(duration),
                    credentialsToken
                })
            });
            
            if (!res.ok) throw new Error('Failed to generate link');
            
            const data = await res.json();
            setLink(data.link);
            fetchShares(); // Refresh list
        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Could not generate share link',
                background: '#1f2937',
                color: '#fff'
            });
        } finally {
            setLoading(false);
        }
    };

    const cancelShare = async (shareId: string) => {
        const result = await Swal.fire({
            title: 'Revoke Link?',
            text: "This link will stop working immediately.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, revoke it!',
            background: '#1f2937',
            color: '#fff'
        });

        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/share/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shareId })
                });

                if (res.ok) {
                    Swal.fire({
                        title: 'Revoked!',
                        text: 'The link has been revoked.',
                        icon: 'success',
                        background: '#1f2937',
                        color: '#fff',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    fetchShares();
                } else {
                    throw new Error('Failed to revoke');
                }
            } catch (e) {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Could not revoke link',
                    background: '#1f2937',
                    color: '#fff'
                });
            }
        }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(link);
        Swal.fire({
            icon: 'success',
            title: 'Copied!',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 1500,
            background: '#1f2937',
            color: '#fff'
        });
    };

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleString();
    };

    // Calculate time remaining string
    const getTimeRemaining = (expiresAt: number) => {
        const now = Date.now();
        const diff = expiresAt - now;
        if (diff <= 0) return 'Expired';
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-2xl shadow-2xl relative max-h-[90vh] overflow-y-auto">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                >
                    ✕
                </button>
                
                <h2 className="text-xl font-bold text-white mb-4">Share VM {vmid}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Generate */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-200 border-b border-gray-700 pb-2">Generate New Link</h3>
                        
                        {!link ? (
                            <div className="space-y-4">
                                <div className="bg-blue-900/30 border border-blue-700 p-3 rounded text-sm text-blue-200">
                                     Generates a temporary access link.
                                </div>
        
                                <div>
                                    <label className="block text-sm text-gray-300 mb-2">Duration</label>
                                    <select 
                                        value={duration} 
                                        onChange={(e) => setDuration(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-600 text-white rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="15">15 Minutes</option>
                                        <option value="60">1 Hour</option>
                                        <option value="360">6 Hours</option>
                                        <option value="1440">24 Hours</option>
                                        <option value="10080">1 Week</option>
                                        <option value="43200">1 Month</option>
                                    </select>
                                </div>
                                
                                <button
                                    onClick={generateLink}
                                    disabled={loading}
                                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-bold py-2 px-4 rounded transition-colors flex justify-center"
                                >
                                    {loading ? (
                                        <svg className="animate-spin h-5 w-5 mr-2 text-white" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : 'Generate Link'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4 animate-fadeIn">
                                <div>
                                    <label className="block text-sm text-green-400 mb-2 font-bold">Link Generated!</label>
                                    <div className="flex space-x-2">
                                        <input 
                                            readOnly 
                                            value={link} 
                                            className="flex-1 bg-gray-900 border border-green-500/50 text-gray-300 text-sm rounded p-2 outline-none"
                                        />
                                        <button 
                                            onClick={copyToClipboard}
                                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded border border-gray-600"
                                            title="Copy"
                                        >
                                            📋
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        Share this link to provide access.
                                    </p>
                                </div>
                                
                                <button 
                                    onClick={() => setLink('')}
                                    className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded"
                                >
                                    Generate Another
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Active Shares */}
                    <div className="space-y-4 border-l border-gray-700 pl-6 md:block hidden">
                        <h3 className="text-lg font-semibold text-gray-200 border-b border-gray-700 pb-2">Active Shares</h3>
                        
                        <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                            {shares.length === 0 ? (
                                <p className="text-gray-500 text-sm italic">No active shares found.</p>
                            ) : (
                                shares.map(share => (
                                    <div key={share.id} className="bg-gray-900/50 p-3 rounded border border-gray-700 flex justify-between items-center group hover:border-gray-600 transition-colors">
                                        <div>
                                            <div className="text-sm text-gray-300">Expires: {formatDate(share.expiresAt)}</div>
                                            <div className="text-xs text-blue-400">Time left: {getTimeRemaining(share.expiresAt)}</div>
                                        </div>
                                        <button 
                                            onClick={() => cancelShare(share.id)}
                                            className="text-gray-500 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Revoke Link"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Mobile View for Active Shares (stacked) */}
                    <div className="space-y-4 md:hidden block border-t border-gray-700 pt-4">
                        <h3 className="text-lg font-semibold text-gray-200">Active Shares</h3>
                        <div className="space-y-3 max-h-[200px] overflow-y-auto pr-1">
                             {shares.map(share => (
                                <div key={share.id} className="bg-gray-900/50 p-3 rounded border border-gray-700 flex justify-between items-center">
                                    <div>
                                        <div className="text-sm text-gray-300">Expires: {formatDate(share.expiresAt)}</div>
                                        <div className="text-xs text-blue-400">Time left: {getTimeRemaining(share.expiresAt)}</div>
                                    </div>
                                    <button 
                                        onClick={() => cancelShare(share.id)}
                                        className="text-gray-500 hover:text-red-400 p-1"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
