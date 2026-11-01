function Button({ variant = 'primary', className = '', type = 'button', children, ...props }) {
  return (
    <button type={type} className={`button button-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export default Button;
