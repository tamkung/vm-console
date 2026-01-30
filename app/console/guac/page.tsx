'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function GuacConsoleContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const sessionId = searchParams?.get('session');
    
    const [iframeSrc, setIframeSrc] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showToolbar, setShowToolbar] = useState(false);
    const hoverTimeout = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!sessionId) {
            setError('No session ID provided');
            setLoading(false);
            return;
        }
        
        // Fetch the Guacamole URL from the session API
        const fetchUrl = async () => {
            try {
                const res = await fetch(`/api/guacamole/session?session=${sessionId}`);
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Failed to get session');
                }
                const data = await res.json();
                if (data.url) {
                    setIframeSrc(data.url);
                } else {
                    throw new Error('No URL received');
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load console');
            } finally {
                setLoading(false);
            }
        };
        
        fetchUrl();
    }, [sessionId]);

    const handleMouseEnter = () => {
        // Clear any existing timeout
        if (hoverTimeout.current) {
            clearTimeout(hoverTimeout.current);
        }
        // Show toolbar after 1 second hover
        hoverTimeout.current = setTimeout(() => {
            setShowToolbar(true);
        }, 1000);
    };

    const handleMouseLeave = () => {
        // Clear the timeout
        if (hoverTimeout.current) {
            clearTimeout(hoverTimeout.current);
            hoverTimeout.current = null;
        }
        setShowToolbar(false);
    };

    const handleBack = () => {
        router.push('/dashboard');
    };

    if (error) {
        return (
            <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
                <div className="text-red-400 text-xl mb-4">Error: {error}</div>
                <button 
                    onClick={handleBack}
                    className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
                >
                    Back to Dashboard
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col">
            {/* Thin hover trigger zone at very top edge - only 4px */}
            <div 
                className="fixed top-0 left-0 right-0 h-1 z-50"
                onMouseEnter={handleMouseEnter}
            />
            
            {/* Toolbar - auto hide, show on hover */}
            <div 
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
                    showToolbar 
                        ? 'opacity-100 translate-y-0 pointer-events-auto' 
                        : 'opacity-0 -translate-y-full pointer-events-none'
                }`}
                onMouseEnter={() => {
                    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                    setShowToolbar(true);
                }}
                onMouseLeave={handleMouseLeave}
            >
                <div className="bg-gray-800/95 backdrop-blur-sm border-b border-gray-700 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={handleBack}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            Back
                        </button>
                        <span className="text-gray-400 text-sm">Guacamole Remote Console</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => {
                                const iframe = document.getElementById('guac-frame') as HTMLIFrameElement;
                                if (iframe?.requestFullscreen) {
                                    iframe.requestFullscreen();
                                }
                            }}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm"
                        >
                            Fullscreen
                        </button>
                    </div>
                </div>
            </div>

            {/* Console Frame - full screen */}
            <div className="flex-1 relative">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                        <div className="text-white animate-pulse">Loading Console...</div>
                    </div>
                )}
                {iframeSrc && (
                    <iframe
                        id="guac-frame"
                        src={iframeSrc}
                        className="w-full h-full border-0"
                        style={{ minHeight: '100vh' }}
                        allow="clipboard-read; clipboard-write"
                        onLoad={() => setLoading(false)}
                    />
                )}
            </div>
        </div>
    );
}

export default function GuacConsolePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
                <div className="animate-pulse">Loading...</div>
            </div>
        }>
            <GuacConsoleContent />
        </Suspense>
    );
}
