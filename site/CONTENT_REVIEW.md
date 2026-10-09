# Content review

A review of everything currently on the site: what is good, what is weak, what was fixed, what was added, and what still needs doing. Findings are grouped so they can be turned into work.

## How this review was done

| Method | Covers |
|---|---|
| **Automated audit** (`node scripts/audit-content.mjs --links`) | All 45 original pages: length, structure, media, and a live request to every one of the 320 distinct external links |
| **Read closely** | Study guide, How to approach a question, Latency vs throughput, Security, Cache, Load balancer, Database (replication through denormalization, and SQL or NoSQL), DNS, CDN, TCP and UDP, back pressure, the Appendix tables, and the Pastebin solution |
| **Skimmed or measured only** | The other seven solutions, the NoSQL sections, SQL tuning, REST and RPC, HTTP, microservices, and the six object-oriented notebooks |

Findings about the second group are judgements from structure and length, not a line-by-line check. They should be confirmed by someone reading the pages.

## What is good

- **The Cache, Load balancer, Database and Communication sections are the strong core.** They explain, give trade-offs under a consistent "Disadvantage(s)" pattern, and link out for depth.
- **The solutions follow one four-step structure**, which makes them teachable, and they tie back to the topic pages.
- **Most of the 320 external links still work**: 276 answered normally.
- **The "everything is a trade-off" framing runs through the whole guide**, which is the right lesson.

## Findings

### Bugs in how the content was shown (fixed)

| Finding | Effect | Status |
|---|---|---|
| Citations written as `<sup><a href=URL>1</a></sup>` rendered as the literal text `<a href=` followed by a mangled link (`...%3E1`) | Visible junk and a broken link on the README pages that use that markup and in at least six solutions | **Fixed** in the build, with a test |
| Dead external links gave a bare 404 | 11 links: Zynga, Salesforce, OWASP, MySQL query cache and others | **Fixed**: 4 now point to an archived copy, 7 are marked "(link broken)" instead of failing silently |
| White-background diagrams glared in dark mode | Hard to read at night | **Fixed**: inverted by default with an "Original colours" button |
| Code colours failed the contrast check in both themes | Hard to read for some people | **Fixed**: switched to the high-contrast themes |

### Content gaps (still open)

1. **Several topic pages are very thin**, which makes them lists of links rather than explanations.

   | Page | Words | Assessment | State |
   |---|---|---|---|
   | Latency vs throughput | 47 | Two definitions and a link | **Extended** with an analogy, trade-offs, and the load-curve lab |
   | Security | 97 | Four bullet points | **Extended** with authN vs authZ, encryption, input handling, secrets, defence in depth |
   | Performance vs scalability | 98 | Two definitions | Now has the load-curve lab; **still needs written examples** |
   | Start here | 107 | Two links to external lectures | Needs the guided scaling path (planned) |
   | Consistency patterns | 201 | Three definitions, no examples | **Open**: add one concrete example each (a chat app, DNS, a bank) |
   | Availability vs consistency | 208 | CAP in two paragraphs | Has the CAP lab; **a worked example would help** |
   | DNS, Reverse proxy, Application layer | 249 to 268 | Define the idea, show one figure | DNS now has a lab; the other two are **open** |

2. **The six object-oriented exercises have almost no prose** (43 to 127 words each). They show a problem statement and code but no walkthrough, so a learner sees the answer without the reasoning. This is the largest gap in the Practice section. *Needs a "how to think about it" walkthrough per exercise.*
3. **The 40 "real-world architectures" and 40 "company architectures" entries are bare link tables.** They teach nothing on their own page. *Needs a handful of written summaries (planned, item 9).*
4. **Interview topics that are not covered at all**: rate limiting, unique ID generation, idempotency and retries, pagination, observability (logs, metrics, traces, SLOs). *Planned, item 10.*
5. **No worked numbers on most topic pages.** The solutions do the arithmetic well; the topic pages rarely say what "a lot" means. The capacity estimator and the latency numbers help but are not linked from where the question arises. *Add a "rough numbers" line to Cache, Database and Load balancer.*
6. **The Appendix "Powers of two" page is 11 words and a code block.** It now has a calculator but no explanation of why these numbers matter in an interview.

### Wording issues in the upstream text (not changed here)

These are in the upstream README and would be better fixed there, as pull requests, than patched in this copy:

- HTTP verb table: "Creates or replace a resource" should read "creates or replaces" (README line 1385).
- Layer 7 load balancing: "terminate network traffic, reads the message, makes a decision" mixes tenses (README line 696).
- The superscript citation markup that caused the bug above should use quoted attributes.
- The idempotency footnote ("Can be called many times without different outcomes") is correct but could say "the same outcome" to be easier to read.

### Link health

- 320 distinct external links: **276 answer, 33 refuse automated requests** (403 or 429; mostly Quora, Stack Overflow, Medium and similar, so unverified rather than dead), **11 dead**.
- Dead links by page: CDN (1), application layer (1), communication (3), security (1), database (2), engineering blogs (2), web crawler (1).
- The audit and `link-overrides` scripts can be re-run any time. The weekly workflow reports new breakage as an issue.

## What was added in response

| Gap | Added |
|---|---|
| Hard-to-picture topics | Seven interactive visuals: replication, sharding, queues and back pressure, DNS lookup, CDN push and pull, TCP vs UDP, the load curve (plus the five earlier labs) |
| Thin pages | Extended Security and Latency vs throughput, clearly labelled "Added on this site" |
| Reading is passive | Quizzes, spaced flashcards, "Try it first" practice mode with rubrics and follow-up questions, a SQL vs NoSQL decision aid |
| No sense of progress | Dashboard, read tracking, sidebar marks, solution status |
| Dead links | Archived copies where they exist, visible markers where they do not |

## Why interactive visuals and not GIFs

The request was for a GIF or something interactive. Interactive won, for these reasons:

- **A GIF cannot be paused, stepped or changed.** The whole point of the replication and queue pages is that you change a setting and see the result.
- **A GIF is a fixed picture.** It cannot follow dark mode, and it is typically 1 to 5 MB; these visuals are a few kilobytes of code.
- **Accessibility.** A GIF cannot be keyboard operated, cannot honour "reduce motion", and has no text equivalent. Each visual here does all three and is checked for contrast and keyboard use on every build.
- **They are tested.** The simulation behind each picture has unit tests, so the picture cannot quietly show something false.

If an animated image is needed for somewhere that cannot run scripts, such as a social post or the repository README, it can be recorded from these visuals later.

## Recommended next steps, in order

1. **Review the draft content before it is trusted.** Nothing in `content/quizzes`, `content/practice` or `content/choosers` has had a second reader; the "reviewed" flag is false everywhere and learners see a Draft notice. Follow [PILOT.md](PILOT.md).
2. **Write walkthroughs for the six object-oriented exercises.** Biggest single gap for learners.
3. **Add a worked example to Consistency patterns, Performance vs scalability and Reverse proxy.**
4. **Write the missing interview topics**, starting with rate limiting (with a lab).
5. **Replace the two link tables with written architecture summaries** for Netflix, Twitter, Uber and Dropbox first.
6. **Send the upstream wording fixes** as a pull request to the original repository.
7. **Roll the practice-mode format out to the other seven solutions** once the Pastebin pilot passes.
