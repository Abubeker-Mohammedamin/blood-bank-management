import { useId } from 'react';

function FormField({
  id,
  label,
  help,
  error,
  required = false,
  as = 'input',
  options = [],
  className = '',
  ...controlProps
}) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const sharedProps = {
    ...controlProps,
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? 'true' : undefined,
    required,
  };

  let control = <input {...sharedProps} />;
  if (as === 'select') {
    control = (
      <select {...sharedProps}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (as === 'textarea') {
    control = <textarea {...sharedProps} />;
  }

  return (
    <div className={`form-field ${className}`.trim()}>
      <label className="form-label" htmlFor={controlId}>
        {label}
        {required && <span className="required-mark" aria-hidden="true"> *</span>}
      </label>
      {control}
      {help && <p className="form-help" id={helpId}>{help}</p>}
      {error && <p className="form-error" id={errorId}>{error}</p>}
    </div>
  );
}

export default FormField;
