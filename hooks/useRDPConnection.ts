import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getEnglishKeysym } from '@/lib/keyboard';

export interface RDPConnectionDetails {
  token?: string;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  vmName?: string;
  consoleType?: 'rdp' | 'ssh' | 'vnc';
}

export interface RemoteFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  mimetype: string;
}

export interface UploadProgressInfo {
  filename: string;
  progress: number;
  currentFileIndex?: number;
  totalFiles?: number;
}

export const getDefaultFilesystemPath = (consoleType?: string, username?: string): string => {
  if (consoleType === 'ssh') {
    const user = (username || '').trim().toLowerCase();
    if (!user || user === 'root') return '/root';
    return `/home/${user}`;
  }
  return '/';
};

export function useRDPConnection() {
  const [details, setDetails] = useState<RDPConnectionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);

  // Sequential Upload Queue & Stream Control
  const uploadQueueRef = useRef<{ file: File; targetPath: string }[]>([]);
  const isUploadingRef = useRef(false);
  const lastUploadedFolderRef = useRef<string>('/');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentStreamRef = useRef<any>(null);
  const isCancelledRef = useRef(false);
  const totalInBatchRef = useRef(1);
  const currentBatchIndexRef = useRef(1);

  // Filesystem Explorer state
  const [files, setFiles] = useState<RemoteFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [hasFilesystem, setHasFilesystem] = useState(false);

  const displayContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guacClientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tunnelRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeFilesystemRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guacModuleRef = useRef<any>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const hasInitializedRef = useRef(false);

  const connectGuacd = useCallback(
    async (connData: RDPConnectionDetails) => {
      // 1. Safely teardown previous client instance
      if (cleanupListenersRef.current) {
        cleanupListenersRef.current();
        cleanupListenersRef.current = null;
      }

      if (guacClientRef.current) {
        guacClientRef.current.onerror = null;
        guacClientRef.current.onstatechange = null;
        try {
          guacClientRef.current.disconnect();
        } catch {
          // ignore disconnect cleanup error
        }
        guacClientRef.current = null;
      }

      if (tunnelRef.current) {
        tunnelRef.current.onerror = null;
        try {
          tunnelRef.current.close();
        } catch {
          // ignore tunnel close error
        }
        tunnelRef.current = null;
      }

      setConnecting(true);
      setDisconnected(false);
      setError(null);
      setDisconnectReason(null);

      if (displayContainerRef.current) {
        displayContainerRef.current.innerHTML = '';
      }

      try {
        // Dynamically import guacamole-common-js for browser context
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const guacModule = (await import('guacamole-common-js')) as any;
        guacModuleRef.current = guacModule;
        const Guacamole = guacModule.default || guacModule;

        const width = displayContainerRef.current?.clientWidth || window.innerWidth || 1920;
        const height = displayContainerRef.current?.clientHeight || window.innerHeight || 1080;
        const dpi = Math.round((window.devicePixelRatio || 1) * 96);

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsBaseUrl = `${wsProtocol}//${window.location.host}/ws/guacd`;

        let connectData = '';
        if (connData.token) {
          connectData = `token=${encodeURIComponent(connData.token)}&width=${width}&height=${height}&dpi=${dpi}`;
        } else if (connData.hostname) {
          connectData = `hostname=${encodeURIComponent(connData.hostname)}&port=${connData.port || 3389}&username=${encodeURIComponent(connData.username || 'Administrator')}&password=${encodeURIComponent(connData.password || '')}&width=${width}&height=${height}&dpi=${dpi}`;
        } else {
          throw new Error('No target hostname or session token provided.');
        }

        const tunnel = new Guacamole.WebSocketTunnel(wsBaseUrl);
        tunnelRef.current = tunnel;

        const client = new Guacamole.Client(tunnel);
        guacClientRef.current = client;

        // Display setup
        const display = client.getDisplay();
        const displayEl = display.getElement();

        displayEl.style.position = 'absolute';
        displayEl.style.left = '50%';
        displayEl.style.top = '50%';
        displayEl.style.transform = 'translate(-50%, -50%)';

        if (displayContainerRef.current) {
          displayContainerRef.current.appendChild(displayEl);
        }

        let pointerBounds = displayEl.getBoundingClientRect();
        let pointerScale = display.getScale() || 1;
        let lastSentWidth = 0;
        let lastSentHeight = 0;

        const handleResize = (sendRemoteSize = true) => {
          if (!displayContainerRef.current || !guacClientRef.current) return;
          const containerW = displayContainerRef.current.clientWidth;
          const containerH = displayContainerRef.current.clientHeight;
          const dispW = display.getWidth() || width;
          const dispH = display.getHeight() || height;

          if (containerW > 0 && containerH > 0 && dispW > 0 && dispH > 0) {
            const scale = Math.min(containerW / dispW, containerH / dispH);
            display.scale(scale);
            pointerScale = scale || 1;
            pointerBounds = displayEl.getBoundingClientRect();

            if (sendRemoteSize && (containerW !== lastSentWidth || containerH !== lastSentHeight)) {
              lastSentWidth = containerW;
              lastSentHeight = containerH;
              client.sendSize(containerW, containerH);
            }
          }
        };

        const resizeObserver = new ResizeObserver(() => {
          handleResize(true);
        });
        if (displayContainerRef.current) {
          resizeObserver.observe(displayContainerRef.current);
        }

        display.onresize = () => {
          handleResize(false);
        };

        let resizeTimer: NodeJS.Timeout;
        const debouncedResize = () => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => handleResize(true), 250);
        };
        window.addEventListener('resize', debouncedResize);

        // Mouse input binding
        let mouseRafId: number | null = null;
        let pendingMouseEvent: MouseEvent | null = null;
        let autoScrollTimer: NodeJS.Timeout | null = null;

        const stopAutoScroll = () => {
          if (autoScrollTimer) {
            clearInterval(autoScrollTimer);
            autoScrollTimer = null;
          }
        };

        const sendMouseEvent = (e: MouseEvent) => {
          if (!guacClientRef.current) return;
          const mouseX = Math.floor((e.clientX - pointerBounds.left) / pointerScale);
          const mouseY = Math.floor((e.clientY - pointerBounds.top) / pointerScale);

          const left = (e.buttons & 1) !== 0;
          const middle = (e.buttons & 4) !== 0;
          const right = (e.buttons & 2) !== 0;

          const mouseState = new Guacamole.Mouse.State(mouseX, mouseY, left, middle, right, false, false);
          client.sendMouseState(mouseState);

          // Auto-scroll when dragging left-click near or past boundaries (e.g. text selection in SSH/terminal)
          if (left) {
            const displayH = client.getDisplay()?.getHeight() || 600;
            const isNearTop = mouseY <= 25;
            const isNearBottom = mouseY >= displayH - 25;

            if (isNearTop || isNearBottom) {
              if (!autoScrollTimer) {
                autoScrollTimer = setInterval(() => {
                  if (!guacClientRef.current) return;
                  const isUp = isNearTop;
                  const scrollPress = new Guacamole.Mouse.State(mouseX, mouseY, true, false, false, isUp, !isUp);
                  const scrollRelease = new Guacamole.Mouse.State(mouseX, mouseY, true, false, false, false, false);
                  client.sendMouseState(scrollPress);
                  client.sendMouseState(scrollRelease);
                }, 80);
              }
            } else {
              stopAutoScroll();
            }
          } else {
            stopAutoScroll();
          }
        };

        const processPendingMouseEvent = () => {
          mouseRafId = null;
          if (!pendingMouseEvent || !guacClientRef.current) return;
          sendMouseEvent(pendingMouseEvent);
          pendingMouseEvent = null;
        };

        const handleMouseMove = (e: MouseEvent) => {
          pendingMouseEvent = e;
          if (mouseRafId === null) {
            mouseRafId = requestAnimationFrame(processPendingMouseEvent);
          }
        };

        const flushPendingMouseEvent = (e: MouseEvent) => {
          if (mouseRafId !== null) {
            cancelAnimationFrame(mouseRafId);
            mouseRafId = null;
          }
          pendingMouseEvent = null;
          sendMouseEvent(e);
          if ((e.buttons & 1) === 0) {
            stopAutoScroll();
          }
        };

        const handleMouseDown = (e: MouseEvent) => {
          flushPendingMouseEvent(e);
          if (displayContainerRef.current) displayContainerRef.current.focus();
        };

        const handleContextMenu = (e: MouseEvent) => e.preventDefault();

        const handleWheel = (e: WheelEvent) => {
          e.preventDefault();
          if (!guacClientRef.current) return;
          const mouseX = Math.floor((e.clientX - pointerBounds.left) / pointerScale);
          const mouseY = Math.floor((e.clientY - pointerBounds.top) / pointerScale);

          const isUp = e.deltaY < 0;
          const pressState = new Guacamole.Mouse.State(mouseX, mouseY, false, false, false, isUp, !isUp);
          const releaseState = new Guacamole.Mouse.State(mouseX, mouseY, false, false, false, false, false);
          client.sendMouseState(pressState);
          client.sendMouseState(releaseState);
        };

        displayEl.addEventListener('mousemove', handleMouseMove);
        displayEl.addEventListener('mousedown', handleMouseDown);
        displayEl.addEventListener('mouseup', flushPendingMouseEvent);
        displayEl.addEventListener('contextmenu', handleContextMenu);
        displayEl.addEventListener('wheel', handleWheel, { passive: false });

        // Global mouseup/mousemove listeners to maintain smooth drag selection outside canvas
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', flushPendingMouseEvent);

        // Keyboard input binding
        const pressedKeys = new Map<string, number>();
        const keyboard = new Guacamole.Keyboard(document);

        let activeEvent: KeyboardEvent | null = null;
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
          activeEvent = e;
        };
        const handleGlobalKeyUp = (e: KeyboardEvent) => {
          activeEvent = e;
        };
        window.addEventListener('keydown', handleGlobalKeyDown, true);
        window.addEventListener('keyup', handleGlobalKeyUp, true);

        keyboard.onkeydown = (keysym: number) => {
          let resolvedKeysym = keysym;
          if (activeEvent) {
            const hasModifier = activeEvent.ctrlKey || activeEvent.altKey || activeEvent.metaKey;
            if (hasModifier && keysym > 127) {
              const englishKeysym = getEnglishKeysym(activeEvent.code, activeEvent.shiftKey);
              if (englishKeysym !== null) {
                resolvedKeysym = englishKeysym;
              }
            }
            pressedKeys.set(activeEvent.code, resolvedKeysym);
          }
          client.sendKeyEvent(1, resolvedKeysym);
        };

        keyboard.onkeyup = (keysym: number) => {
          let resolvedKeysym = keysym;
          if (activeEvent) {
            if (pressedKeys.has(activeEvent.code)) {
              resolvedKeysym = pressedKeys.get(activeEvent.code)!;
              pressedKeys.delete(activeEvent.code);
            }
          }
          client.sendKeyEvent(0, resolvedKeysym);
        };

        // Bidirectional Clipboard synchronization
        let lastLocalClipboard = '';
        let lastRemoteClipboard = '';

        const sendClipboardToRemote = (text: string) => {
          if (!guacClientRef.current || !text) return;
          if (text === lastRemoteClipboard) return;
          lastLocalClipboard = text;
          try {
            const stream = guacClientRef.current.createClipboardStream('text/plain');
            const writer = new Guacamole.StringWriter(stream);
            writer.sendText(text);
            writer.sendEnd();
          } catch (err) {
            console.warn('[Clipboard] Error sending clipboard to remote:', err);
          }
        };

        const syncLocalClipboardToRemote = async () => {
          try {
            if (!navigator.clipboard?.readText) return;
            const text = await navigator.clipboard.readText();
            if (text && text !== lastLocalClipboard && text !== lastRemoteClipboard) {
              sendClipboardToRemote(text);
            }
          } catch {
            // Clipboard read permission might not be granted or window unfocused
          }
        };

        const handleLocalPaste = (e: ClipboardEvent) => {
          const text = e.clipboardData?.getData('text/plain');
          if (text) {
            sendClipboardToRemote(text);
          }
        };

        const handleWindowFocus = () => {
          syncLocalClipboardToRemote();
        };

        window.addEventListener('focus', handleWindowFocus);
        document.addEventListener('paste', handleLocalPaste);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.onclipboard = (stream: any, mimetype: string) => {
          if (!mimetype || !mimetype.startsWith('text/plain')) return;
          let text = '';
          const reader = new Guacamole.StringReader(stream);
          reader.ontext = (chunk: string) => {
            text += chunk;
          };
          reader.onend = async () => {
            if (!text) return;
            lastRemoteClipboard = text;
            lastLocalClipboard = text;
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
              }
            } catch (err) {
              console.warn('[Clipboard] Failed to write to local clipboard:', err);
            }
          };
        };

        // Remote virtual filesystem attached (for Shared Files drive or SFTP)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.onfilesystem = (object: any) => {
          activeFilesystemRef.current = object;
          setHasFilesystem(true);
          const initialPath = getDefaultFilesystemPath(connData.consoleType, connData.username);
          setCurrentPath(initialPath);
          fetchFiles(initialPath);
        };

        // Listen for rotating reconnect token from server (One-Time Token rotation)
        client.onmsg = (msgid: number, parameters: string[]) => {
          if (msgid === 100 && parameters && parameters[0]) {
            const freshReconnectToken = parameters[0];
            setDetails((prev) => (prev ? { ...prev, token: freshReconnectToken } : prev));
          }
          return true;
        };

        // File download from remote session (unsolicited stream from /Download folder)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.onfile = (stream: any, mimetype: string, filename: string) => {
          const reader = new Guacamole.BlobReader(stream, mimetype);
          stream.sendAck('OK', 0x0000); // Acknowledge stream acceptance so guacd pumps file blobs
          reader.onend = () => {
            const blob = reader.getBlob();
            const blobUrl = URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = blobUrl;
            downloadLink.download = filename || 'downloaded-file';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          };
        };

        // Cleanup
        cleanupListenersRef.current = () => {
          if (mouseRafId !== null) {
            cancelAnimationFrame(mouseRafId);
          }
          clearTimeout(resizeTimer);
          resizeObserver.disconnect();
          window.removeEventListener('keydown', handleGlobalKeyDown, true);
          window.removeEventListener('keyup', handleGlobalKeyUp, true);
          window.removeEventListener('focus', handleWindowFocus);
          displayEl.removeEventListener('mousemove', handleMouseMove);
          displayEl.removeEventListener('mousedown', handleMouseDown);
          displayEl.removeEventListener('mouseup', flushPendingMouseEvent);
          displayEl.removeEventListener('contextmenu', handleContextMenu);
          displayEl.removeEventListener('wheel', handleWheel);
          document.removeEventListener('paste', handleLocalPaste);
          window.removeEventListener('resize', debouncedResize);
        };

        client.onstatechange = (state: number) => {
          if (state === 3) {
            setConnecting(false);
            setTimeout(handleResize, 100);
            setTimeout(handleResize, 500);
          } else if (state === 4 || state === 5) {
            setConnecting(false);
            setDisconnected(true);
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.onerror = (errObj: any) => {
          const code = errObj?.code ?? errObj?.statusCode ?? 'unknown';
          const msg = errObj?.message || errObj?.statusMessage || `Remote connection error (code: ${code})`;
          console.error('[Guacamole Client Error]:', { code, msg, errObj });
          setConnecting(false);
          setDisconnected(true);
          setDisconnectReason(msg);
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tunnel.onerror = (status: any) => {
          const code = status?.code ?? 'unknown';
          const msg = status?.message || `WebSocket tunnel error (code: ${code})`;
          console.error('[Guacamole Tunnel Error]:', { code, msg, status });
          setConnecting(false);
          setDisconnected(true);
          setDisconnectReason(msg);
        };

        // Connect
        client.connect(connectData);

        if (displayContainerRef.current) {
          displayContainerRef.current.focus();
        }
      } catch (err) {
        console.error('Failed to initialize Guacamole client:', err);
        const message = `Failed to initialize RDP console: ${err instanceof Error ? err.message : String(err)}`;
        setError(message);
        setConnecting(false);
      }
    },
    []
  );

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    try {
      const initParams = new URLSearchParams(window.location.search);
      const tokenParam = initParams.get('token');
      const titleParam = initParams.get('title') || 'Remote Console';
      const protoParam = (initParams.get('proto') || 'rdp') as 'rdp' | 'ssh' | 'vnc';
      const userParam = initParams.get('user') || '';

      if (tokenParam) {
        const initialPath = getDefaultFilesystemPath(protoParam, userParam);
        setCurrentPath(initialPath);

        const connectionData: RDPConnectionDetails = {
          token: tokenParam,
          vmName: titleParam,
          consoleType: protoParam,
          username: userParam,
        };
        setDetails(connectionData);
        connectGuacd(connectionData);

        // URL Cleansing: Clean all query parameters from address bar and history
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } else {
        setError('No session token provided. Please connect from the VM manager dashboard.');
        setConnecting(false);
      }
    } catch (err) {
      console.error('Failed to parse connection token:', err);
      setError('Failed to decode connection token.');
      setConnecting(false);
    }

    return () => {
      if (cleanupListenersRef.current) {
        cleanupListenersRef.current();
        cleanupListenersRef.current = null;
      }
      if (guacClientRef.current) {
        guacClientRef.current.onerror = null;
        guacClientRef.current.onstatechange = null;
        try {
          guacClientRef.current.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }, [connectGuacd]);

  const sendSpecialKey = useCallback((keysyms: number[]) => {
    if (!guacClientRef.current) return;
    // Press all keys
    for (const keysym of keysyms) {
      guacClientRef.current.sendKeyEvent(1, keysym);
    }
    // Release all keys in reverse
    setTimeout(() => {
      if (!guacClientRef.current) return;
      for (let i = keysyms.length - 1; i >= 0; i--) {
        guacClientRef.current.sendKeyEvent(0, keysyms[i]);
      }
    }, 100);
  }, []);

  const handleReconnect = useCallback(() => {
    if (details) {
      connectGuacd(details);
    }
  }, [details, connectGuacd]);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const cancelUpload = useCallback(() => {
    isCancelledRef.current = true;
    if (currentStreamRef.current) {
      try {
        currentStreamRef.current.sendEnd();
      } catch {
        // ignore
      }
      currentStreamRef.current = null;
    }
    uploadQueueRef.current = [];
    isUploadingRef.current = false;
    setUploadProgress(null);
  }, []);

  const processNextInQueue = useCallback(() => {
    if (uploadQueueRef.current.length === 0) {
      isUploadingRef.current = false;
      if (activeFilesystemRef.current) {
        fetchFiles(lastUploadedFolderRef.current || currentPath);
      }
      setTimeout(() => {
        setUploadProgress(null);
      }, 1200);
      return;
    }

    isUploadingRef.current = true;
    isCancelledRef.current = false;
    const { file, targetPath } = uploadQueueRef.current.shift()!;
    lastUploadedFolderRef.current = targetPath;
    const currentIndex = currentBatchIndexRef.current++;
    const totalFiles = totalInBatchRef.current;

    const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_SIZE) {
      alert(`File size exceeds 100MB limit: ${file.name}`);
      processNextInQueue();
      return;
    }

    if (!guacClientRef.current) {
      isUploadingRef.current = false;
      setUploadProgress(null);
      return;
    }

    setUploadProgress({
      filename: file.name,
      progress: 0,
      currentFileIndex: currentIndex,
      totalFiles: totalFiles,
    });

    const cleanDir = targetPath === '/' ? '' : targetPath.replace(/\/$/, '');
    const fullPath = `${cleanDir}/${file.name}`;
    const mimetype = file.type || 'application/octet-stream';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stream: any;
    if (activeFilesystemRef.current && typeof activeFilesystemRef.current.createOutputStream === 'function') {
      stream = activeFilesystemRef.current.createOutputStream(mimetype, fullPath);
    } else {
      stream = guacClientRef.current.createFileStream(mimetype, file.name);
    }

    currentStreamRef.current = stream;
    const chunkSize = 6048; // Max allowed raw bytes per Guacamole protocol instruction limit (8192 bytes)
    let offset = 0;

    // Track server status or errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream.onack = (status: any) => {
      if (status.isError()) {
        console.error('Upload stream error from server:', status.message);
        alert(`Upload failed for ${file.name}: ${status.message}`);
        isCancelledRef.current = true;
        currentStreamRef.current = null;
        processNextInQueue();
      }
    };

    const pump = () => {
      if (isCancelledRef.current) {
        currentStreamRef.current = null;
        return;
      }

      if (offset >= file.size) {
        try {
          stream.sendEnd();
        } catch {
          // ignore
        }
        currentStreamRef.current = null;
        setUploadProgress({
          filename: file.name,
          progress: 100,
          currentFileIndex: currentIndex,
          totalFiles: totalFiles,
        });
        setTimeout(() => {
          processNextInQueue();
        }, 150);
        return;
      }

      // Stream a burst of 8 chunks (~48KB) sequentially per event loop tick
      const burstLimit = Math.min(offset + chunkSize * 8, file.size);

      const readNextChunkInBurst = () => {
        if (isCancelledRef.current) {
          currentStreamRef.current = null;
          return;
        }

        if (offset >= burstLimit || offset >= file.size) {
          const percent = Math.min(Math.round((offset / file.size) * 100), 99);
          setUploadProgress({
            filename: file.name,
            progress: percent,
            currentFileIndex: currentIndex,
            totalFiles: totalFiles,
          });

          if (offset < file.size && !isCancelledRef.current) {
            setTimeout(pump, 15);
          } else if (offset >= file.size && !isCancelledRef.current) {
            pump();
          }
          return;
        }

        const currentSliceLength = Math.min(chunkSize, file.size - offset);
        const slice = file.slice(offset, offset + currentSliceLength);
        const reader = new FileReader();
        reader.onload = (e) => {
          if (isCancelledRef.current) return;
          const dataUrl = e.target?.result;
          if (typeof dataUrl === 'string') {
            const commaIdx = dataUrl.indexOf(',');
            const base64 = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : dataUrl;
            try {
              stream.sendBlob(base64);
            } catch (err) {
              console.error('[Upload] sendBlob error:', err);
            }
            offset += currentSliceLength;
            readNextChunkInBurst();
          }
        };
        reader.readAsDataURL(slice);
      };

      readNextChunkInBurst();
    };

    // Begin pumping chunks
    pump();
  }, []);

  const queueFilesForUpload = useCallback(
    (filesToUpload: File[], customTargetDir?: string) => {
      if (filesToUpload.length === 0) return;

      const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB limit
      const validFiles: File[] = [];
      const oversizeFiles: string[] = [];

      for (const file of filesToUpload) {
        if (file.size > MAX_UPLOAD_SIZE) {
          oversizeFiles.push(file.name);
        } else {
          validFiles.push(file);
        }
      }

      if (oversizeFiles.length > 0) {
        alert(`File size exceeds 100MB limit: ${oversizeFiles.join(', ')}`);
      }

      if (validFiles.length === 0) return;

      if (!isUploadingRef.current) {
        totalInBatchRef.current = validFiles.length;
        currentBatchIndexRef.current = 1;
      } else {
        totalInBatchRef.current += validFiles.length;
      }

      const targetDir = customTargetDir || currentPath || '/';
      uploadQueueRef.current.push(...validFiles.map((file) => ({ file, targetPath: targetDir })));

      if (!isUploadingRef.current) {
        processNextInQueue();
      }
    },
    [processNextInQueue, currentPath]
  );

  const uploadFile = useCallback(
    (file: File, customTargetDir?: string) => {
      queueFilesForUpload([file], customTargetDir);
    },
    [queueFilesForUpload]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!connecting && !disconnected) {
        setIsDragging(true);
      }
    },
    [connecting, disconnected]
  );

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (connecting || disconnected) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        queueFilesForUpload(files);
      }
    },
    [connecting, disconnected, queueFilesForUpload]
  );

  const fetchFiles = useCallback((path: string = '/') => {
    if (!activeFilesystemRef.current || !guacModuleRef.current) {
      console.warn('[Guacamole] fetchFiles called before activeFilesystem was attached.');
      setLoadingFiles(false);
      return;
    }
    const Guacamole = guacModuleRef.current.default || guacModuleRef.current;
    if (!Guacamole) {
      setLoadingFiles(false);
      return;
    }

    setLoadingFiles(true);

    // Safety timeout: if virtual drive stream doesn't respond within 4s, stop spinner
    const timeoutId = setTimeout(() => {
      console.warn('[Guacamole] fetchFiles stream timed out.');
      setLoadingFiles(false);
    }, 4000);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeFilesystemRef.current.requestInputStream(path, (stream: any) => {
        clearTimeout(timeoutId);
        const reader = new Guacamole.JSONReader(stream);
        stream.sendAck('OK', 0x0000); // Acknowledge directory index stream
        reader.onend = () => {
          const json = reader.getJSON();
          const items: RemoteFileItem[] = [];
          if (json && typeof json === 'object') {
            for (const [key, value] of Object.entries(json)) {
              const valStr = String(value);
              const isDir = valStr.includes('directory') || valStr.includes('stream-index');
              const fileName = key.replace(/\/$/, '').split('/').pop() || key;
              if (fileName && fileName !== '.' && fileName !== '..') {
                const cleanPath = key.startsWith('/') ? key : `${path === '/' ? '' : path}/${key}`;
                items.push({
                  name: fileName,
                  path: cleanPath,
                  isDirectory: isDir,
                  mimetype: valStr,
                });
              }
            }
          }
          items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
          setFiles(items);
          setCurrentPath(path);
          setLoadingFiles(false);
        };
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to request file list:', err);
      setLoadingFiles(false);
    }
  }, []);

  const downloadFile = useCallback((item: RemoteFileItem) => {
    if (!activeFilesystemRef.current || !guacModuleRef.current) return;
    const Guacamole = guacModuleRef.current.default || guacModuleRef.current;
    if (!Guacamole) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeFilesystemRef.current.requestInputStream(item.path, (stream: any, mimetype: string) => {
        const reader = new Guacamole.BlobReader(stream, mimetype);
        stream.sendAck('OK', 0x0000); // Acknowledge file stream download
        reader.onend = () => {
          const blob = reader.getBlob();
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = item.name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        };
      });
    } catch (err) {
      console.error('Download file error:', err);
    }
  }, []);

  return {
    details,
    connecting,
    disconnected,
    disconnectReason,
    isDragging,
    uploadProgress,
    files,
    loadingFiles,
    currentPath,
    hasFilesystem,
    fetchFiles,
    downloadFile,
    uploadFile,
    cancelUpload,
    displayContainerRef,
    sendSpecialKey,
    handleReconnect,
    handleToggleFullscreen,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    error,
  };
}
