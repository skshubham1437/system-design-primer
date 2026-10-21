// Where learners report a content problem. Kept in its own module so client scripts can import it
// without pulling in the generated site data.
export const REPORT_URL = 'https://github.com/skshubham1437/system-design-primer/issues/new?template=content-problem.yml';

/** The report link for one page or item, with the issue title filled in. */
export const reportUrl = (title: string) => `${REPORT_URL}&title=${encodeURIComponent(title)}`;
