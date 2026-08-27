'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSSHConnection } from '@/hooks/useSSHConnection';
import FileManagerModal from '@/app/components/FileManagerModal';

function SSHConsoleContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openMode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      if (mode === 'new-tab' || window.opener || window.history.length <= 1) {
        return 'new-tab';
      }
    }
    return searchParams?.get('mode') || 'same-tab';
  });

  const [showToolbar, setShowToolbar] = useState(true);
  const [showFileManager, setShowFileManager] = useState(false);

  const {
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
  } = useSSHConnection();

  const handleBack = () => {
    if (openMode === 'new-tab') {
      window.close();
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div
      className="relative flex flex-col h-screen w-screen bg-[#0a0e17] overflow-hidden select-none font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Floating Toggle Button - only shown when toolbar is hidden */}
      {!showToolbar && (
        <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-[60] transition-opacity duration-300 opacity-30 hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowToolbar(true);
            }}
            className="bg-gray-800/90 hover:bg-gray-700 text-gray-400 hover:text-white px-3 py-0.5 rounded-b-lg border-b border-x border-gray-600 shadow-lg text-[10px] font-bold transition-all"
            title="Show Toolbar"
          >
            ▼ Show Controls
          </button>
        </div>
      )}

      {/* Top Controls Toolbar */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          showToolbar
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-full pointer-events-none'
        }`}
      >
        <div className="bg-gray-900/95 backdrop-blur-md border-b border-gray-800 px-3 py-1 flex items-center justify-between h-10 shadow-lg">
          {/* Left: Info & Back/Close */}
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleBack();
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors border border-gray-700"
              title={openMode === 'new-tab' ? 'Close Tab' : 'Back to Dashboard'}
            >
              {openMode === 'new-tab' ? (
                <>
                  <span className="text-xs font-bold text-gray-400">✕</span>
                  <span>Close</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  <span>Back</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-xs truncate max-w-[200px]">
                {details?.vmName || 'SSH Terminal'}
              </span>
              <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                xterm.js (Native SSH)
              </span>
            </div>
          </div>

          {/* Center: Hide Controls */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowToolbar(false);
            }}
            className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white px-3 py-1 rounded text-[10px] font-bold border border-gray-700 transition-colors"
            title="Hide Toolbar"
          >
            ▲ Hide Controls
          </button>

          {/* Right: Key Shortcuts & Actions */}
          <div className="flex items-center gap-1.5 flex-1 justify-end">
            <button
              onClick={() => sendSpecialKey('\x03')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Ctrl+C (Interrupt)"
            >
              Ctrl+C
            </button>
            <button
              onClick={() => sendSpecialKey('\x1a')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Ctrl+Z (Suspend)"
            >
              Ctrl+Z
            </button>
            <button
              onClick={() => sendSpecialKey('\t')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Tab (Autocomplete)"
            >
              Tab
            </button>
            <button
              onClick={() => sendSpecialKey('\x1b')}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Esc"
            >
              Esc
            </button>

            <div className="w-px h-4 bg-gray-700 mx-0.5" />

            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowFileManager(true);
                fetchFiles(currentPath);
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 py-1 rounded text-xs border border-gray-700 transition-colors flex items-center gap-1.5 font-medium"
              title="Browse, Upload & Download Files (SFTP)"
            >
              <span>📁</span> Files
            </button>

            <button
              onClick={handleReconnect}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs border border-gray-700 transition-colors"
              title="Reconnect"
            >
              🔄 Reconnect
            </button>

            <button
              onClick={handleToggleFullscreen}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs border border-gray-700 transition-colors"
              title="Fullscreen"
            >
              ⛶ Fullscreen
            </button>
          </div>
        </div>
      </div>

      {/* Main Terminal Viewport */}
      <main className={`relative flex-1 w-full h-full overflow-hidden bg-[#0a0e17] p-2 transition-all duration-300 ${showToolbar ? 'pt-10' : 'pt-0'}`}>
        <div
          ref={terminalContainerRef}
          className="w-full h-full overflow-hidden outline-none select-text"
        />

        {/* Loading / Connecting Overlay */}
        {connecting && (
          <div className="absolute inset-0 bg-[#0a0e17]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30 pointer-events-none">
            <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-gray-300 text-xs font-mono animate-pulse">Establishing SSH Session...</div>
          </div>
        )}

        {/* Error / Disconnected Overlay */}
        {disconnected && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-3 z-40">
            <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl max-w-sm w-full text-center shadow-2xl space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto text-2xl">
                ⚠️
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm mb-1">Session Disconnected</h3>
                <p className="text-gray-400 text-xs">{disconnectReason || error || 'Remote host closed connection'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReconnect}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-2 rounded transition-colors font-medium shadow-sm"
                >
                  Reconnect
                </button>
                <button
                  onClick={handleBack}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-2 rounded transition-colors"
                >
                  {openMode === 'new-tab' ? 'Close' : 'Back'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drag & Drop File Upload Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-40 bg-emerald-500/15 backdrop-blur-[2px] border-4 border-dashed border-emerald-500/60 flex flex-col items-center justify-center pointer-events-none">
            <div className="bg-gray-900/90 border border-gray-700 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-3 scale-110 transition-transform">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 text-3xl animate-bounce">
                📤
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-white mb-0.5">Drop Files to Upload (SFTP)</h3>
                <p className="text-gray-400 text-xs">Files will be transferred via SFTP (Max 100MB per file)</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating Upload Progress Bar (when modal is closed) */}
      {!showFileManager && uploadProgress && (
        <div className="fixed bottom-6 right-6 z-[70] bg-gray-900/95 border border-gray-700/80 p-3.5 rounded-xl shadow-2xl w-88 space-y-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between text-xs text-white">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
              <span className="text-emerald-400">⬆️</span>
              <span className="truncate font-medium">{uploadProgress.filename}</span>
              {uploadProgress.totalFiles && uploadProgress.totalFiles > 1 && (
                <span className="text-[10px] text-gray-400 font-mono flex-shrink-0 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">
                  {uploadProgress.currentFileIndex}/{uploadProgress.totalFiles}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-emerald-400 font-mono font-semibold">{uploadProgress.progress}%</span>
              <button
                onClick={cancelUpload}
                className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-800 hover:bg-red-900/60 hover:text-red-400 text-gray-400 text-xs transition-colors border border-gray-700 hover:border-red-700"
                title="Cancel upload"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden border border-gray-700/50">
            <div
              className="bg-emerald-500 h-full transition-all duration-100 rounded-full"
              style={{ width: `${uploadProgress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* SFTP Files Explorer Modal */}
      <FileManagerModal
        isOpen={showFileManager}
        onClose={() => setShowFileManager(false)}
        files={files}
        loading={loadingFiles}
        hasFilesystem={hasFilesystem}
        currentPath={currentPath}
        uploadProgress={uploadProgress}
        onNavigate={fetchFiles}
        onDownload={downloadFile}
        onUpload={uploadFile}
        onCancelUpload={cancelUpload}
        onRefresh={() => fetchFiles(currentPath)}
      />
    </div>
  );
}

export default function SSHConsolePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0e17] text-white flex items-center justify-center">
          <div className="animate-pulse text-sm text-gray-400 font-mono">Loading xterm.js SSH Console...</div>
        </div>
      }
    >
      <SSHConsoleContent />
    </Suspense>
  );
}
