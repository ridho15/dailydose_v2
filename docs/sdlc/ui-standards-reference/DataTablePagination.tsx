import React, { useState, useEffect } from 'react';

export interface PaginationState {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface DataTablePaginationProps {
  // Search & Filter
  searchTerm?: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filterOptions?: Array<{
    id: string;
    label: string;
    value: string;
    options: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
  }>;

  // Pagination
  pagination: PaginationState;
  onPageChange: (newPage: number) => void;
  onLimitChange: (newLimit: number) => void;
  limitOptions?: number[];
  isLoading?: boolean;
}

export const DataTablePagination: React.FC<DataTablePaginationProps> = ({
  searchTerm = '',
  onSearchChange,
  searchPlaceholder = 'Cari data...',
  filterOptions = [],
  pagination,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 25, 50, 100],
  isLoading = false
}) => {
  const [localSearch, setLocalSearch] = useState(searchTerm);

  // Parent changed the term (reset filters, back/forward with URL sync): follow it instead of reverting it
  useEffect(() => {
    setLocalSearch(searchTerm);
  }, [searchTerm]);

  // Debounced search (350ms) to prevent unnecessary query spam
  useEffect(() => {
    const handler = setTimeout(() => {
      if (localSearch !== searchTerm) {
        onSearchChange(localSearch);
      }
    }, 350);

    return () => clearTimeout(handler);
  }, [localSearch, searchTerm, onSearchChange]);

  const startItem = pagination.totalItems === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endItem = Math.min(pagination.page * pagination.limit, pagination.totalItems);

  return (
    <div className="flex flex-col gap-4">
      {/* Search & Filters Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg aria-hidden="true" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            aria-label={searchPlaceholder}
            data-testid="search-input"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-11 text-sm text-slate-800 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          {localSearch && (
            <button
              type="button"
              aria-label="Hapus pencarian"
              onClick={() => {
                setLocalSearch('');
                onSearchChange('');
              }}
              className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center text-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Filter Dropdowns */}
        {filterOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {filterOptions.map((filter) => (
              <select
                key={filter.id}
                aria-label={filter.label}
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="">{filter.label}</option>
                {filter.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
        )}
      </div>

      {/* Pagination Controls Bar */}
      <div
        data-testid="pagination-controls"
        className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 py-3 sm:flex-row dark:border-slate-800"
      >
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span>Menampilkan</span>
          <select
            value={pagination.limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {limitOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <span>
            dari <strong className="font-semibold text-slate-900 dark:text-slate-100">{pagination.totalItems}</strong> data
            {pagination.totalItems > 0 && ` (${startItem} - ${endItem})`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={pagination.page <= 1 || isLoading}
            onClick={() => onPageChange(pagination.page - 1)}
            aria-label="Halaman Sebelumnya"
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            Sebelumnya
          </button>

          <span className="px-3 text-sm font-medium text-slate-700 dark:text-slate-300">
            Hal {pagination.page} dari {Math.max(1, pagination.totalPages)}
          </span>

          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages || isLoading}
            onClick={() => onPageChange(pagination.page + 1)}
            aria-label="Halaman Selanjutnya"
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            Selanjutnya
          </button>
        </div>
      </div>
    </div>
  );
};

