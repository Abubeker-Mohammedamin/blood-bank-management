function PageContainer({ id, eyebrow, title, description, actions, children }) {
  return (
    <main className="content page-container" id="main-content">
      <section className="page-heading" aria-labelledby={`${id}-title`}>
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 id={`${id}-title`}>{title}</h1>
          {description && <p className="page-intro">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </section>
      {children}
    </main>
  );
}

export default PageContainer;
