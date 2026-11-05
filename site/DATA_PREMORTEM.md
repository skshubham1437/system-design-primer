# Premortem: the site's content and data

Run on 2026-10-21 on branch `learning-features`. It covers everything a learner reads or is scored on: the upstream README and solutions as rendered, the site's own pages (labs, Databases, extras), quizzes, flashcards, exercises, decision aids, practice sets, recorded traces and the reference tables. The progress store was covered in the application premortem.

**Scenario:** It is October 2027. A learner scored 92% on every quiz, the progress page said they had mastered most topics, and they failed the database round of an interview. Afterwards they found they had mostly been picking the longest answer. They had also followed the site's "use CHAR, not VARCHAR" advice on a PostgreSQL schema. That advice sits on the main Database page, which never links to the site's own PostgreSQL section, and that section says the opposite.

**Scope:** 75 pages (16 learn, 14 labs, 21 Databases, 8 solutions, 6 object-oriented, reference and practice pages), 126 quiz questions in 24 files, 65 flashcards, 12 exercises, 1 decision aid, 1 practice set, 10 recorded traces and 49 diagrams. Checked by script where possible: every quiz question, every image's alt text, link targets and page lengths. The PostgreSQL facts below were checked on the real engine (PGlite, PostgreSQL 18.6). Upstream is in sync: `upstream/master` is `ae9bbd7` (2026-03-19), the same commit this branch is based on.

## Top risks

| # | Failure mode | Likelihood | Impact | Detectability | Status |
|---|---|---|---|---|---|
| 1 | In 91% of quiz questions the correct answer is the longest choice, so scores and spaced-repetition schedules measure test-taking, not knowledge | High | High | Silent | Confirmed |
| 2 | The upstream SQL tuning advice is wrong for PostgreSQL, contradicts the Databases section, and the page doesn't link to it | High | Med–High | Silent | Confirmed |
| 3 | No content on the site has had a second reader | High | High | Visible (Draft labels) | Confirmed |
| 4 | Dated reference data (latency numbers from about 2012) is shown with no date | Med | Med | Silent | Confirmed |
| 5 | Thin pages and missing interview topics remain | High | Med | Visible | Confirmed |
| 6 | All 49 diagrams have the same generic alt text | High | Med for screen-reader users | Silent | Confirmed |
| 7 | Sources are cited by title only, so nobody can click through to check a claim | Med | Low–Med | Silent | Confirmed |

## Failure stories

### 1. The longest answer is always right
**What happened:** Learners discovered, consciously or not, that the correct choice is almost always the longest and most qualified one. Quiz scores ran around 90% regardless of knowledge. The quiz spaced-repetition schedule then pushed missed concepts weeks into the future, and the progress page reported mastery that wasn't there.

**Evidence:** 115 of 126 questions (91%) have the correct answer as the strictly longest choice, and 109 (87%) have it at least 20% longer than every distractor. Chance would be about 25%. Every file is affected, from 3/5 (quorum) to 7/7 (load balancer). The distractors are often also implausible. For example, "Why does the estimator size servers at 70% busy?" offers "It saves storage" and "It is required by cloud providers" against an 84-character correct answer. Choice order is shuffled at runtime, but length isn't.

**Early warning:** a quiz average above 85% across all learners. There's no telemetry to see this, so it would never show up.

**Mitigation:**
- Rewrite the distractors of the 115 affected questions as plausible misconceptions of similar length and specificity. A good distractor is what someone who half-read the page would believe.
- Add a validator rule so this can't return: in each file, at most 40% of questions may have the longest choice correct, and no correct answer may be more than 1.3 times the length of the longest distractor.

### 2. The CHAR advice
**What happened:** A learner read "Tighten up the schema" on the main Database page and applied it in PostgreSQL. The advice is from MySQL (5.7-era links), and several points are wrong for PostgreSQL:

| Upstream says | On PostgreSQL 18.6 (run on the engine) |
|---|---|
| Use `CHAR` instead of `VARCHAR` for fixed-length fields: faster random access | `'abc'::char(10)` stores 14 bytes; `varchar(10)` and `text` store 7. The padding costs space. The PostgreSQL manual says there is no performance difference between the types apart from that, and `char(n)` is usually the slowest. |
| Use `INT` for numbers up to 2^32, about 4 billion | `integer` is signed: its maximum is 2,147,483,647 (about 2.1 billion), and `2147483647::int + 1` fails with "integer out of range". 4 billion is MySQL's `INT UNSIGNED`. Use `bigint` beyond that. |
| `VARCHAR(255)` maximizes the use of a byte | A MySQL storage detail. In PostgreSQL, `varchar(n)` and `text` are stored the same way, and 255 has no special meaning. |
| `TEXT` allows boolean searches | MySQL `FULLTEXT ... IN BOOLEAN MODE`. PostgreSQL has full-text search through `tsvector`/`tsquery` (works on the engine), typically with a GIN index. |
| Profile with the slow query log | The PostgreSQL equivalents are `log_min_duration_statement` and `pg_stat_statements`. |

The page also says "master-slave", while the Databases section says "primary" and "replica". Nothing on the page links to the Databases section, even though the plan calls it the entry point.

**Mitigation:**
- Add `content/extras/database.md`, which the build already shows as a labelled "Added on this site" section. It should say which advice is MySQL-specific, give the PostgreSQL behaviour above, map the terms, and link to the Databases section.
- Send the upstream fix as a PR if wanted, but don't count on it: upstream's 14 commits since 2024 are almost all link fixes, so a content correction may wait a long time.

### 3. Nothing has a second reader
**What happened:** All 24 quizzes, 12 exercises, 23 Databases flashcards, the decision aid, the practice set, 21 Databases pages and 14 labs are still marked Draft or `reviewed: false`.

**Mitigation:** see [ADVANCED_DB_PREMORTEM.md](ADVANCED_DB_PREMORTEM.md), risk 1. Fixing risk 1 here first means the reviewer checks the quizzes once, not twice.

### 4. Numbers from 2012 presented as current
**What happened:** A learner quoted "reading 1 MB sequentially from SSD takes 1 ms" in an interview. The latency table is the well-known list from about 2012. Its orders of magnitude still teach the right lesson, but storage and memory bandwidth have improved several-fold since, and the page gives no date.

**Mitigation:** add `content/extras/latency-numbers.md`. It should date the table, say that the ratios between rows are the lesson, and note which rows have moved most (SSD and memory bandwidth) without inventing precise modern figures.

### 5. Thin pages and missing topics
**What happened:** Interviewers asked about rate limiting, idempotent retries, unique ID generation and observability. None of these is covered; idempotency and unique IDs appear once in the README and nowhere on the site's own pages.

These pages are still very short:

| Page | Words |
|---|---|
| Powers of two | 54 |
| Performance vs scalability | 98 |
| Start here | 107 |
| Engineering blogs | 150 |
| Consistency patterns | 201 |
| Availability vs consistency | 208 |
| DNS | 249 |
| Reverse proxy | 258 |
| Application layer | 268 |

`CONTENT_REVIEW.md` listed these on 2026-10-10. The object-oriented walkthroughs from that list are done; the rest are open.

**Mitigation, in order of value:**
- A rate-limiting page with a lab
- Idempotency and retries
- Unique ID generation
- Worked examples on Consistency patterns and Performance vs scalability

### 6. Every diagram is "Diagram: Database"
**What happened:** A screen-reader user heard "Diagram: Database" eight times on one page and learned nothing from the diagrams. All 49 images get `Diagram: <page title>` as alt text. The accessibility checker passes because alt text exists.

**Mitigation:** add an alt-text override map (image file to a one-sentence description) for the diagrams that carry meaning, starting with the 8 on the Database page and the 6 on the AWS scaling solution.

### 7. Sources nobody can follow
**What happened:** A reviewer wanted to check a claim on "Reading EXPLAIN" against its source. The page lists "PostgreSQL documentation: *Using EXPLAIN* …" with no link, which is true of every Databases page. The site's own pages have just two raw URLs between them, and the weekly link check skips `site/` entirely.

**Mitigation:** link each source to a versioned URL (`postgresql.org/docs/18/…`, the MySQL 8.4 manual), and add `site/content/**/*.md` to the weekly link check.

## Lower priority
- **Flashcards:** the upstream "Communication" card's back is only a diagram and its source line. The other two upstream decks (OO Design, 6 cards; System Design Exercises, 8 cards) can only be downloaded, not studied on the site.
- **Practice coverage is thin:** practice mode on 1 of 8 solutions, 1 decision aid, quizzes on 3 of 16 learn pages and 7 of 21 Databases pages. This is fine to grow after the existing material is reviewed and fixed.
- **Traces:** recorded on PostgreSQL 18.3 while the in-browser engine is 18.6. Pages state the version, and the trace test pins major version 18.

## Already solid
- Quiz data is well formed: unique ids, no duplicate questions, answers in range, choices shuffled at runtime.
- Every Databases output comes from a real run, and the prose about outputs is now tested on every page that shows them.
- Remote diagrams are self-hosted. Dead upstream links are archived or marked, and a weekly job reports new breakage.
- The build fails if an upstream section or anchor vanishes, and validators check quizzes, exercises, decision aids and practice sets.
- The upstream copy is current: there is nothing to merge.

## Suggested next steps
1. Rewrite the quiz distractors and add the length rule (risk 1). Highest value, since every score depends on it.
2. Add the PostgreSQL notes and the link on the Database page (risk 2). Small, and it removes a direct contradiction.
3. Date the latency table (risk 4). Small.
4. Link sources and add own content to the weekly link check (risk 7).
5. Write alt text for the key diagrams (risk 6).
6. Then the missing topics and thin pages (risk 5), after review capacity exists.
