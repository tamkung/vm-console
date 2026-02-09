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
    const [showToolbar, setShowToolbar] = useState(true); // Toggle-based, default visible

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const proxyInputRef = useRef<HTMLInputElement>(null);

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

    // Function to ensure iframe has focus for keyboard events
    const focusIframe = () => {
        if (iframeRef.current) {
            iframeRef.current.focus();
            
            // Also try to send a click message or just ensure content window has focus
            if (iframeRef.current.contentWindow) {
                iframeRef.current.contentWindow.focus();
            }
        }
    };

    // Auto-focus when iframe loads or src changes
    useEffect(() => {
        if (iframeSrc) {
            // Small delay to allow iframe to render
            const timer = setTimeout(focusIframe, 500);
            return () => clearTimeout(timer);
        }
    }, [iframeSrc]);

    const toggleToolbar = () => {
        setShowToolbar(prev => !prev);
    };

    const handleBack = () => {
        router.push('/dashboard');
    };

    const activateKeyboard = () => {
        // Focus the proxy input to trigger virtual keyboard on mobile/tablet
        if (proxyInputRef.current) {
            proxyInputRef.current.focus({ preventScroll: true });
            proxyInputRef.current.click();
        }
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
        <div 
            className="h-screen bg-gray-900 flex flex-col overflow-hidden"
            onClick={focusIframe} // Clicking anywhere outside toolbar should focus iframe
        >
            {/* Toggle Button for Toolbar - Always visible */}
            <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-[60] transition-opacity duration-300 opacity-30 hover:opacity-100">
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleToolbar();
                    }}
                    className="bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white px-3 py-0.5 rounded-b-lg border-b border-x border-gray-600 shadow-lg text-[10px] font-bold transition-all"
                    title={showToolbar ? "Hide Toolbar" : "Show Toolbar"}
                >
                    {showToolbar ? "▲ Hide Controls" : "▼ Show Controls"}
                </button>
            </div>
            
            {/* Toolbar - Toggle-based show/hide */}
            <div 
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
                    showToolbar 
                        ? 'opacity-100 translate-y-0 pointer-events-auto' 
                        : 'opacity-0 -translate-y-full pointer-events-none'
                }`}
            >
                <div className="bg-gray-800/95 backdrop-blur-sm border-b border-gray-700 px-2 py-1 flex items-center justify-between h-9">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent focusing iframe instantly so button works
                                handleBack();
                            }}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs flex items-center gap-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            Back
                        </button>
                        <span className="text-gray-400 text-xs hidden md:inline">Guacamole Remote Console</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Show Keyboard Button */}
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                activateKeyboard();
                            }}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
                            title="Show Keyboard (for tablets)"
                        >
                            ⌨️ Keyboard
                        </button>
                        {/* Fullscreen Button */}
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                const iframe = document.getElementById('guac-frame') as HTMLIFrameElement;
                                if (iframe?.requestFullscreen) {
                                    iframe.requestFullscreen();
                                    // Focus again after fullscreen change
                                    setTimeout(focusIframe, 100);
                                }
                            }}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
                            title="Fullscreen"
                        >
                            ⛶ Fullscreen
                        </button>
                    </div>
                </div>
            </div>

            {/* Console Frame - full screen, no scrollbar */}
            <div 
                className={`flex-1 relative overflow-hidden ${showToolbar ? 'mt-9' : 'mt-0'}`}
            >
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                        <div className="text-white animate-pulse">Loading Console...</div>
                    </div>
                )}
                {iframeSrc && (
                    <iframe
                        ref={iframeRef}
                        id="guac-frame"
                        src={iframeSrc}
                        className="w-full h-full border-0"
                        style={{ height: '100%' }}
                        allow="clipboard-read; clipboard-write; fullscreen"
                        onLoad={() => {
                            setLoading(false);
                            focusIframe();
                        }}
                    />
                )}
            </div>

            {/* Proxy Input for Virtual Keyboard Support on Tablets */}
            <input 
                ref={proxyInputRef}
                type="text"
                inputMode="text"
                className="fixed top-12 left-0 w-8 h-8 opacity-0 z-0 pointer-events-auto" 
                autoCorrect="off" 
                autoCapitalize="off" 
                spellCheck="false" 
                autoComplete="off"
                onInput={(e) => {
                    // Clear the input after capture (Guacamole handles its own input)
                    (e.target as HTMLInputElement).value = '';
                }}
            />
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