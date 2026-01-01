import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook to prevent the screen from sleeping using the Wake Lock API.
 */
export const useWakeLock = () => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    // Check if the browser supports the Wake Lock API
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        
        // Handle release (e.g., if the browser releases the lock)
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Wake Lock was released');
        });
        
        console.log('Wake Lock is active');
      } catch (err: any) {
        console.error(`Failed to acquire Wake Lock: ${err.name}, ${err.message}`);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Request lock on mount
    requestWakeLock();

    // Re-acquire lock when visibility changes (tab becomes visible again)
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Clean up on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [requestWakeLock, releaseWakeLock]);

  return { requestWakeLock, releaseWakeLock };
};
