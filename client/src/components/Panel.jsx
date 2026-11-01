import { useId } from 'react';

function Panel({ title, description, action, className = '', children }) {
  const titleId = useId();
  return (
    <section className={`panel ${className}`.trim()} aria-labelledby={titleId}>
      <header className="panel-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="panel-action">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export default Panel;
