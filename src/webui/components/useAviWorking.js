import { useState, useCallback } from 'react';

/**
 * Hook that manages the "Avi is working" state for throbber visibility.
 *
 * Usage:
 *   const { isWorking, status, startWorking, stopWorking } = useAviWorking();
 *
 *   startWorking('waiting for DM sensor');
 *   // … later …
 *   stopWorking();
 *
 *   <DmHeaderThrobber visible={isWorking} label={status} />
 */
export default function useAviWorking(initialStatus = 'working') {
  const [isWorking, setIsWorking] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  const startWorking = useCallback((statusText) => {
    if (statusText) setStatus(statusText);
    setIsWorking(true);
  }, []);

  const stopWorking = useCallback(() => {
    setIsWorking(false);
  }, []);

  return { isWorking, status, startWorking, stopWorking };
}
