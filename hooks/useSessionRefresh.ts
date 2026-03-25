'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_INTERVAL = 90 * 60 * 1000; // 1.5 hours

export function useSessionRefresh() {
    const router = useRouter();
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const refreshSession = async () => {
            try {
                const res = await fetch('/api/auth/refresh', { method: 'POST' });
                if (res.ok) {
                    console.log('[Session] Ticket renewed successfully');
                } else {
                    console.warn('[Session] Ticket renewal failed, redirecting to login');
                    router.push('/');
                }
            } catch (err) {
                console.error('[Session] Refresh error:', err);
            }
        };

        intervalRef.current = setInterval(refreshSession, REFRESH_INTERVAL);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [router]);
}
