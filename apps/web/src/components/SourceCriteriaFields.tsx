import { RemotiveCategoryPicker } from './RemotiveCategoryPicker.js';

export type CriteriaFieldMeta = {
  label: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
};

type SourceCriteriaFieldsProps = {
  fields: string[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  /** Optional per-field labels, hints, and placeholders (from source contract). */
  fieldMeta?: Record<string, CriteriaFieldMeta>;
  /** Labeled inputs for forms; compact inputs for queue table cells. */
  variant?: 'labeled' | 'compact';
  className?: string;
};

function partitionCriteriaFields(fields: string[]) {
  const search = fields.includes('search') ? (['search'] as const) : [];
  const location = fields.includes('location') ? (['location'] as const) : [];
  const categories = fields.includes('categories') ? (['categories'] as const) : [];
  const rest = fields.filter(
    (field) => field !== 'search' && field !== 'location' && field !== 'categories'
  );
  return { search, location, categories, rest };
}

function fieldLabel(field: string, meta?: CriteriaFieldMeta): string {
  return meta?.label ?? field;
}

function fieldPlaceholder(field: string, variant: 'labeled' | 'compact', meta?: CriteriaFieldMeta): string {
  if (meta?.placeholder) {
    return meta.placeholder;
  }
  return variant === 'compact' ? field : `Enter ${field}`;
}

/**
 * Renders source criteria inputs. `search` and `location` share a row on large screens (stacked on small).
 */
export function SourceCriteriaFields({
  fields,
  values,
  onChange,
  fieldMeta,
  variant = 'labeled',
  className,
}: SourceCriteriaFieldsProps) {
  const { search, location, categories, rest } = partitionCriteriaFields(fields);

  const onFieldChange = (field: string, value: string) => {
    onChange({ ...values, [field]: value });
  };

  const renderInput = (field: string, fullWidth: boolean) => {
    const meta = fieldMeta?.[field];
    const label = fieldLabel(field, meta);
    const input = (
      <input
        value={values[field] ?? ''}
        onChange={(event) => onFieldChange(field, event.target.value)}
        placeholder={fieldPlaceholder(field, variant, meta)}
        aria-label={label}
        required={meta?.required === true}
      />
    );

    const hint =
      variant === 'labeled' && meta?.hint ? (
        <span className='source-criteria-field-hint'>{meta.hint}</span>
      ) : null;

    if (variant === 'compact') {
      return (
        <div
          key={field}
          className={fullWidth ? 'source-criteria-field source-criteria-field-full' : 'source-criteria-field'}
        >
          {input}
        </div>
      );
    }

    return (
      <label
        key={field}
        className={fullWidth ? 'source-criteria-field source-criteria-field-full' : 'source-criteria-field'}
      >
        {label}
        {meta?.required ? <span className='source-criteria-required'> (required)</span> : null}
        {input}
        {hint}
      </label>
    );
  };

  const hasSearchOrLocation = search.length > 0 || location.length > 0;
  const rootClass = [
    'source-criteria-fields',
    variant === 'compact' ? 'source-criteria-fields--compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      {hasSearchOrLocation ? (
        <div className='source-criteria-search-location'>
          {search.map((field) => renderInput(field, false))}
          {location.map((field) => renderInput(field, false))}
        </div>
      ) : null}
      {categories.map((field) => (
        <div key={field} className='source-criteria-field source-criteria-field-full'>
          {variant === 'labeled' ? <span className='source-criteria-field-label'>Categories</span> : null}
          <RemotiveCategoryPicker
            value={values[field] ?? ''}
            onChange={(csv) => onFieldChange(field, csv)}
          />
        </div>
      ))}
      {rest.map((field) => renderInput(field, true))}
    </div>
  );
}
