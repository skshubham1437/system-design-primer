// Sign-off rules shared by every kind of authored content. The checklist in CONTENT_GUIDE.md says a reviewer must
// not be the author and must check the content first; these fields make that checkable. Nothing is required while
// `reviewed` is false, so drafts stay easy to write. Once a file says `reviewed: true`, it must also name its author,
// name a different reviewer, and give the date of the review.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {any} d the parsed content file
 * @param {string} where the file name, for messages
 * @param {(ok: boolean, message: string) => void} check
 */
export function checkSignOff(d, where, check) {
  if (d?.reviewed !== true) return;
  const author = typeof d.author === 'string' ? d.author.trim() : '';
  const reviewer = typeof d.reviewed_by === 'string' ? d.reviewed_by.trim() : '';
  check(author.length > 0, `${where}: "author" must name who wrote the content (required once reviewed is true)`);
  check(reviewer.length > 0, `${where}: "reviewed_by" must name the reviewer (required once reviewed is true)`);
  check(!author || !reviewer || author.toLowerCase() !== reviewer.toLowerCase(), `${where}: the reviewer must not be the author`);
  check(typeof d.reviewed_on === 'string' && DATE.test(d.reviewed_on), `${where}: "reviewed_on" must be the review date, as YYYY-MM-DD`);
}
