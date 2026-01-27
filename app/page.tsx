'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [realm, setRealm] = useState('pve');
  const [useCustomHost, setUseCustomHost] = useState(false);
  const [customHost, setCustomHost] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Obfuscate password to avoid plain text in network logs
      const encodedPassword = btoa(unescape(encodeURIComponent(password)));
      const payload: any = { username, password: encodedPassword, realm };
      if (useCustomHost) {
          if (!customHost) throw new Error("Custom Host URL is required");
          payload.customHost = customHost;
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        // Store the encrypted credentials blob for sharing features
        if (data.credentialsToken) {
            sessionStorage.setItem('vm_console_creds', data.credentialsToken);
        }
        
        router.push('/dashboard');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-100">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md border border-gray-700">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-400">Proxmox Console</h1>
        
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none text-white"
              placeholder="username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none text-white"
              placeholder="••••••••"
              required
            />
          </div>

          <div>
             <label className="flex items-center space-x-2 text-sm text-gray-300 mb-2 cursor-pointer">
                 <input 
                    type="checkbox" 
                    checked={useCustomHost} 
                    onChange={(e) => setUseCustomHost(e.target.checked)}
                    className="form-checkbox h-4 w-4 text-blue-500 rounded bg-gray-900 border-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800"
                 />
                 <span>Use Custom Host</span>
             </label>
             
             {useCustomHost && (
                 <div className="mb-4 animate-fadeIn">
                     <label className="block text-sm font-medium mb-1 text-gray-300">Proxmox Host URL</label>
                     <input
                      type="url"
                      value={customHost}
                      onChange={(e) => setCustomHost(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none text-white"
                      placeholder="https://192.168.1.100:8006"
                      required={useCustomHost}
                    />
                 </div>
             )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Realm</label>
            <select
              value={realm}
              onChange={(e) => setRealm(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none text-white"
            >
              <option value="pam">Linux PAM standard authentication</option>
              <option value="pve">Proxmox VE authentication server</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
