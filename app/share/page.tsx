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
  const proxyInputRef = useRef<HTMLInputElement>(null);
  
  const [status, setStatus] = useState('connecting'); // connecting, connected, disconnected, error
  const [error, setError] = useState('');
  const [vmData, setVmData] = useState<{ vmid: number, node: string } | null>(null);

  // Toolbar State
  const [showToolbar, setShowToolbar] = useState(true);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  // Timer State
  const [timeLeftFormatted, setTimeLeftFormatted] = useState<string>('');

  // Proxy Input Logic
    const handleProxyInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (rfbRef.current?.sendText) {
          rfbRef.current.sendText(val);
      }
      e.target.value = ''; 
  };

  const handleProxyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
          rfbRef.current?.sendKey(0xff08, 'Backspace', true);
          rfbRef.current?.sendKey(0xff08, 'Backspace', false);
      } else if (e.key === 'Enter') {
          rfbRef.current?.sendKey(0xff0d, 'Enter', true);
          rfbRef.current?.sendKey(0xff0d, 'Enter', false);
      }
  };

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
                setError(data.error || 'Connection refused');
                setStatus('error');
                return;
            }

            const data = await res.json();
            const { ticket, port, node, vmid, expiresAt, type = 'qemu' } = data;
            setVmData({ vmid, node });
            
            
            // Set Timeout for Session Expiration & Timer UI
            if (expiresAt) {
                 const handleExpiration = async () => {
                     // 1. Disconnect VNC/Term
                     if (rfbRef.current) {
                         try { 
                             if (type === 'lxc' && rfbRef.current.dispose) {
                                 rfbRef.current.dispose();
                             } else if (rfbRef.current.disconnect) {
                                 rfbRef.current.disconnect(); 
                             }
                         } catch (_) {}
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
                 };

                 const updateTimer = () => {
                     const timeLeft = expiresAt - Date.now();
                     if (timeLeft <= 0) {
                         setTimeLeftFormatted('Expired');
                         handleExpiration();
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
                     // Already expired logic handled inside updateTimer -> handleExpiration
                 } else {
                     // Update UI every second
                     const timerInterval = setInterval(() => {
                         if (!updateTimer()) {
                             clearInterval(timerInterval);
                         }
                     }, 1000);
                     // Note: Interval cleanup handled by page close/unmount implicitly
                 }
            }


            // 2. Connect to Secure Proxy
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            let path = '';

            if (type === 'lxc') {
                // XTERM.JS Logic
                const { Terminal } = await import('xterm');
                const { FitAddon } = await import('xterm-addon-fit');
                // @ts-expect-error - xterm css import might not be typed
                await import('xterm/css/xterm.css');

                const term = new Terminal({
                    cursorBlink: true,
                    fontSize: 14,
                    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                    theme: {
                        background: '#000000',
                    }
                });
                
                const fitAddon = new FitAddon();
                term.loadAddon(fitAddon);

                if (screenRef.current) {
                    screenRef.current.innerHTML = ''; // Clear previous
                    term.open(screenRef.current);
                    fitAddon.fit();
                    
                    // Handle Resize
                    window.addEventListener('resize', () => fitAddon.fit());
                }

                path = `api/proxy/api2/json/nodes/${node}/lxc/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;
                const url = `${protocol}//${host}/${path}`;
                
                const socket = new WebSocket(url);
                socket.binaryType = 'arraybuffer';

                socket.onopen = () => {
                    setStatus('connected');
                    // 1. Auth: username:ticket
                    const authStr = `${data.user}:${ticket}\n`;
                    socket.send(authStr);
                    
                    // 2. Resize to initial fit
                    fitAddon.fit();
                    term.focus(); 
                    
                    const cols = term.cols;
                    const rows = term.rows;
                    // Protocol: "1:cols:rows:"
                    const resizeStr = `1:${cols}:${rows}:`;
                    socket.send(resizeStr);

                    // 3. Force Repaint/Prompt by sending Ctrl+L (Clear Screen) to avoid double prompt
                    setTimeout(() => {
                        if (socket.readyState === WebSocket.OPEN) {
                             socket.send("0:1:\u000C");
                        }
                    }, 500);
                };

                socket.onmessage = (event) => {
                    if (event.data instanceof ArrayBuffer) {
                         const u8 = new Uint8Array(event.data);
                         term.write(u8);
                    } else {
                         term.write(event.data);
                    }
                };

                socket.onclose = (event) => {
                    setStatus('disconnected');
                };
                socket.onerror = (err) => {
                    console.error("[Xterm] WebSocket Error", err);
                    setError('WebSocket Error');
                    setStatus('error');
                };

                term.onData((data) => {
                    if (socket.readyState === WebSocket.OPEN) {
                        // Protocol: "0:length:data"
                        // We must encode the length of the string
                        const msg = `0:${data.length}:${data}`;
                        socket.send(msg);
                    }
                });
                
                // Handle Resize Protocol
                const handleResize = () => {
                    fitAddon.fit();
                    if (socket.readyState === WebSocket.OPEN) {
                        const cols = term.cols;
                        const rows = term.rows;
                        socket.send(`1:${cols}:${rows}:`);
                    }
                };
                window.addEventListener('resize', handleResize);
                
                // Store in ref for cleanup
                rfbRef.current = {
                    disconnect: () => {
                        window.removeEventListener('resize', handleResize);
                        socket.close();
                        term.dispose();
                    },
                    dispose: () => {
                         window.removeEventListener('resize', handleResize);
                         term.dispose();
                    },         
                    sendCtrlAltDel: () => {
                         console.warn("Ctrl-Alt-Del not supported in Xterm mode yet");
                    },
                    sendKey: () => {},
                    focus: () => term.focus(),
                    sendText: (text: string) => {
                         if (socket.readyState === WebSocket.OPEN) {
                            const msg = `0:${text.length}:${text}`;
                            socket.send(msg);
                         }
                    }
                };

            } else {
                // NOVNC Logic (Existing)
                // @ts-expect-error - novnc-next types are missing
                const { default: RFB } = await import('novnc-next');
                
                path = `api/proxy/api2/json/nodes/${node}/${type}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;
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
                    // Monkey Patch sendText
                    (rfbRef.current as any).sendText = (text: string) => {
                        for (let i = 0; i < text.length; i++) {
                             const charCode = text.charCodeAt(i);
                             rfb.sendKey(charCode, '', true);
                             rfb.sendKey(charCode, '', false);
                        }
                    };
                }
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
  
  // Trigger resize when toolbar visibility changes to fill the gap
  useEffect(() => {
      const timer = setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
      }, 350); 
      return () => clearTimeout(timer);
  }, [showToolbar]);
  
  const activateKeyboard = () => {
      console.log("[Keyboard] Manual Activation Triggered");
      // Focus Proxy Input
      if (proxyInputRef.current) {
          proxyInputRef.current.focus({ preventScroll: true });
          proxyInputRef.current.click();
      }
  };

  const sendCtrlAltDel = () => {
      if(rfbRef.current) {
          if (typeof rfbRef.current.sendCtrlAltDel === 'function') {
              rfbRef.current.sendCtrlAltDel();
          }
      }
  }

  const sendKey = (keysym: number) => {
      if(!rfbRef.current || typeof rfbRef.current.sendKey !== 'function') return;
      rfbRef.current.sendKey(keysym, '', true); // Down
      setTimeout(() => {
          if(rfbRef.current) rfbRef.current.sendKey(keysym, '', false); // Up
      }, 100);
  };

  const toggleModifier = (keysym: number, active: boolean, setActive: (v: boolean) => void) => {
      if(!rfbRef.current || typeof rfbRef.current.sendKey !== 'function') return;
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
      <div className={`absolute top-0 left-0 right-0 z-50 bg-gray-800/95 backdrop-blur-sm px-2 flex justify-between items-center border-b border-gray-700 transition-transform duration-300 ease-in-out h-12 ${showToolbar ? 'translate-y-0' : '-translate-y-full'} overflow-x-auto overflow-y-hidden no-scrollbar`}>
        <div className="flex items-center space-x-4 shrink-0">
            {/* Header / Status - No Back Button here */}
            <h1 className="font-bold text-white hidden lg:block whitespace-nowrap">
                Shared VM {vmData?.vmid ? `#${vmData.vmid}` : ''}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${status === 'connected' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                {status}
            </span>
             {/* Countdown Timer */}
             {timeLeftFormatted && (
                 <span className="text-xs font-mono text-yellow-500 border border-yellow-700/50 bg-yellow-900/20 px-2 py-0.5 rounded flex items-center shrink-0">
                     ⏱ {timeLeftFormatted}
                 </span>
             )}
        </div>

         {/* Extended Controls - Scrollable */}
         <div className="flex items-center space-x-2 ml-4 shrink-0">
             <button
                 onClick={activateKeyboard}
                 className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
                 title="Show Keyboard"
             >
                 ⌨️
             </button>
             <button 
                onClick={() => toggleModifier(KEY_CTRL, ctrlActive, setCtrlActive)}
                className={`px-3 py-1 rounded text-sm font-bold border shrink-0 ${ctrlActive ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-700 hover:bg-gray-600 border-gray-600'}`}
             >
                Ctrl
             </button>
             <button 
                onClick={() => toggleModifier(KEY_ALT, altActive, setAltActive)}
                className={`px-3 py-1 rounded text-sm font-bold border shrink-0 ${altActive ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-700 hover:bg-gray-600 border-gray-600'}`}
             >
                Alt
             </button>
             <button 
                onClick={() => sendKey(KEY_WIN)} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
                title="Windows Key"
             >
                Win
             </button>
             <button 
                onClick={() => sendKey(KEY_TAB)} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
                title="Tab"
             >
                Tab
             </button>
             <button 
                onClick={() => sendKey(KEY_ESC)} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
                title="Escape"
             >
                Esc
             </button>
            <button onClick={sendCtrlAltDel} className="bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm whitespace-nowrap shrink-0">
                Ctrl-Alt-Del
            </button>
            <button 
                onClick={toggleFullScreen} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
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

       {/* Proxy Input */}
      <input 
          ref={proxyInputRef}
          type="text"
          inputMode="text"
          className="fixed top-12 left-0 w-8 h-8 opacity-0 z-0 pointer-events-auto" 
          autoCorrect="off" 
          autoCapitalize="off" 
          spellCheck="false" 
          autoComplete="off"
          onChange={handleProxyInput}
          onKeyDown={handleProxyKeyDown}
      />
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
