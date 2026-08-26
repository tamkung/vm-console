'use client';

import React, { useRef } from 'react';
import { RemoteFileItem } from '@/hooks/useRDPConnection';

interface FileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: RemoteFileItem[];
  loading: boolean;
  hasFilesystem: boolean;
  currentPath: string;
  onNavigate: (path: string) => void;
  onDownload: (file: RemoteFileItem) => void;
  onUpload: (file: File) => void;
  onRefresh: () => void;
}

export default function FileManagerModal({
  isOpen,
  onClose,
  files,
  loading,
  hasFilesystem,
  currentPath,
  onNavigate,
  onDownload,
  onUpload,
  onRefresh,
}: FileManagerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      Array.from(selectedFiles).forEach((file) => onUpload(file));
      // Reset input
      e.target.value = '';
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  const getFileIcon = (file: RemoteFileItem) => {
    if (file.isDirectory) return '📁';
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'svg':
        return '🖼️';
      case 'pdf':
        return '📕';
      case 'zip':
      case 'rar':
      case '7z':
      case 'tar':
      case 'gz':
        return '📦';
      case 'txt':
      case 'log':
      case 'md':
        return '📝';
      case 'exe':
      case 'msi':
      case 'bat':
      case 'sh':
      case 'ps1':
        return '⚙️';
      case 'mp4':
      case 'mkv':
      case 'avi':
        return '🎬';
      case 'mp3':
      case 'wav':
        return '🎵';
      case 'docx':
      case 'doc':
        return '📄';
      case 'xlsx':
      case 'xls':
      case 'csv':
        return '📊';
      default:
        return '📄';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-lg">
              📁
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Shared Files Explorer</h2>
              <p className="text-gray-400 text-xs">Browse, upload, and download files from the remote session</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Breadcrumbs */}
        <div className="px-5 py-2.5 bg-gray-900/90 border-b border-gray-800 flex items-center justify-between gap-3 text-xs">
          {/* Breadcrumb Path */}
          <div className="flex items-center gap-1 overflow-x-auto text-gray-400 font-mono py-1">
            <button
              onClick={() => onNavigate('/')}
              className="hover:text-emerald-400 font-bold transition-colors"
            >
              / Shared Files
            </button>
            {pathParts.map((part, idx) => {
              const subPath = '/' + pathParts.slice(0, idx + 1).join('/');
              return (
                <React.Fragment key={subPath}>
                  <span className="text-gray-600">/</span>
                  <button
                    onClick={() => onNavigate(subPath)}
                    className="hover:text-emerald-400 transition-colors truncate max-w-[120px]"
                  >
                    {part}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors text-xs shadow-sm"
            >
              <span>⬆️</span> Upload File
            </button>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-gray-700 transition-colors text-xs flex items-center gap-1 disabled:opacity-50"
              title="Refresh list"
            >
              <span className={loading ? 'animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>

        {/* File List Content */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[250px] max-h-[420px]">
          {loading ? (
            <div className="h-48 flex flex-col items-center justify-center text-gray-400 gap-2">
              <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">Reading virtual drive...</span>
            </div>
          ) : !hasFilesystem ? (
            <div className="h-48 flex flex-col items-center justify-center text-center p-6 text-gray-400 gap-2">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-2xl">
                ⏳
              </div>
              <div className="text-white font-medium text-sm">Virtual Drive Initializing</div>
              <p className="text-gray-400 text-xs max-w-sm">
                The virtual drive is connecting to the remote session. Please wait a moment and click the Refresh button (🔄) above.
              </p>
            </div>
          ) : files.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center p-6 text-gray-400 gap-2">
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-2xl text-gray-500">
                📂
              </div>
              <div className="text-white font-medium text-sm">No files found</div>
              <p className="text-gray-400 text-xs max-w-sm">
                To download a file from Windows, copy or save it into{' '}
                <span className="text-emerald-400 font-mono">This PC ➔ Shared Files</span>, then click Refresh!
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {currentPath !== '/' && (
                <button
                  onClick={() => {
                    const parent = '/' + pathParts.slice(0, -1).join('/');
                    onNavigate(parent);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-gray-300 hover:bg-gray-800/80 hover:text-white transition-colors text-xs"
                >
                  <span className="text-base">📁</span>
                  <span className="font-semibold text-gray-400">.. (Parent Directory)</span>
                </button>
              )}

              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-800/70 transition-colors group border border-transparent hover:border-gray-700/60"
                >
                  <div
                    onClick={() => {
                      if (file.isDirectory) {
                        onNavigate(file.path);
                      }
                    }}
                    className={`flex items-center gap-3 flex-1 min-w-0 ${
                      file.isDirectory ? 'cursor-pointer' : ''
                    }`}
                  >
                    <span className="text-lg flex-shrink-0">{getFileIcon(file)}</span>
                    <span
                      className={`text-xs truncate font-medium ${
                        file.isDirectory
                          ? 'text-emerald-400 group-hover:underline font-semibold'
                          : 'text-gray-200'
                      }`}
                    >
                      {file.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {file.isDirectory ? (
                      <button
                        onClick={() => onNavigate(file.path)}
                        className="text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded border border-gray-700 transition-colors"
                      >
                        Open ➔
                      </button>
                    ) : (
                      <button
                        onClick={() => onDownload(file)}
                        className="text-[11px] bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white font-medium px-3 py-1 rounded-md border border-emerald-500/30 hover:border-emerald-500 transition-all flex items-center gap-1.5 shadow-sm"
                        title="Download to your device"
                      >
                        <span>⬇️</span> Download
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer / Tip */}
        <div className="px-5 py-3 border-t border-gray-800 bg-gray-950/80 text-[11px] text-gray-400 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span>💡</span>
            <span>Tip: Drag & drop any file directly onto the console window to upload.</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white px-3 py-1 rounded bg-gray-800 text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
