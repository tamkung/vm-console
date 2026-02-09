'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';

// Dynamic import used inside component to avoid SSR window error

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
  focus?: () => void;
  sendText?: (text: string) => void;
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
  const proxyInputRef = useRef<HTMLInputElement>(null);
  
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  
  // Key States for Sticky Keys
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [localCursor, setLocalCursor] = useState(true); // Local cursor on/off toggle

  // Proxy Input State handling
  const handleProxyInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      // We initialize input with ' ' (space) or similar to detect backspace
      // But simple approach: just send what we got and reset.
      // Backspace detection requires knowing we lost a char.
      // Better strategy: Keep input empty.
      // If event is 'Input' with data?
      
      // Let's rely on valid input chars first.
      // For full backspace support on mobile web without messy hacks, we might need a dedicated hidden field with content.
      // Strategy: Value is always "_". If becomes "", it was backspace. If longer, it's char.
      
      // But simpler for now: Just forward typed chars.
      if (rfbRef.current?.sendText) {
          rfbRef.current.sendText(val);
      }
      e.target.value = ''; 
  };

  // Dedicated Backspace/Enter handling via onKeyDown (works on some mobile keyboards)
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
    if (!vmid || !node) {
      setError('Missing VMID or Node parameters');
      return;
    }

    const connect = async () => {
      try {
        const res = await fetch(`/api/console/${vmid}/ticket?node=${node}&type=${type}`, {
          method: 'POST',
        });

        if (!res.ok) {
           if (res.status === 401) {
               router.push('/');
               return;
           }
           const data = await res.json();
          throw new Error(data.error || 'Failed to get VNC ticket');
        }

        const data = await res.json();
        const { ticket, port, user } = data; // Ensure user is returned or available

        // Connect to local proxy
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host; 
        
        // Proxy Path: /api/proxy/api2/json/nodes/<node>/<type>/<vmid>/vncwebsocket
        const path = `api/proxy/api2/json/nodes/${node}/${type}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;
        const url = `${protocol}//${host}/${path}`;

        console.log('Connecting to (Proxy):', url);

        if (screenRef.current) {
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
                        foreground: '#ffffff',
                    }
                });
                
                const fitAddon = new FitAddon();
                term.loadAddon(fitAddon);

                // Clear previous content
                screenRef.current.innerHTML = '';
                term.open(screenRef.current);
                fitAddon.fit();

                const socket = new WebSocket(url);
                socket.binaryType = 'arraybuffer'; // Or 'blob', but we effectively use text/binary frames logic

                socket.onopen = () => {
                    setStatus('connected');
                    // 1. Auth: username:ticket
                    // Note: 'user' comes from ticket response? 
                    // API currently returns ...vncData.data. user is inside data?
                    // Let's check api/console/[vmid]/ticket/route.ts. 
                    // getVncProxy returns { ticket, port, upi, cert, user }.
                    // So data.user should be available.
                    
                    const authUser = user || 'root@pam'; // Fallback if missing, but should be there
                    const authStr = `${authUser}:${ticket}\n`;
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

                socket.onclose = () => setStatus('disconnected');
                socket.onerror = () => {
                    setError('WebSocket Error');
                    setStatus('error');
                };

                term.onData((inputData) => {
                    if (socket.readyState === WebSocket.OPEN) {
                        // Protocol: "0:length:data"
                        const msg = `0:${inputData.length}:${inputData}`;
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
                
                rfbRef.current = {
                    disconnect: () => {
                        window.removeEventListener('resize', handleResize);
                        socket.close();
                        term.dispose();
                    },
                    // Adapter for existing interface
                    sendCtrlAltDel: () => console.warn("Ctrl-Alt-Del not supported in Xterm"),
                    sendKey: () => {},
                    focus: () => term.focus(),
                    sendText: (text: string) => {
                         if (socket.readyState === WebSocket.OPEN) {
                            const msg = `0:${text.length}:${text}`;
                            socket.send(msg);
                         }
                    }
                } as any; // Cast to avoid strict interface mismatch if needed

             } else {
                 // NOVNC Logic
                 // @ts-expect-error - novnc-next types are missing
                 const { default: RFB } = await import('novnc-next');
                 
                const rfb = new RFB(
                    screenRef.current,
                    url,{
                        credentials: { password: ticket },
                    }
                );

                rfb.scaleViewport = true; 
                rfb.showDotCursor = true; // Always show dot cursor for local cursor visibility
                rfb.background = "#000000"; 

                rfb.addEventListener("connect",  () => {
                    setStatus('connected');
                    // Force default cursor on the noVNC canvas for better visibility
                    const canvas = screenRef.current?.querySelector('canvas');
                    if (canvas) {
                        canvas.style.cursor = 'default';
                    }
                });

                rfb.addEventListener("disconnect", () => {
                    setStatus('disconnected');
                });
                
                rfb.addEventListener("securityfailure", () => {
                     setError('Security failure/Auth failed');
                });
                 
                rfbRef.current = rfb;
                // Add extended methods to the instance if possible or wrapping it?
                // rfb instance is standard. We can monkey-patch or use a wrapper.
                // Let's monkey patch safely.
                (rfbRef.current as any).sendText = (text: string) => {
                    for (let i = 0; i < text.length; i++) {
                         const charCode = text.charCodeAt(i);
                         rfb.sendKey(charCode, '', true);
                         rfb.sendKey(charCode, '', false);
                    }
                };
             }
        }

      } catch (err: unknown) {
        console.error(err);
        const message = err instanceof Error ? err.message : 'Unknown error';
        
        // Handle 401 from fetch
        if (message.includes('401') || message.includes('Unauthorized')) {
             router.push('/');
             return;
        }

        setError(message);
        setStatus('error');
      }
    };

    connect();

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

  const activateKeyboard = () => {
      console.log("[Keyboard] Manual Activation Triggered");
      
      // Focus the Proxy Input (Primary Strategy for Mobile/Tablet)
      if (proxyInputRef.current) {
          proxyInputRef.current.focus({ preventScroll: true });
          proxyInputRef.current.click(); // Help trigger VK on some devices
      }
  };

  // Handle browser back or manual navigation
  const handleBack = () => {
    router.push('/dashboard');
  };

  // Trigger resize when toolbar visibility changes to fill the gap
  useEffect(() => {
      const timer = setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
      }, 350); // Wait for CSS transition (300ms)
      return () => clearTimeout(timer);
  }, [showToolbar]);
    
  // Send Ctrl+Alt+Del
  const sendCtrlAltDel = () => {
      if(rfbRef.current) {
          if (typeof rfbRef.current.sendCtrlAltDel === 'function') {
               rfbRef.current.sendCtrlAltDel();
          }
      }
  }

  // Helper to send keys
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

      <div className={`absolute top-0 left-0 right-0 z-50 bg-gray-800/95 backdrop-blur-sm px-2 flex justify-between items-center border-b border-gray-700 transition-transform duration-300 ease-in-out h-12 ${showToolbar ? 'translate-y-0' : '-translate-y-full'} overflow-x-auto overflow-y-hidden no-scrollbar`}>
        <div className="flex items-center space-x-4 shrink-0">
            <button 
                onClick={handleBack}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm shrink-0"
            >
                &larr; Back
            </button>
            <h1 className="font-bold text-white hidden lg:block whitespace-nowrap">Console: VM {vmid}</h1>
            <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${status === 'connected' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                {status}
            </span>
        </div>

         {/* Extended Controls - Scrollable area */}
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
                onClick={() => {
                    const canvas = screenRef.current?.querySelector('canvas') as HTMLCanvasElement;
                    if (canvas) {
                        const newState = !localCursor;
                        canvas.style.cursor = newState ? 'default' : 'none';
                        setLocalCursor(newState);
                    }
                }} 
                className={`px-3 py-1 rounded text-sm font-bold border shrink-0 ${localCursor ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-700 hover:bg-gray-600 border-gray-600'}`}
                title="Toggle Local Cursor"
             >
                🖱️ Cursor
             </button>
            <button 
                onClick={toggleFullScreen} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
                title="Toggle Full Screen"
            >
                ⛶
            </button>
             <button 
                onClick={async () => {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (!text) return;
                        
                        if (rfbRef.current?.sendText) {
                             rfbRef.current.sendText(text);
                             // If mobile keyboard input is active, might want to focus it back?
                             if(proxyInputRef.current) proxyInputRef.current.focus();
                        } else {
                            // Fallback for NoVNC if sendText isn't monkey-patched (should be though)
                             console.warn("sendText not available on rfb instance");
                        }
                    } catch (err) {
                        console.error('Failed to read clipboard:', err);
                        alert("Failed to read clipboard. Please check permissions.");
                    }
                }} 
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm border border-gray-600 shrink-0"
                title="Paste from Clipboard"
            >
                📋 Paste
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
      {/* 4. Proxy Input for Mobile Keyboard Support */}
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
