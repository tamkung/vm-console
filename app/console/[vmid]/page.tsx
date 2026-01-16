'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
// @ts-expect-error - novnc-next types are missing
import RFB from 'novnc-next';

// KeySym constants
const KEY_ESC = 0xff1b;
const KEY_TAB = 0xff09;
const KEY_CTRL = 0xffe3;
const KEY_ALT = 0xffe9;
const KEY_WIN = 0xffeb;

interface RFBInstance {
  disconnect(): void;
  sendCtrlAltDel(): void;
  sendKey(keysym: number, code: string, down: boolean): void;
}

export default function ConsolePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const vmid = params?.vmid as string;
  const node = searchParams?.get('node');
  const type = searchParams?.get('type') || 'qemu';
  
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBInstance | null>(null);
  
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  
  // Key States for Sticky Keys
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);

  useEffect(() => {
    if (!vmid || !node) {
      setError('Missing VMID or Node parameters');
      return;
    }

    const connectVnc = async () => {
      try {
        const res = await fetch(`/api/console/${vmid}/ticket?node=${node}&type=${type}`, {
          method: 'POST',
        });

        if (!res.ok) {
           const data = await res.json();
          throw new Error(data.error || 'Failed to get VNC ticket');
        }

        const data = await res.json();
        const { ticket, port } = data;

        // Connect to local proxy
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host; 
        
        // Proxy Path: /api/proxy/api2/json/nodes/<node>/<type>/<vmid>/vncwebsocket
        const path = `api/proxy/api2/json/nodes/${node}/${type}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;
        const url = `${protocol}//${host}/${path}`;

        console.log('Connecting to (Proxy):', url);

        if (screenRef.current) {
             try {
                const rfb = new RFB(
                    screenRef.current,
                    url,{
                        credentials: { password: ticket },
                    }
                );

                rfb.scaleViewport = true; // Scale to fit
                rfb.background = "#000000"; // Set background to black

                rfb.addEventListener("connect",  () => {
                    setStatus('connected');
                });

                rfb.addEventListener("disconnect", () => {
                    setStatus('disconnected');
                });
                
                rfb.addEventListener("securityfailure", () => {
                     setError('Security failure/Auth failed');
                });
                 
                rfbRef.current = rfb;
             } catch (e: unknown) {
                 const message = e instanceof Error ? e.message : 'Unknown RFB Init Error';
                 console.error('RFB Init Error', e);
                 setError(message);
             }
        }

      } catch (err: unknown) {
        console.error(err);
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setStatus('error');
      }
    };

    connectVnc();

    return () => {
      if (rfbRef.current) {
        try {
            rfbRef.current.disconnect();
        } catch (_) { // eslint-disable-line @typescript-eslint/no-unused-vars
            // ignore
        }
      }
    };
  }, [vmid, node]);

  const toggleToolbar = () => {
    setShowToolbar(prev => !prev);
  };

  // Handle browser back or manual navigation
  const handleBack = () => {
    router.push('/dashboard');
  };
  
  // Send Ctrl+Alt+Del
  const sendCtrlAltDel = () => {
      if(rfbRef.current) {
          rfbRef.current.sendCtrlAltDel();
      }
  }

  // Helper to send keys
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

  // Extract host for the trust button
  const proxmoxHost = process.env.NEXT_PUBLIC_PROXMOX_URL || '';

  return (
    <div className="flex flex-col h-screen bg-black text-gray-300 overflow-hidden relative">
      {/* Toggle Button for Toolbar */}
      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-[60] transition-opacity duration-300 opacity-30 hover:opacity-100">
        <button 
          onClick={toggleToolbar}
          className="bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white px-4 py-1 rounded-b-lg border-b border-x border-gray-600 shadow-lg text-xs font-bold transition-all"
          title={showToolbar ? "Hide Toolbar" : "Show Toolbar"}
        >
          {showToolbar ? "▲ Hide Controls" : "▼ Show Controls"}
        </button>
      </div>

      <div className={`absolute top-0 left-0 right-0 z-50 bg-gray-800/95 backdrop-blur-sm px-2 flex justify-between items-center border-b border-gray-700 transition-transform duration-300 ease-in-out h-12 ${showToolbar ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="flex items-center space-x-4">
            <button 
                onClick={handleBack}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm"
            >
                &larr; Back
            </button>
            <h1 className="font-bold text-white hidden md:block">Console: VM {vmid}</h1>
            <span className={`text-xs px-2 py-0.5 rounded ${status === 'connected' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                {status}
            </span>
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
      
      <div className={`flex-1 overflow-hidden relative flex items-center justify-center bg-gray-900 transition-all duration-300 ease-in-out ${showToolbar ? 'pt-12' : 'pt-0'}`}>
          {error && (
              <div className="absolute top-10 left-1/2 transform -translate-x-1/2 z-50 bg-red-900/90 border border-red-500 text-white p-6 rounded shadow-xl max-w-lg w-full">
                  <h3 className="font-bold text-lg mb-2">Connection Error</h3>
                  <p className="mb-4 font-mono text-sm bg-black/30 p-2 rounded">{error}</p>
                  
                  <div className="space-y-4">
                      <div className="bg-yellow-900/30 p-3 rounded border border-yellow-700 text-yellow-200 text-sm">
                          <strong>Browser Security Warning:</strong><br/>
                          Browsers often block WebSocket connections to servers with self-signed certificates (Error 1006).
                      </div>

                      {proxmoxHost && (
                          <a 
                            href={proxmoxHost} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="block w-full text-center bg-green-700 hover:bg-green-600 text-white font-bold py-3 px-4 rounded border border-green-500 shadow-lg"
                          >
                             1. Click here to open Proxmox & Accept Cert
                          </a>
                      )}
                      
                      <p className="text-xs text-center text-gray-400">
                          After accepting the certificate in the new tab, close it and come back here.
                      </p>

                      <button 
                        onClick={() => window.location.reload()}
                        className="block w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded"
                      >
                        2. Retry Connection
                      </button>
                  </div>
              </div>
          )}
        <div ref={screenRef} className="w-full h-full" />
      </div>
    </div>
  );
}
