'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
// RFB import moved to useEffect to avoid SSR window error

// KeySym constants
const KEY_ESC = 0xff1b;
const KEY_TAB = 0xff09;
const KEY_CTRL = 0xffe3;
const KEY_ALT = 0xffe9;
const KEY_WIN = 0xffeb;

function SharePageContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token');
  
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any | null>(null);
  
  const [status, setStatus] = useState('connecting'); // connecting, connected, disconnected, error
  const [error, setError] = useState('');
  const [vmData, setVmData] = useState<{ vmid: number, node: string } | null>(null);

  // Toolbar State
  const [showToolbar, setShowToolbar] = useState(true);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  // Timer State
  const [timeLeftFormatted, setTimeLeftFormatted] = useState<string>('');

  useEffect(() => {
    if (!token) {
        setError('Missing access token');
        setStatus('error');
        return;
    }

    const connect = async () => {
        try {
            // 1. Exchange Token for Ticket & Connection Info
            const res = await fetch('/api/share/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Connection refused');
            }

            const data = await res.json();
            const { ticket, port, node, vmid, expiresAt, type = 'qemu' } = data;
            setVmData({ vmid, node });
            
            
            // Set Timeout for Session Expiration & Timer UI
            if (expiresAt) {
                 const updateTimer = () => {
                     const timeLeft = expiresAt - Date.now();
                     if (timeLeft <= 0) {
                         setTimeLeftFormatted('Expired');
                         return false; // Stop
                     }
                     
                     // Format HH:MM:SS or MM:SS
                     const seconds = Math.floor((timeLeft / 1000) % 60);
                     const minutes = Math.floor((timeLeft / (1000 * 60)) % 60);
                     const hours = Math.floor((timeLeft / (1000 * 60 * 60)));
                     
                     const pad = (n: number) => n.toString().padStart(2, '0');
                     if (hours > 0) {
                         setTimeLeftFormatted(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
                     } else {
                         setTimeLeftFormatted(`${pad(minutes)}:${pad(seconds)}`);
                     }
                     return true; // Continue
                 };

                 // Initial call
                 if (!updateTimer()) {
                     throw new Error('Session has already expired');
                 }

                 // Update UI every second
                 const timerInterval = setInterval(() => {
                     if (!updateTimer()) {
                         clearInterval(timerInterval);
                     }
                 }, 1000);

                 // Set Hard Disconnect Timeout
                 const totalTimeLeft = expiresAt - Date.now();
                 setTimeout(async () => {
                     clearInterval(timerInterval);
                     // 1. Disconnect VNC
                     if (rfbRef.current) {
                         try { rfbRef.current.disconnect(); } catch (_) {}
                     }
                     setStatus('disconnected');
                     
                     // 2. Show Alert
                     const { default: Swal } = await import('sweetalert2');
                     await Swal.fire({
                         icon: 'warning',
                         title: 'Session Expired',
                         text: 'Your shared session time has ended.',
                         allowOutsideClick: false,
                         allowEscapeKey: false,
                         confirmButtonText: 'Close Window',
                         background: '#1f2937',
                         color: '#fff'
                     });
                     
                     window.close(); 
                 }, totalTimeLeft);
            }


            // Dynamically import novnc-next to avoid SSR window error
            // @ts-expect-error - novnc-next types are missing
            const { default: RFB } = await import('novnc-next');
            
            // 2. Connect to Secure Proxy
            // We now have the PVEAuthCookie set by the /connect endpoint
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            
            // Standard Proxy Path (Authenticated via Cookie)
            const path = `api/proxy/api2/json/nodes/${node}/${type}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;
            const url = `${protocol}//${host}/${path}`;

            if (screenRef.current) {
                const rfb = new RFB(
                    screenRef.current,
                    url,
                    { credentials: { password: ticket } }
                );

                rfb.scaleViewport = true;
                rfb.background = "#000000";

                rfb.addEventListener("connect",  () => setStatus('connected'));
                rfb.addEventListener("disconnect", () => setStatus('disconnected'));
                rfb.addEventListener("securityfailure", () => setError('Security failure'));

                rfbRef.current = rfb;
            }

        } catch (err: any) {
            console.error(err);
            setError(err.message);
            setStatus('error');
        }
    };

    connect();

    return () => {
        if (rfbRef.current) {
            try { rfbRef.current.disconnect(); } catch (_) {}
        }
    };
  }, [token]);

  // Toolbar Helpers
  const toggleToolbar = () => setShowToolbar(prev => !prev);
  // ... (existing helpers) ...
  const sendCtrlAltDel = () => {
      if(rfbRef.current) rfbRef.current.sendCtrlAltDel();
  }

  const sendKey = (keysym: number) => {
      if(!rfbRef.current) return;
      rfbRef.current.sendKey(keysym, '', true); // Down
      setTimeout(() => {
          if(rfbRef.current) rfbRef.current.sendKey(keysym, '', false); // Up
      }, 100);
  };

  const toggleModifier = (keysym: number, active: boolean, setActive: (v: boolean) => void) => {
      if(!rfbRef.current) return;
      const newState = !active;
      setActive(newState);
      rfbRef.current.sendKey(keysym, '', newState);
  };

  const toggleFullScreen = () => {
      if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
      } else {
          if (document.exitFullscreen) {
              document.exitFullscreen();
          }
      }
  };

  return (
    <div className="flex h-screen w-screen bg-black overflow-hidden relative">
      
      {/* 1. Toggle Button for Toolbar */}
      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-[60] transition-opacity duration-300 opacity-30 hover:opacity-100">
        <button 
          onClick={toggleToolbar}
          className="bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white px-4 py-1 rounded-b-lg border-b border-x border-gray-600 shadow-lg text-xs font-bold transition-all"
          title={showToolbar ? "Hide Toolbar" : "Show Toolbar"}
        >
          {showToolbar ? "▲ Hide Controls" : "▼ Show Controls"}
        </button>
      </div>

      {/* 2. Toolbar */}
      <div className={`absolute top-0 left-0 right-0 z-50 bg-gray-800/95 backdrop-blur-sm px-2 flex justify-between items-center border-b border-gray-700 transition-transform duration-300 ease-in-out h-12 ${showToolbar ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="flex items-center space-x-4">
            {/* Header / Status - No Back Button here */}
            <h1 className="font-bold text-white hidden md:block">
                Shared VM {vmData?.vmid ? `#${vmData.vmid}` : ''}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded ${status === 'connected' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                {status}
            </span>
             {/* Countdown Timer */}
             {timeLeftFormatted && (
                 <span className="text-xs font-mono text-yellow-500 border border-yellow-700/50 bg-yellow-900/20 px-2 py-0.5 rounded flex items-center">
                     ⏱ {timeLeftFormatted}
                 </span>
             )}
        </div>

         {/* Extended Controls */}
         <div className="flex items-center space-x-2">
             <button 
                onClick={() => toggleModifier(KEY_CTRL, ctrlActive, setCtrlActive)}
                className={`px-3 py-1 rounded text-sm font-bold border ${ctrlActive ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-700 hover:bg-gray-600 border-gray-600'}`}
             >
                Ctrl
             </button>
             <button 
                onClick={() => toggleModifier(KEY_ALT, altActive, setAltActive)}
                className={`px-3 py-1 rounded text-sm font-bold border ${altActive ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-700 hover:bg-gray-600 border-gray-600'}`}
             >
                Alt
             </button>
             <button 
                onClick={() => sendKey(KEY_WIN)} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600"
                title="Windows Key"
             >
                Win
             </button>
             <button 
                onClick={() => sendKey(KEY_TAB)} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600"
                title="Tab"
             >
                Tab
             </button>
             <button 
                onClick={() => sendKey(KEY_ESC)} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600"
                title="Escape"
             >
                Esc
             </button>
            <button onClick={sendCtrlAltDel} className="bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm whitespace-nowrap">
                Ctrl-Alt-Del
            </button>
            <button 
                onClick={toggleFullScreen} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600"
                title="Toggle Full Screen"
            >
                ⛶
            </button>
        </div>
      </div>

      {/* Overlay Status */}
      {status !== 'connected' && (
         <div className="absolute inset-0 flex items-center justify-center z-50 bg-gray-900/90 text-white">
            <div className="text-center">
                {status === 'connecting' && <div className="text-xl animate-pulse">Connecting to Shared Session...</div>}
                {status === 'disconnected' && <div className="text-xl text-yellow-500">Session Disconnected</div>}
                {status === 'error' && (
                    <div className="text-red-500">
                        <div className="text-2xl font-bold mb-2">Connection Error</div>
                        <div>{error}</div>
                    </div>
                )}
            </div>
         </div>
      )}
      
      {/* VNC Screen */}
      <div className={`flex-1 overflow-hidden relative flex items-center justify-center bg-gray-900 transition-all duration-300 ease-in-out ${showToolbar ? 'pt-12' : 'pt-0'}`}>
        <div ref={screenRef} className="w-full h-full" />
      </div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<div className="flex h-screen w-screen bg-black items-center justify-center text-white">Loading...</div>}>
      <SharePageContent />
    </Suspense>
  );
}
