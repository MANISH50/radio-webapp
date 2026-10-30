import { type ReactNode, useState } from 'react';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-raised ${className}`} />;
}

export function ListSkeleton({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
          <Skeleton className="size-12 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-surface p-6 text-center">
      <p className="font-semibold text-danger">Something went wrong</p>
      <p className="mt-1 text-sm text-muted">{error.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
          Try again
        </button>
      )}
    </div>
  );
}

function RadioIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M7 8 17 4" />
      <circle cx="15.5" cy="14" r="2.5" />
      <path d="M6.5 12.5h4M6.5 15.5h4" />
    </svg>
  );
}

/** Station logos are untrusted remote images: lazy-loaded, no referrer, fallback icon on error. */
export function StationLogo({ src, className = 'size-12' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-raised text-muted`}>
        <RadioIcon className="size-1/2" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} shrink-0 rounded-lg bg-raised object-contain`}
    />
  );
}

export function Pagination({
  page,
  totalPages,
  hasMore,
  onPage,
}: {
  page: number;
  totalPages?: number;
  hasMore?: boolean;
  onPage: (page: number) => void;
}) {
  const canNext = totalPages !== undefined ? page < totalPages : Boolean(hasMore);
  if (page === 1 && !canNext) return null;
  const btn = 'rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      <span className="text-sm text-muted" aria-live="polite">
        Page {page}
        {totalPages !== undefined && ` of ${totalPages}`}
      </span>
      <button type="button" className={btn} disabled={!canNext} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </nav>
  );
}
