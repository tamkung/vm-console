'use client';

import React, { Suspense, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useRDPConnection } from '@/hooks/useRDPConnection';

// Keysym definitions for key injection
const KEYSYMS = {
  CTRL_L: 0xffe3,
  ALT_L: 0xffe9,
  DEL: 0xffff,
  TAB: 0xff09,
  ESC: 0xff1b,
  SUPER_L: 0xffeb, // Windows key
};

function GuacConsoleContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openMode = searchParams?.get('mode') || 'same-tab';
  const proxyInputRef = useRef<HTMLInputElement>(null);

  const [showToolbar, setShowToolbar] = useState(true);

  const {
    details,
    connecting,
    disconnected,
    disconnectReason,
    isDragging,
    uploadProgress,
    displayContainerRef,
    sendSpecialKey,
    handleReconnect,
    handleToggleFullscreen,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    error,
  } = useRDPConnection();

  const handleBack = () => {
    if (openMode === 'new-tab') {
      window.close();
    } else {
      router.push('/dashboard');
    }
  };

  const activateKeyboard = () => {
    if (proxyInputRef.current) {
      proxyInputRef.current.focus({ preventScroll: true });
      proxyInputRef.current.click();
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-2xl font-bold">
          ⚠️
        </div>
        <h1 className="text-xl font-bold text-gray-100">RDP Connection Error</h1>
        <p className="text-red-400 text-sm max-w-md text-center bg-red-950/40 border border-red-800/50 p-3 rounded">
          {error}
        </p>
        <div className="flex gap-3 pt-2">
          {details && (
            <button
              onClick={handleReconnect}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded transition-colors"
            >
              Retry Connection
            </button>
          )}
          <button
            onClick={handleBack}
            className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs px-4 py-2 rounded transition-colors"
          >
            {openMode === 'new-tab' ? 'Close Window' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen bg-black flex flex-col overflow-hidden select-none font-sans"
      onClick={() => {
        if (displayContainerRef.current) {
          displayContainerRef.current.focus();
        }
      }}
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
          {/* Left: Info & Back */}
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleBack();
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors border border-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {openMode === 'new-tab' ? 'Close' : 'Back'}
            </button>

            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-xs truncate max-w-[200px]">
                {details?.vmName || 'Remote Desktop'}
              </span>
              <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Native guacd
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

          {/* Right: Key Injections + Actions */}
          <div className="flex items-center gap-1.5 flex-1 justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                sendSpecialKey([KEYSYMS.CTRL_L, KEYSYMS.ALT_L, KEYSYMS.DEL]);
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Ctrl+Alt+Delete"
            >
              Ctrl+Alt+Del
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                sendSpecialKey([KEYSYMS.SUPER_L]);
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Windows Key"
            >
              Win
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                sendSpecialKey([KEYSYMS.ALT_L, KEYSYMS.TAB]);
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Alt+Tab"
            >
              Alt+Tab
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                sendSpecialKey([KEYSYMS.ESC]);
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-[11px] font-mono border border-gray-700 transition-colors"
              title="Send Esc"
            >
              Esc
            </button>

            <div className="w-px h-4 bg-gray-700 mx-0.5" />

            <div
              className="hidden lg:flex items-center gap-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-400 font-mono"
              title="Drag and drop any file onto this window to upload"
            >
              📁 Drop to Upload
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                activateKeyboard();
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs border border-gray-700 transition-colors"
              title="Show Virtual Keyboard (for tablets/mobile)"
            >
              ⌨️ Keyboard
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReconnect();
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs border border-gray-700 transition-colors"
              title="Reconnect"
            >
              🔄 Reconnect
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFullscreen();
              }}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs border border-gray-700 transition-colors"
              title="Fullscreen"
            >
              ⛶ Fullscreen
            </button>
          </div>
        </div>
      </div>

      {/* Main Console Canvas Display */}
      <main
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 relative w-full h-full overflow-hidden flex items-center justify-center bg-black ${
          showToolbar ? 'mt-10' : 'mt-0'
        }`}
      >
        <div
          ref={displayContainerRef}
          tabIndex={0}
          className="relative w-full h-full flex items-center justify-center overflow-hidden outline-none cursor-default"
        />

        {/* Connecting Spinner Overlay */}
        {connecting && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <h3 className="text-white font-medium text-base mb-1">Connecting to Remote Desktop...</h3>
            <p className="text-gray-400 text-xs">Negotiating native guacd stream & security handshake</p>
          </div>
        )}

        {/* Disconnected Overlay */}
        {disconnected && !connecting && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm p-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-sm w-full text-center shadow-2xl space-y-4">
              <div className="w-12 h-12 rounded-full bg-yellow-500/20 text-yellow-400 mx-auto flex items-center justify-center text-2xl font-bold">
                🔌
              </div>
              <div>
                <h3 className="text-white font-bold text-base">Session Disconnected</h3>
                <p className="text-gray-400 text-xs mt-1">
                  {disconnectReason || 'The remote desktop session has closed.'}
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleReconnect}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded transition-colors"
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
                <h3 className="text-lg font-bold text-white mb-0.5">Drop Files to Upload</h3>
                <p className="text-gray-400 text-xs">Files will be transferred directly to the remote session</p>
              </div>
            </div>
          </div>
        )}

        {/* Upload Progress Bar */}
        {uploadProgress && (
          <div className="absolute bottom-6 right-6 z-40 bg-gray-900 border border-gray-700 p-4 rounded-lg shadow-2xl w-80 space-y-2">
            <div className="flex justify-between text-xs text-white">
              <span className="truncate max-w-[180px] font-medium">{uploadProgress.filename}</span>
              <span className="text-emerald-400 font-mono">{uploadProgress.progress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-150"
                style={{ width: `${uploadProgress.progress}%` }}
              />
            </div>
          </div>
        )}
      </main>

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
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </div>
  );
}

export default function GuacConsolePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
          <div className="animate-pulse text-sm text-gray-400">Loading Native RDP Console...</div>
        </div>
      }
    >
      <GuacConsoleContent />
    </Suspense>
  );
}
