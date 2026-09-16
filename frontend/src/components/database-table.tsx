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
import { useRef, useState } from 'react';
import { useLifecycleAction } from '../api/queries';
import { useHotkeys } from '../hooks/use-hotkeys';
import { EmptyState } from './empty-state';
import { Kbd } from './kbd';
import { StatusBadge } from './status-badge';
import {
  ArrowUpIcon,
  ChevronRightIcon,
  DatabaseIcon,
  PlayIcon,
  RestartIcon,
  SearchIcon,
  StopIcon,
} from './icons';

const columnHelper = createColumnHelper<Database>();

function RowActions({ database }: { database: Database }) {
  const action = useLifecycleAction(database.uuid);
  const running = database.status === 'running';

  return (
    // Hidden until the row is hovered or something inside it takes focus, so a
    // long list reads as data rather than as a wall of buttons. `focus-within`
    // keeps them reachable by keyboard.
    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button
        type="button"
        className="btn-ghost btn-icon"
        disabled={action.isPending}
        title="Restart"
        aria-label={`Restart ${database.name}`}
        onClick={() => action.mutate('restart')}
      >
        <RestartIcon />
      </button>
      <button
        type="button"
        className="btn-ghost btn-icon"
        disabled={action.isPending}
        title={running ? 'Stop' : 'Start'}
        aria-label={`${running ? 'Stop' : 'Start'} ${database.name}`}
        onClick={() => action.mutate(running ? 'stop' : 'start')}
      >
        {running ? <StopIcon /> : <PlayIcon />}
      </button>
      <Link
        to="/db/$uuid"
        params={{ uuid: database.uuid }}
        className="btn-ghost btn-icon"
        title="Open details"
        aria-label={`Open ${database.name}`}
      >
        <ChevronRightIcon />
      </Link>
    </div>
  );
}

const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div className="min-w-0">
        <Link
          to="/db/$uuid"
          params={{ uuid: info.row.original.uuid }}
          className="font-medium text-fg hover:text-accent"
        >
          {info.getValue()}
        </Link>
        {info.row.original.description && (
          <p className="truncate text-xs text-subtle">{info.row.original.description}</p>
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
    cell: (info) => <span className="tabular-nums text-muted">{info.getValue()}</span>,
  }),
  columnHelper.accessor((row) => row.publicPort ?? 0, {
    id: 'publicPort',
    header: 'Port',
    cell: (info) =>
      info.row.original.publicPort ? (
        <span className="font-mono text-xs text-muted">{info.row.original.publicPort}</span>
      ) : (
        <span className="text-xs text-subtle">internal</span>
      ),
  }),
  columnHelper.accessor('sslEnabled', {
    header: 'SSL',
    // A public port without SSL means passwords cross the internet in the
    // clear, so it is called out rather than shown as a quiet "no".
    cell: (info) =>
      info.getValue() ? (
        <span className="text-muted">on</span>
      ) : (
        <span
          className="badge-danger"
          title={
            info.row.original.isPublic
              ? 'SSL is off and this database is exposed on a host port — connections are unencrypted.'
              : 'SSL is off for this database.'
          }
        >
          off
        </span>
      ),
  }),
  columnHelper.accessor((row) => row.backupsEnabled, {
    id: 'backups',
    header: 'Backups',
    cell: (info) => {
      const value = info.getValue();
      if (value === null) return <span className="text-xs text-subtle">unknown</span>;
      return <span className="text-muted">{value ? 'on' : 'off'}</span>;
    },
  }),
  columnHelper.accessor((row) => row.meta?.project ?? '', {
    id: 'project',
    header: 'Project / owner',
    cell: (info) => {
      const meta = info.row.original.meta;
      if (!meta?.project && !meta?.owner) return <span className="text-subtle">—</span>;
      return (
        <span className="text-muted">
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
      if (!value) return <span className="text-subtle">—</span>;
      const date = new Date(value);
      return (
        <span className="whitespace-nowrap text-muted">
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
  const filterRef = useRef<HTMLInputElement>(null);

  useHotkeys({ '/': () => filterRef.current?.focus() });

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

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          ref={filterRef}
          className="input pl-8 pr-9"
          placeholder="Filter databases…"
          aria-label="Filter databases"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && event.currentTarget.blur()}
        />
        {!filter && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="table-head">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th key={header.id} className="h-8 px-3 font-medium">
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded transition-colors hover:text-fg"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <ArrowUpIcon
                              width="11"
                              height="11"
                              className={`transition-transform ${
                                sorted === 'desc' ? 'rotate-180' : ''
                              } ${sorted ? 'text-fg' : 'opacity-0'}`}
                            />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id} className="group transition-colors hover:bg-raised/60">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 &&
          (databases.length === 0 ? (
            <EmptyState
              icon={<DatabaseIcon />}
              title="No databases yet"
              description="Create one and it will be provisioned in Coolify and listed here."
              action={
                <Link to="/new" className="btn-primary">
                  New database
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<SearchIcon />}
              title="No matches"
              description={`Nothing matches “${filter}”.`}
              action={
                <button type="button" className="btn-secondary" onClick={() => setFilter('')}>
                  Clear the filter
                </button>
              }
            />
          ))}
      </div>
    </div>
  );
}
