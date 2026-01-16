'use client';

import { useState } from 'react';
import Swal from 'sweetalert2';

interface ShareModalProps {
    vmid: number;
    node: string;
    type?: 'qemu' | 'lxc';
    onClose: () => void;
}

export default function ShareModal({ vmid, node, type = 'qemu', onClose }: ShareModalProps) {
    const [duration, setDuration] = useState('60'); // 1 hour default
    const [link, setLink] = useState('');
    const [loading, setLoading] = useState(false);
    
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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-2xl relative">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                >
                    ✕
                </button>
                
                <h2 className="text-xl font-bold text-white mb-4">Share VM {vmid}</h2>
                
                {!link ? (
                    <div className="space-y-4">
                        <div className="bg-blue-900/30 border border-blue-700 p-3 rounded text-sm text-blue-200">
                             Generating link using your active session credentials.
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
                                Note: This link allows access to the VM console without a password for the selected duration.
                            </p>
                        </div>
                        
                        <button 
                            onClick={onClose}
                            className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded"
                        >
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
