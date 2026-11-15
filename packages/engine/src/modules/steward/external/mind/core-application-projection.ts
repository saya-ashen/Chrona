import type { ApplicationFocus } from './core-application';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const notices = ['installedError', 'executionGap', 'checking', 'settingsGap', 'historyNotice'];

/** Select records from the reviewed apps overview, without interpreting success or inventing missing facts. */
export function projectApplicationOverview(body: unknown, focus: ApplicationFocus) {
  // A changed/unsupported response remains fully readable rather than being silently reduced to an empty result.
  if (!object(body) || !Array.isArray(body.installed)) return undefined;
  const directory = body.installed;
  const installed = directory.filter(row => object(row) &&
    (!focus.moduleId || row.id === focus.moduleId) && (!focus.name || row.name === focus.name));
  const names = new Set(installed.filter(object).map(row => row.name).filter((name): name is string => typeof name === 'string'));
  // Source records have names rather than installed IDs; retain their errors even when the directory failed.
  if (focus.name) names.add(focus.name);
  const matches = (row: unknown) => {
    if (!object(row)) return false;
    const target = object(row.target) ? row.target : undefined;
    if (focus.moduleId && target?.moduleId) return target.moduleId === focus.moduleId && (!focus.name || row.name === focus.name);
    return names.has(row.name as string);
  };
  const response: Record<string, unknown> = { installed };
  const omitted: { path: string; records?: number }[] = [];
  Object.entries(body).forEach(([key, value]) => {
    if (key === 'installed') {
      omitted.push({ path: key, records: directory.length - installed.length });
    } else if (['official', 'materials', 'localMaterials'].includes(key) && Array.isArray(value)) {
      const selected = value.filter(matches);
      response[key] = selected; omitted.push({ path: key, records: value.length - selected.length });
    } else if (key === 'managed' && object(value)) {
      const selected = Object.entries(value).filter(([name, row]) => object(row) &&
        (focus.moduleId ? row.moduleId === focus.moduleId && (!focus.name || name === focus.name) : names.has(name)));
      response[key] = Object.fromEntries(selected); omitted.push({ path: key, records: Object.keys(value).length - selected.length });
    } else if (notices.includes(key)) response[key] = value;
    else omitted.push({ path: key });
  });
  const title = installed.filter(object).find(row => typeof row.name === 'string')?.name;
  return { response, title: typeof title === 'string' ? title : undefined,
    projection: { kind: 'apps-overview-focus', focus, complete: false, omitted,
      notice: 'Only matching application records and overview notices are included. Omitted information is not verified; a missing match does not prove absence. responseDigest identifies the complete original sanitized reply, not this projection. Read this receipt with full:true for the complete response.' } };
}
