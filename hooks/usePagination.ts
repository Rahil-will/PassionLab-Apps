import { useEffect, useMemo, useState } from 'react';

export interface UsePaginationResult<T> {
  page: number;
  setPage: (page: number) => void;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  paginatedItems: T[];
}

export function usePagination<T>(items: T[], pageSize = 20): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(safePage * pageSize, total);

  const paginatedItems = useMemo(() => items.slice(start, end), [items, start, end]);

  useEffect(() => {
    setPage(1);
  }, [items.length]);

  return {
    page: safePage,
    setPage,
    pageCount,
    total,
    start: start + 1,
    end,
    paginatedItems,
  };
}
