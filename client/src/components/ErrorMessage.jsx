function ErrorMessage({ title = 'Something went wrong', children, className = '' }) {
  return (
    <div className={`error-message ${className}`.trim()} role="alert">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export default ErrorMessage;
