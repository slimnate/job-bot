import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type FilterSelectOption = {
  value: string;
  label: string;
  /** Shown in parentheses and included in filter matching (e.g. apiModelId). */
  sublabel?: string;
};

type FilterSelectProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  /** Shown in the list when `options` is empty. */
  emptyMessage?: string;
  /** Shown when the filter matches nothing. */
  noMatchMessage?: string;
  className?: string;
};

/**
 * Searchable single-select: one text field filters an attached dropdown list.
 */
export function FilterSelect({
  id: idProp,
  label,
  value,
  onChange,
  options,
  disabled = false,
  placeholder = 'Search…',
  emptyMessage = 'No options',
  noMatchMessage = 'No matches',
  className = '',
}: FilterSelectProps) {
  const autoId = useId();
  const inputId = idProp ?? autoId;
  const listId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const closedDisplay = selected
    ? selected.sublabel
      ? `${selected.label} (${selected.sublabel})`
      : selected.label
    : '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter((o) => {
      const labelMatch = o.label.toLowerCase().includes(q);
      const subMatch = o.sublabel?.toLowerCase().includes(q);
      const valueMatch = o.value.toLowerCase().includes(q);
      return labelMatch || subMatch || valueMatch;
    });
  }, [options, query]);

  const inputValue = open ? query : closedDisplay;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    const onDocPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, []);

  const pick = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onInputFocus = () => {
    if (disabled) {
      return;
    }
    setOpen(true);
    setQuery('');
  };

  const onInputChange = (next: string) => {
    setQuery(next);
    if (!open) {
      setOpen(true);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
      return;
    }
    if (event.key === 'Enter' && open && filtered.length > 0) {
      event.preventDefault();
      pick(filtered[0]!.value);
    }
  };

  const listEmpty = options.length === 0;
  const showList = open && !disabled;
  const listMessage = listEmpty
    ? emptyMessage
    : filtered.length === 0
      ? noMatchMessage
      : null;

  return (
    <div
      ref={rootRef}
      className={`filter-select ${open ? 'filter-select--open' : ''} ${className}`.trim()}
    >
      <label className='stacked-field' htmlFor={inputId}>
        {label}
      </label>
      <div className='filter-select-control'>
        <input
          ref={inputRef}
          id={inputId}
          type='search'
          className='filter-select-input score-criteria-select'
          role='combobox'
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete='list'
          placeholder={placeholder}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onFocus={onInputFocus}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoComplete='off'
        />
        <button
          type='button'
          className='filter-select-toggle'
          tabIndex={-1}
          aria-label={open ? 'Close list' : 'Open list'}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (disabled) {
              return;
            }
            if (open) {
              setOpen(false);
              setQuery('');
            } else {
              setOpen(true);
              setQuery('');
              inputRef.current?.focus();
            }
          }}
        >
          ▾
        </button>
      </div>
      {showList ? (
        <ul id={listId} className='filter-select-list' role='listbox'>
          {listMessage ? (
            <li className='filter-select-option filter-select-option--muted' role='presentation'>
              {listMessage}
            </li>
          ) : (
            filtered.map((o) => (
              <li key={o.value} role='presentation'>
                <button
                  type='button'
                  role='option'
                  aria-selected={o.value === value}
                  className={
                    o.value === value
                      ? 'filter-select-option filter-select-option--selected'
                      : 'filter-select-option'
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(o.value)}
                >
                  <span className='filter-select-option-label'>{o.label}</span>
                  {o.sublabel ? (
                    <span className='filter-select-option-sublabel'>{o.sublabel}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {open && !listEmpty && query.trim() ? (
        <p className='panel-subtitle tight filter-select-hint'>
          {filtered.length} of {options.length}
        </p>
      ) : null}
    </div>
  );
}
