// Turning engine results into HTML: result tables, plan text and errors. Shared by the playground and exercises.
import type { Result } from './engine';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const MAX_ROWS = 200;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '<span class="db-null">NULL</span>';
  if (v instanceof Date) return esc(v.toISOString().replace('T', ' ').replace(/\.000Z$/, '+00'));
  if (typeof v === 'object') return esc(JSON.stringify(v));
  return esc(String(v));
}

export function resultHtml(r: Result, label = 'Query result'): string {
  if (!r.fields?.length) {
    return `<p class="db-none">Done.${r.affectedRows !== undefined ? ` ${r.affectedRows} row${r.affectedRows === 1 ? '' : 's'} affected.` : ''}</p>`;
  }
  const shown = r.rows.slice(0, MAX_ROWS);
  const more = r.rows.length > MAX_ROWS ? `<p class="db-none">Showing the first ${MAX_ROWS} of ${r.rows.length.toLocaleString('en-US')} rows.</p>` : '';
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(label)} (scrolls sideways on small screens)"><table class="db-table">
    <thead><tr>${r.fields.map((f) => `<th scope="col">${esc(f.name)}</th>`).join('')}</tr></thead>
    <tbody>${shown.map((row) => `<tr>${r.fields.map((f) => `<td>${cell(row[f.name])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>${more}`;
}

export const planTextHtml = (lines: string[], label = 'Query plan') =>
  `<pre class="db-out" tabindex="0" role="region" aria-label="${esc(label)}">${esc(lines.join('\n'))}</pre>`;

export const errorHtml = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return `<p class="db-error" role="alert"><b>Error.</b> ${esc(msg)}</p>`;
};

/** Remove one trailing semicolon and surrounding space, so a statement can be wrapped in EXPLAIN. */
export const oneStatement = (sql: string) => sql.trim().replace(/;\s*$/, '');

/** True if the text holds more than one statement. Ignores semicolons inside quotes and comments. */
export function hasSeveralStatements(sql: string): boolean {
  const s = oneStatement(sql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^']|'')*'/g, "''").replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '$$');
  return s.includes(';');
}
