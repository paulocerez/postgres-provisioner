/**
 * Deep link into the Coolify UI for a database, in the one place that knows the
 * format. Coolify 4.x routes these as
 * `/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}`:
 * the literal `environment/` segment is required, and the environment is looked
 * up by uuid, not by name — a name matches no route and renders a blank page.
 *
 * Returns the Coolify root when a part is missing (unresolved project, meta not
 * loaded yet) — a slightly worse link beats a broken one.
 */
export function coolifyDatabasePath(
  base: string,
  projectUuid: string | null | undefined,
  environmentUuid: string | null | undefined,
  databaseUuid: string,
): string {
  const root = base.replace(/\/$/, '');
  if (!projectUuid || !environmentUuid) return root;
  return `${root}/project/${projectUuid}/environment/${environmentUuid}/database/${databaseUuid}`;
}
