const LOCATION_GEO_FIELDS = new Set(['location', 'geoId']);

/**
 * Applies LinkedIn location / geoId mutual exclusion when editing criteria inline.
 */
export function applySourceCriteriaFieldChange(
  prev: Record<string, string>,
  field: string,
  value: string
): Record<string, string> {
  const next = { ...prev, [field]: value };
  if (field === 'location' && value.trim()) {
    next.geoId = '';
  }
  if (field === 'geoId' && value.trim()) {
    next.location = '';
  }
  return next;
}

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
  const locationPair = (['location', 'geoId'] as const).filter((field) => fields.includes(field));
  const rest = fields.filter((field) => field !== 'search' && !LOCATION_GEO_FIELDS.has(field));
  return { search, locationPair, rest };
}

/**
 * Renders source criteria inputs: `search` spans the full row; `location` and `geoId` share one row.
 */
export function SourceCriteriaFields({
  fields,
  values,
  onChange,
  variant = 'labeled',
  className,
}: SourceCriteriaFieldsProps) {
  const { search, locationPair, rest } = partitionCriteriaFields(fields);

  const onFieldChange = (field: string, value: string) => {
    onChange(applySourceCriteriaFieldChange(values, field, value));
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

  const rootClass = ['source-criteria-fields', className].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {search.map((field) => renderInput(field, true))}
      {locationPair.map((field) => renderInput(field, false))}
      {rest.map((field) => renderInput(field, true))}
    </div>
  );
}
