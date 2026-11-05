// The sample database, running in a Web Worker so long queries never freeze the page.
// It is created and filled with the sample shop data when the worker starts.
import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import seed from '../../../content/databases/seed.sql?raw';

worker({
  async init() {
    const db = new PGlite();
    await db.exec(seed);
    await db.exec('vacuum analyze'); // separate: VACUUM cannot run inside a multi-statement string
    return db;
  },
});
