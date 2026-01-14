import { useEffect, useRef, useCallback } from 'react';

const WAKE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Custom hook to prevent the screen from sleeping using the Wake Lock API.
 * The lock is maintained for a specific duration after keepAwake is called.
 */
export const useWakeLock = () => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch (err: any) {
        console.warn('Failed to release Wake Lock:', err);
      } finally {
        wakeLockRef.current = null;
        console.log('Wake Lock released due to inactivity');
      }
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;

    if (!wakeLockRef.current || wakeLockRef.current.released) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Wake Lock was released by system');
          if (wakeLockRef.current?.released) {
            wakeLockRef.current = null;
          }
        });
        
        console.log('Wake Lock active');
      } catch (err: any) {
        console.error(`Failed to acquire Wake Lock: ${err.name}, ${err.message}`);
      }
    }
  }, []);

  const keepAwake = useCallback(() => {
    requestWakeLock();

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      releaseWakeLock();
    }, WAKE_LOCK_TIMEOUT);
  }, [requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && wakeLockRef.current === null) {
        // If we were supposed to be awake (timeout hasn't fired), re-request
        if (timeoutRef.current) {
          await requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Clean up on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      releaseWakeLock();
    };
  }, [releaseWakeLock, requestWakeLock]);

  return { keepAwake };
};
