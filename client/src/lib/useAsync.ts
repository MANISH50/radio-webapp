import { type DependencyList, useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/** Runs an abortable async loader whenever deps change; stale responses are discarded. */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, loading: true }));
    load(ctrl.signal).then(
      (data) => {
        if (!ctrl.signal.aborted) setState({ data, loading: false });
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ error: err instanceof Error ? err : new Error('Something went wrong.'), loading: false });
      },
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}
