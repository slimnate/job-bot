import { REMOTIVE_CATEGORIES } from '@job-bot/shared';

type RemotiveCategoryPickerProps = {
  value: string;
  onChange: (categoriesCsv: string) => void;
  className?: string;
};

/**
 * Multi-select checkboxes for Remotive RSS category slugs (comma-separated value).
 */
export function RemotiveCategoryPicker({ value, onChange, className }: RemotiveCategoryPickerProps) {
  const selected = new Set(
    value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  const setSelected = (next: Set<string>) => {
    onChange([...next].sort().join(','));
  };

  const onToggle = (slug: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) {
      next.add(slug);
    } else {
      next.delete(slug);
    }
    setSelected(next);
  };

  const onSelectAll = () => {
    setSelected(new Set(REMOTIVE_CATEGORIES.map((c) => c.slug)));
  };

  const onClearAll = () => {
    onChange('');
  };

  const rootClass = ['remotive-category-picker', className].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <p className='field-hint'>
        Leave all unchecked to scrape the main all-jobs feed. Select one or more categories to
        fetch only those RSS feeds.
      </p>
      <div className='remotive-category-picker-actions'>
        <button type='button' onClick={onSelectAll}>
          Select all
        </button>
        <button type='button' onClick={onClearAll}>
          Clear all
        </button>
      </div>
      <div className='remotive-category-picker-grid' role='group' aria-label='Remotive categories'>
        {REMOTIVE_CATEGORIES.map((category) => (
          <label key={category.slug} className='remotive-category-picker-item'>
            <input
              type='checkbox'
              checked={selected.has(category.slug)}
              onChange={(event) => onToggle(category.slug, event.target.checked)}
            />
            <span>{category.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
