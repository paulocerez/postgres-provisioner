import type { Database } from '@app/shared';
import { Link } from '@tanstack/react-router';
import {
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import { useLifecycleAction } from '../api/queries';
import { StatusBadge } from './StatusBadge';

const columnHelper = createColumnHelper<Database>();

function RowActions({ database }: { database: Database }) {
  const action = useLifecycleAction(database.uuid);
  const running = database.status === 'running';

  return (
    <div className="flex justify-end gap-2">
      <Link to="/db/$uuid" params={{ uuid: database.uuid }} className="btn-secondary">
        Details
      </Link>
      <button
        type="button"
        className="btn-secondary"
        disabled={action.isPending}
        onClick={() => action.mutate('restart')}
      >
        Restart
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={action.isPending}
        onClick={() => action.mutate(running ? 'stop' : 'start')}
      >
        {running ? 'Stop' : 'Start'}
      </button>
    </div>
  );
}

const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div>
        <Link
          to="/db/$uuid"
          params={{ uuid: info.row.original.uuid }}
          className="font-medium text-slate-900 hover:underline"
        >
          {info.getValue()}
        </Link>
        {info.row.original.description && (
          <p className="text-xs text-slate-500">{info.row.original.description}</p>
        )}
      </div>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor('version', {
    header: 'Version',
    cell: (info) => <span className="text-slate-600">{info.getValue()}</span>,
  }),
  columnHelper.accessor((row) => row.publicPort ?? 0, {
    id: 'publicPort',
    header: 'Port',
    cell: (info) =>
      info.row.original.publicPort ? (
        <span className="font-mono text-slate-700">{info.row.original.publicPort}</span>
      ) : (
        <span className="text-xs text-slate-400">internal only</span>
      ),
  }),
  columnHelper.accessor('sslEnabled', {
    header: 'SSL',
    cell: (info) => (info.getValue() ? 'yes' : 'no'),
  }),
  columnHelper.accessor((row) => row.backupsEnabled, {
    id: 'backups',
    header: 'Backups',
    cell: (info) => {
      const value = info.getValue();
      if (value === null) return <span className="text-xs text-slate-400">unknown</span>;
      return value ? 'yes' : 'no';
    },
  }),
  columnHelper.accessor((row) => row.meta?.project ?? '', {
    id: 'project',
    header: 'Project / owner',
    cell: (info) => {
      const meta = info.row.original.meta;
      if (!meta?.project && !meta?.owner) return <span className="text-slate-400">—</span>;
      return (
        <span className="text-slate-600">
          {meta.project ?? '—'}
          {meta.owner ? ` · ${meta.owner}` : ''}
        </span>
      );
    },
  }),
  columnHelper.accessor('createdAt', {
    header: 'Created',
    cell: (info) => {
      const value = info.getValue();
      if (!value) return <span className="text-slate-400">—</span>;
      const date = new Date(value);
      return (
        <span className="text-slate-600">
          {Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()}
        </span>
      );
    },
  }),
  columnHelper.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => <RowActions database={info.row.original} />,
  }),
];

export function DatabaseTable({ databases }: { databases: Database[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [filter, setFilter] = useState('');

  const table = useReactTable({
    data: databases,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-3">
      <input
        className="input max-w-xs"
        placeholder="Filter databases…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-2 font-medium">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={
                          header.column.getCanSort() ? 'flex items-center gap-1' : 'cursor-default'
                        }
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: '▲', desc: '▼' }[header.column.getIsSorted() as string] ?? ''}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                  {databases.length === 0
                    ? 'No databases yet.'
                    : 'No databases match that filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
