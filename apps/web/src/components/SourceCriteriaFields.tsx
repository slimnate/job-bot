type SourceCriteriaFieldsProps = {
  fields: string[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  /** Labeled inputs for forms; compact inputs for queue table cells. */
  variant?: 'labeled' | 'compact';
  className?: string;
};

function partitionCriteriaFields(fields: string[]) {
  const search = fields.includes('search') ? (['search'] as const) : [];
  const location = fields.includes('location') ? (['location'] as const) : [];
  const rest = fields.filter((field) => field !== 'search' && field !== 'location');
  return { search, location, rest };
}

/**
 * Renders source criteria inputs. `search` and `location` share a row on large screens (stacked on small).
 */
export function SourceCriteriaFields({
  fields,
  values,
  onChange,
  variant = 'labeled',
  className,
}: SourceCriteriaFieldsProps) {
  const { search, location, rest } = partitionCriteriaFields(fields);

  const onFieldChange = (field: string, value: string) => {
    onChange({ ...values, [field]: value });
  };

  const renderInput = (field: string, fullWidth: boolean) => {
    const input = (
      <input
        value={values[field] ?? ''}
        onChange={(event) => onFieldChange(field, event.target.value)}
        placeholder={variant === 'compact' ? field : `Enter ${field}`}
        aria-label={field}
      />
    );

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
        {field}
        {input}
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
      {rest.map((field) => renderInput(field, true))}
    </div>
  );
}
