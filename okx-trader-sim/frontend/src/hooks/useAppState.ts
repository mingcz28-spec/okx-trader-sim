import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AppState } from '../types';

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setState(await api.getState());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载状态失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { state, setState, loading, message, setMessage, error, setError, refresh };
}
