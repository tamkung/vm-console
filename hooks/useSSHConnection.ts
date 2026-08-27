'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteFileItem, UploadProgressInfo, getDefaultFilesystemPath } from './useRDPConnection';

export interface SSHConnectionDetails {
  token?: string;
  vmName?: string;
  username?: string;
}

export function useSSHConnection() {
  const [details, setDetails] = useState<SSHConnectionDetails | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Terminal refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const terminalRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  // SFTP state
  const [files, setFiles] = useState<RemoteFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [hasFilesystem, setHasFilesystem] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);

  // Upload Queue & Streaming
  const uploadQueueRef = useRef<{ file: File; targetPath: string }[]>([]);
  const isUploadingRef = useRef(false);
  const isCancelledRef = useRef(false);
  const currentUploadIdRef = useRef<string | null>(null);
  const totalInBatchRef = useRef(1);
  const currentBatchIndexRef = useRef(1);
  const lastUploadedFolderRef = useRef<string>('/');

  // Pending SFTP request callbacks (id -> resolve/reject)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sftpPendingRequests = useRef<Map<string, (res: any) => void>>(new Map());
  const activeDownloads = useRef<Map<string, { filename: string; chunks: BlobPart[] }>>(new Map());

  // Establish connection
  const connectSSH = useCallback(async (connData: SSHConnectionDetails) => {
    if (!connData.token) return;

    setConnecting(true);
    setDisconnected(false);
    setDisconnectReason(null);
    setError(null);

    // Close previous connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws/ssh?token=${encodeURIComponent(connData.token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useSSHConnection] WebSocket connected to SSH tunnel');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'ready') {
          setConnecting(false);
          // Sync window size on ready
          if (terminalRef.current && fitAddonRef.current) {
            fitAddonRef.current.fit();
            ws.send(JSON.stringify({
              type: 'resize',
              cols: terminalRef.current.cols,
              rows: terminalRef.current.rows,
            }));
          }
        } else if (msg.type === 'data') {
          if (terminalRef.current && msg.data) {
            terminalRef.current.write(msg.data);
          }
        } else if (msg.type === 'reconnect_token') {
          const freshToken = msg.token;
          setDetails((prev) => (prev ? { ...prev, token: freshToken } : prev));
        } else if (msg.type === 'sftp_ready') {
          setHasFilesystem(true);
          const defaultPath = getDefaultFilesystemPath('ssh', connData.username);
          setCurrentPath(defaultPath);
          fetchFiles(defaultPath);
        } else if (msg.type === 'sftp_list_res') {
          const callback = sftpPendingRequests.current.get(msg.id);
          if (callback) {
            sftpPendingRequests.current.delete(msg.id);
            callback(msg);
          }
        } else if (msg.type === 'sftp_read_chunk') {
          const download = activeDownloads.current.get(msg.id);
          if (download) {
            if (msg.data) {
              const binary = atob(msg.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              download.chunks.push(bytes);
            }
            if (msg.done) {
              activeDownloads.current.delete(msg.id);
              const blob = new Blob(download.chunks, { type: 'application/octet-stream' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = download.filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
          }
        } else if (msg.type === 'sftp_write_res') {
          const callback = sftpPendingRequests.current.get(msg.id);
          if (callback) {
            sftpPendingRequests.current.delete(msg.id);
            callback(msg);
          }
        } else if (msg.type === 'error') {
          setError(msg.message);
          setConnecting(false);
          setDisconnected(true);
          setDisconnectReason(msg.message);
        } else if (msg.type === 'disconnected') {
          setConnecting(false);
          setDisconnected(true);
          setDisconnectReason(msg.reason || 'SSH disconnected');
        }
      } catch (err) {
        console.error('[useSSHConnection] Failed to parse message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[useSSHConnection] WebSocket error:', err);
    };

    ws.onclose = (event) => {
      console.log('[useSSHConnection] WebSocket closed:', event.code, event.reason);
      setConnecting(false);
      setDisconnected(true);
      if (event.reason) {
        setDisconnectReason(event.reason);
      }
    };
  }, []);

  // Initialize xterm.js Terminal instance dynamically on client
  useEffect(() => {
    if (!terminalContainerRef.current) return;
    if (terminalRef.current) return;

    let isMounted = true;
    let termInstance: any = null;
    let fitInstance: any = null;
    let resizeTimer: NodeJS.Timeout;

    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (fitInstance && termInstance && wsRef.current?.readyState === WebSocket.OPEN) {
          fitInstance.fit();
          wsRef.current.send(
            JSON.stringify({
              type: 'resize',
              cols: termInstance.cols,
              rows: termInstance.rows,
            })
          );
        }
      }, 150);
    };

    (async () => {
      try {
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('xterm-addon-fit');
        await import('xterm/css/xterm.css');

        if (!isMounted || !terminalContainerRef.current) return;

        const term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          scrollback: 10000,
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", Consolas, monospace',
          theme: {
            background: '#0a0e17',
            foreground: '#e2e8f0',
            cursor: '#38bdf8',
            selectionBackground: 'rgba(56, 189, 248, 0.35)',
            black: '#1e293b',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#facc15',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#38bdf8',
            white: '#f8fafc',
          },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalContainerRef.current);
        fitAddon.fit();

        termInstance = term;
        fitInstance = fitAddon;
        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        // Send user keystrokes to WebSocket
        term.onData((data: string) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'data', data }));
          }
        });

        window.addEventListener('resize', handleResize);
      } catch (err) {
        console.error('[useSSHConnection] Failed to load xterm modules:', err);
      }
    })();

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      if (termInstance) {
        termInstance.dispose();
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const hasInitializedRef = useRef(false);

  // Parse query params and start connection on mount
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const title = params.get('title') || 'SSH Console';
      const user = params.get('user') || 'root';

      if (token) {
        const connData: SSHConnectionDetails = {
          token,
          vmName: title,
          username: user,
        };
        setDetails(connData);
        connectSSH(connData);

        // URL Cleansing
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } else {
        setError('No session token provided');
        setConnecting(false);
      }
    } catch (err) {
      console.error('Failed to parse SSH parameters:', err);
      setError('Failed to parse session token');
      setConnecting(false);
    }
  }, [connectSSH]);

  // SFTP: Fetch directory listing
  const fetchFiles = useCallback((path: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setLoadingFiles(true);
    setCurrentPath(path);

    const reqId = `list-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    sftpPendingRequests.current.set(reqId, (res) => {
      setLoadingFiles(false);
      if (res.error) {
        console.error('[SFTP] Directory list error:', res.error);
        alert(`Failed to list directory: ${res.error}`);
        return;
      }
      setFiles(res.files || []);
    });

    wsRef.current.send(JSON.stringify({ type: 'sftp_list', id: reqId, path }));
  }, []);

  // SFTP: Download file
  const downloadFile = useCallback((file: RemoteFileItem) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const reqId = `read-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    activeDownloads.current.set(reqId, { filename: file.name, chunks: [] });

    wsRef.current.send(JSON.stringify({ type: 'sftp_read', id: reqId, path: file.path }));
  }, []);

  // SFTP: Sequential Upload Processing
  const cancelUpload = useCallback(() => {
    isCancelledRef.current = true;
    if (currentUploadIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'sftp_write_abort', id: currentUploadIdRef.current }));
    }
    uploadQueueRef.current = [];
    isUploadingRef.current = false;
    currentUploadIdRef.current = null;
    setUploadProgress(null);
  }, []);

  const processNextInQueue = useCallback(() => {
    if (uploadQueueRef.current.length === 0) {
      isUploadingRef.current = false;
      currentUploadIdRef.current = null;
      fetchFiles(lastUploadedFolderRef.current || currentPath);
      setTimeout(() => setUploadProgress(null), 1200);
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

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      isUploadingRef.current = false;
      setUploadProgress(null);
      return;
    }

    const cleanDir = targetPath === '/' ? '' : targetPath.replace(/\/$/, '');
    const fullPath = `${cleanDir}/${file.name}`;
    const uploadId = `write-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    currentUploadIdRef.current = uploadId;

    setUploadProgress({
      filename: file.name,
      progress: 0,
      currentFileIndex: currentIndex,
      totalFiles,
    });

    // Start upload write stream on backend
    wsRef.current.send(JSON.stringify({ type: 'sftp_write_start', id: uploadId, path: fullPath }));

    const chunkSize = 32 * 1024; // 32KB per chunk for high throughput SFTP streaming
    let offset = 0;

    const pump = () => {
      if (isCancelledRef.current) return;

      if (offset >= file.size) {
        setUploadProgress({
          filename: file.name,
          progress: 100,
          currentFileIndex: currentIndex,
          totalFiles,
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const timeoutId = setTimeout(() => {
            processNextInQueue();
          }, 2500);

          sftpPendingRequests.current.set(uploadId, (res) => {
            clearTimeout(timeoutId);
            if (res.error) {
              alert(`Upload error: ${res.error}`);
            }
            setTimeout(() => processNextInQueue(), 150);
          });
          wsRef.current.send(JSON.stringify({ type: 'sftp_write_end', id: uploadId }));
        } else {
          processNextInQueue();
        }
        return;
      }

      const slice = file.slice(offset, offset + chunkSize);
      const reader = new FileReader();
      reader.onload = (e) => {
        if (isCancelledRef.current) return;
        const dataUrl = e.target?.result as string;
        if (typeof dataUrl === 'string') {
          const commaIdx = dataUrl.indexOf(',');
          const base64 = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : dataUrl;
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'sftp_write_chunk', id: uploadId, data: base64 }));
          }
          offset += chunkSize;
          const percent = Math.min(Math.round((offset / file.size) * 100), 99);
          setUploadProgress({
            filename: file.name,
            progress: percent,
            currentFileIndex: currentIndex,
            totalFiles,
          });
          setTimeout(pump, 10);
        }
      };
      reader.readAsDataURL(slice);
    };

    pump();
  }, [fetchFiles, currentPath]);

  const queueFilesForUpload = useCallback(
    (filesToUpload: File[], customTargetDir?: string) => {
      if (filesToUpload.length === 0) return;

      const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
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

  const sendSpecialKey = useCallback((sequence: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'data', data: sequence }));
    }
  }, []);

  const handleReconnect = useCallback(() => {
    if (details) {
      connectSSH(details);
    }
  }, [details, connectSSH]);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        queueFilesForUpload(droppedFiles);
      }
    },
    [queueFilesForUpload]
  );

  return {
    terminalContainerRef,
    details,
    connecting,
    disconnected,
    disconnectReason,
    error,
    currentPath,
    files,
    loadingFiles,
    hasFilesystem,
    uploadProgress,
    isDragging,
    fetchFiles,
    downloadFile,
    uploadFile,
    cancelUpload,
    sendSpecialKey,
    handleReconnect,
    handleToggleFullscreen,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
