/** Small assertion helper so validators read as a list of rules. */
export function rules() {
  const problems = [];
  return { check: (ok, msg) => { if (!ok) problems.push(msg); }, problems };
}
