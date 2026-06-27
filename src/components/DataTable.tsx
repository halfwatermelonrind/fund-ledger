import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  title: string
  sortable?: boolean
  /** If true, apply mono + tabular-nums to cells in this column */
  mono?: boolean
  className?: string
  render: (row: T, index: number) => ReactNode
}

interface Props<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string
  rowClass?: (row: T) => string
  /** Expandable row detail — renders below the main row when expanded */
  expandedKey?: string | null
  renderExpanded?: (row: T) => ReactNode
  sortKey?: string | null
  sortDir?: 1 | -1
  onSort?: (key: string) => void
  emptyText?: string
  /** Max height for vertical scrolling + sticky header, e.g. "70vh" */
  maxHeight?: string
}

export default function DataTable<T>({
  columns, data, rowKey, rowClass, expandedKey, renderExpanded,
  sortKey, sortDir, onSort, emptyText = '暂无数据', maxHeight,
}: Props<T>) {
  return (
    <div
      className="overflow-x-auto border border-border rounded-md bg-surface"
      style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
    >
      <table className="w-full border-collapse text-[13px] min-w-[780px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sticky top-0 bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border whitespace-nowrap select-none
                  ${col.sortable ? 'cursor-pointer hover:text-accent' : ''} ${col.className ?? ''}`}
                onClick={() => col.sortable && onSort?.(col.key)}
              >
                {col.title}
                {col.sortable && sortKey === col.key && (
                  <span className="ml-1 text-[10px]">{sortDir === 1 ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-8 text-muted">{emptyText}</td>
            </tr>
          ) : (
            data.map((row, i) => {
              const key = rowKey(row, i)
              const isExpanded = expandedKey === key
              return (
                <RowWithDetail
                  key={key}
                  columns={columns}
                  row={row}
                  index={i}
                  rowClass={rowClass?.(row)}
                  isExpanded={isExpanded}
                  expandedContent={renderExpanded?.(row)}
                  colSpan={columns.length}
                />
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

function RowWithDetail<T>({
  columns, row, index, rowClass, isExpanded, expandedContent, colSpan,
}: {
  columns: Column<T>[]
  row: T
  index: number
  rowClass?: string
  isExpanded: boolean
  expandedContent?: ReactNode
  colSpan: number
}) {
  return (
    <>
      <tr className={`border-b border-border hover:bg-gray-50 last:border-b-0 ${rowClass ?? ''}`}>
        {columns.map((col) => (
          <td
            key={col.key}
            className={`px-3 py-2.5 align-middle whitespace-nowrap ${col.mono ? 'font-mono tabular-nums' : ''} ${col.className ?? ''}`}
          >
            {col.render(row, index)}
          </td>
        ))}
      </tr>
      {expandedContent && (
        <tr className={`bg-gray-50 border-b border-border ${isExpanded ? '' : 'hidden'}`}>
          <td colSpan={colSpan} className="px-4 py-3 text-[13px] whitespace-normal">
            {expandedContent}
          </td>
        </tr>
      )}
    </>
  )
}
