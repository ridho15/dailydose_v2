import React, { useState, useEffect, useRef, useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface AsyncSearchSelectProps {
  value?: string;
  onChange: (value: string, selectedOption?: SelectOption) => void;
  fetchOptions: (query: string) => Promise<SelectOption[]>;
  placeholder?: string;
  searchPlaceholder?: string;
  label?: string;
  /** Label shown when `value` is set from outside (edit form) before the user picks an option */
  selectedLabel?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
}

export const AsyncSearchSelect: React.FC<AsyncSearchSelectProps> = ({
  value = '',
  onChange,
  fetchOptions,
  placeholder = 'Pilih opsi...',
  searchPlaceholder = 'Ketik untuk mencari...',
  label,
  selectedLabel,
  disabled = false,
  required = false,
  error
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selectedItem, setSelectedItem] = useState<SelectOption | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Kept in a ref so an inline `fetchOptions={(q) => ...}` does not refetch on every render
  const fetchOptionsRef = useRef(fetchOptions);
  fetchOptionsRef.current = fetchOptions;
  const listboxId = useId();

  // Parent reset the value (form reset) or changed it to another option: drop the stale label
  useEffect(() => {
    setSelectedItem((prev) => (!value || (prev && prev.value !== value) ? null : prev));
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Fetch options with debounce when query changes or when opening
  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    setIsLoading(true);
    setLoadError(null);

    const handler = setTimeout(async () => {
      try {
        const results = await fetchOptionsRef.current(searchQuery);
        if (isSubscribed) {
          setOptions(results);
          setIsLoading(false);
          setHighlightedIndex(results.length > 0 ? 0 : -1);
        }
      } catch (err) {
        if (isSubscribed) {
          setOptions([]);
          setIsLoading(false);
          setLoadError(err instanceof Error && err.message ? err.message : 'Server tidak merespons.');
        }
      }
    }, 300);

    return () => {
      isSubscribed = false;
      clearTimeout(handler);
    };
  }, [searchQuery, isOpen, retryCount]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  }, [isOpen]);

  const handleSelect = (option: SelectOption) => {
    setSelectedItem(option);
    onChange(option.value, option);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedItem(null);
    onChange('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < options.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0 && options[highlightedIndex]) {
      e.preventDefault();
      handleSelect(options[highlightedIndex]);
    }
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}

      {/* Main Select Button (clear button is a sibling: a button inside a button is invalid HTML) */}
      <div className="relative">
      <button
        type="button"
        role="combobox"
        data-testid="async-searchable-select"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-invalid={!!error}
        className={`flex w-full items-center justify-between rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:bg-slate-800 ${
          error
            ? 'border-rose-500 focus:border-rose-500'
            : isOpen
            ? 'border-indigo-500 ring-2 ring-indigo-500/20'
            : 'border-slate-300 hover:border-slate-400 dark:border-slate-700'
        }`}
      >
        <span className={`truncate ${selectedItem || value ? 'text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-400'}`}>
          {selectedItem?.label || selectedLabel || value || placeholder}
        </span>

        <div className={`flex items-center gap-1.5 ${(selectedItem || value) && !disabled ? 'pl-7' : ''}`}>
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {(selectedItem || value) && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Hapus pilihan"
          className="absolute inset-y-0 right-9 my-auto h-6 rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:hover:text-slate-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      </div>

      {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          {/* Inner Search Input */}
          <div className="relative mb-2">
            <svg
              className="pointer-events-none absolute inset-y-0 left-0 my-auto ml-3 h-4 w-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              data-testid="async-select-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {/* Options List */}
          <div id={listboxId} role="listbox" data-testid="async-select-options" className="max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-slate-500 gap-2">
                <svg className="h-4 w-4 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Memuat data...</span>
              </div>
            ) : loadError ? (
              <div role="alert" className="py-4 text-center text-sm">
                <p className="font-medium text-rose-700 dark:text-rose-400">Gagal memuat data: {loadError}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Periksa koneksi Anda, lalu coba lagi.</p>
                <button
                  type="button"
                  onClick={() => setRetryCount((n) => n + 1)}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Coba lagi
                </button>
              </div>
            ) : options.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Data tidak ditemukan
              </div>
            ) : (
              options.map((opt, index) => {
                const isSelected = opt.value === (selectedItem?.value || value);
                const isHighlighted = index === highlightedIndex;

                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`cursor-pointer rounded-lg px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                        : isHighlighted
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{opt.label}</span>
                      {isSelected && (
                        <svg className="h-4 w-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {opt.description && (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{opt.description}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

