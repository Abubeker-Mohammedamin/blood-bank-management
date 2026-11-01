function DataTable({
  caption,
  columns,
  rows,
  rowKey = 'id',
  emptyState = 'No records to display.',
  className = '',
}) {
  const tableClassName = `data-table ${className}`.trim();

  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={caption ? `${caption} table` : 'Data table'}
      tabIndex={0}
    >
      <table className={tableClassName}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyState}</td>
            </tr>
          ) : rows.map((row, rowIndex) => (
            <tr key={typeof rowKey === 'function' ? rowKey(row) : row[rowKey] ?? rowIndex}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
