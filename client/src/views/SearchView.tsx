import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StationList } from '../components/StationList';
import { EmptyState, ErrorState, ListSkeleton, Pagination } from '../components/ui';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 30;

export function SearchView({ q }: { q: string }) {
  const [page, setPage] = useState(1);
  const query = q.trim();
  useEffect(() => setPage(1), [query]);

  const { data, error, loading, reload } = useAsync(
    (signal) => (query.length >= 2 ? api.search(query, page, PAGE_SIZE, signal) : Promise.resolve(null)),
    [query, page],
  );

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold sm:text-3xl">
        {query ? (
          <>
            Results for “<span className="break-words">{query}</span>”
          </>
        ) : (
          'Search stations'
        )}
      </h1>
      {query.length < 2 ? (
        <EmptyState title="Type at least 2 characters">Search station names across every country.</EmptyState>
      ) : loading && !data ? (
        <ListSkeleton label="Searching" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.data.length ? (
        <EmptyState title="No stations found">Try a shorter or different name.</EmptyState>
      ) : (
        <div aria-busy={loading}>
          <StationList stations={data.data} label="Search results" />
          <Pagination page={page} hasMore={data.meta.hasMore} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
