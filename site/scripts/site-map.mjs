// Maps sections of the upstream README onto pages of the site.
// The README stays the single source of truth; this file only decides
// where each section lives, how it is grouped and how it is described.

export const REPO = 'https://github.com/donnemartin/system-design-primer';

export const GROUPS = [
  { id: 'start', label: 'Start here' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'network', label: 'Network & edge' },
  { id: 'application', label: 'Application' },
  { id: 'data', label: 'Data' },
  { id: 'labs', label: 'Labs' },
  { id: 'databases', label: 'Databases' },
  { id: 'practice', label: 'Practice' },
  { id: 'reference', label: 'Reference' },
];

// Every entry becomes one page. `h2` (or `h3` for appendix entries) is the
// heading text in README.md that the page is cut from.
export const PAGES = [
  // Start here
  { h2: 'System design topics: start here', section: 'learn', slug: 'start-here', group: 'start', title: 'Start here', blurb: 'The best primers to watch and read before diving into the details.' },
  { h2: 'Study guide', section: 'interview', slug: 'study-guide', group: 'start', title: 'Study guide', blurb: 'What to review for a short, medium or long interview timeline.' },
  { h2: 'How to approach a system design interview question', section: 'interview', slug: 'approach', group: 'start', title: 'Approaching an interview question', blurb: 'A four-step framework for leading an open-ended design conversation.' },

  // Fundamentals
  { h2: 'Performance vs scalability', section: 'learn', slug: 'performance-vs-scalability', group: 'fundamentals', title: 'Performance vs scalability', blurb: 'Slow for one user, or slow only under load? Two different problems.' },
  { h2: 'Latency vs throughput', section: 'learn', slug: 'latency-vs-throughput', group: 'fundamentals', title: 'Latency vs throughput', blurb: 'Time to do one thing versus how many things you can do per second.' },
  { h2: 'Availability vs consistency', section: 'learn', slug: 'availability-vs-consistency', group: 'fundamentals', title: 'Availability vs consistency', blurb: 'The CAP theorem and why a network partition forces a choice.' },
  { h2: 'Consistency patterns', section: 'learn', slug: 'consistency-patterns', group: 'fundamentals', title: 'Consistency patterns', blurb: 'Weak, eventual and strong consistency, and where each one fits.' },
  { h2: 'Availability patterns', section: 'learn', slug: 'availability-patterns', group: 'fundamentals', title: 'Availability patterns', blurb: 'Fail-over, replication and what the nines really mean.' },

  // Network & edge
  { h2: 'Domain name system', section: 'learn', slug: 'dns', group: 'network', title: 'Domain name system', blurb: 'How names become addresses, and what can go wrong on the way.' },
  { h2: 'Content delivery network', section: 'learn', slug: 'cdn', group: 'network', title: 'Content delivery network', blurb: 'Serve content from a location near the user: push vs pull CDNs.' },
  { h2: 'Load balancer', section: 'learn', slug: 'load-balancer', group: 'network', title: 'Load balancer', blurb: 'Spread requests across servers; layer 4 vs layer 7; horizontal scaling.' },
  { h2: 'Reverse proxy (web server)', section: 'learn', slug: 'reverse-proxy', group: 'network', title: 'Reverse proxy', blurb: 'A front door for your servers, and how it differs from a load balancer.' },

  // Application
  { h2: 'Application layer', section: 'learn', slug: 'application-layer', group: 'application', title: 'Application layer', blurb: 'Separate the web tier from the app tier: microservices and service discovery.' },
  { h2: 'Asynchronism', section: 'learn', slug: 'asynchronism', group: 'application', title: 'Asynchronism', blurb: 'Message queues, task queues and back pressure.' },
  { h2: 'Communication', section: 'learn', slug: 'communication', group: 'application', title: 'Communication', blurb: 'HTTP, TCP, UDP, RPC and REST, and when to reach for each.' },
  { h2: 'Security', section: 'learn', slug: 'security', group: 'application', title: 'Security', blurb: 'The essentials: encryption, sanitising input, least privilege.' },

  // Data
  { h2: 'Database', section: 'learn', slug: 'database', group: 'data', title: 'Database', blurb: 'Replication, federation, sharding, denormalisation, NoSQL, and SQL vs NoSQL.' },
  { h2: 'Cache', section: 'learn', slug: 'cache', group: 'data', title: 'Cache', blurb: 'Where to cache, what to cache, and the four ways to keep a cache fresh.' },

  // Practice
  { h2: 'Anki flashcards', section: 'practice', slug: 'flashcards', group: 'practice', title: 'Flashcards', blurb: 'Spaced-repetition Anki decks for concepts and exercises.' },
  { h3: 'Additional system design interview questions', section: 'practice', slug: 'more-questions', group: 'practice', title: 'More interview questions', blurb: 'Common questions, each with links to resources on how to solve it.' },

  // Reference
  { h3: 'Powers of two table', section: 'reference', slug: 'powers-of-two', group: 'reference', title: 'Powers of two', blurb: 'Handy for back-of-the-envelope estimates.' },
  { h3: 'Latency numbers every programmer should know', section: 'reference', slug: 'latency-numbers', group: 'reference', title: 'Latency numbers', blurb: 'From an L1 cache hit to a trans-Atlantic round trip.' },
  { h3: 'Real world architectures', section: 'reference', slug: 'real-world-architectures', group: 'reference', title: 'Real-world architectures', blurb: 'MapReduce, Bigtable, Kafka, Dynamo and other systems worth studying.' },
  { h3: 'Company architectures', section: 'reference', slug: 'company-architectures', group: 'reference', title: 'Company architectures', blurb: 'How Netflix, Twitter, Uber and others are put together.' },
  { h3: 'Company engineering blogs', section: 'reference', slug: 'engineering-blogs', group: 'reference', title: 'Engineering blogs', blurb: 'Read the blog of the company you are interviewing with.' },
];

// README H2 sections folded into the About page.
export const ABOUT_H2 = ['Motivation', 'Contributing', 'Under development', 'Credits', 'Contact info', 'License'];

// README sections that are replaced by generated UI (their anchors are redirected).
export const ANCHOR_OVERRIDES = {
  'index-of-system-design-topics': 'learn/',
  'system-design-interview-questions-with-solutions': 'practice/#system-design',
  'object-oriented-design-interview-questions-with-solutions': 'practice/#object-oriented',
  'coding-resource-interactive-coding-challenges': 'practice/flashcards/#coding-resource-interactive-coding-challenges',
};
export const SKIPPED_H2 = [
  'Index of system design topics',
  'System design interview questions with solutions',
  'Object-oriented design interview questions with solutions',
];

export const SOLUTIONS = {
  pastebin: { short: 'Pastebin', blurb: 'A URL-shortening and text-sharing service: hashing, expiry and read-heavy traffic.', difficulty: 'Starter' },
  twitter: { short: 'Twitter timeline', blurb: 'Timeline fan-out, a home feed and search for hundreds of millions of users.', difficulty: 'Advanced' },
  web_crawler: { short: 'Web crawler', blurb: 'Crawl billions of links without repeating work, then rank and serve the results.', difficulty: 'Intermediate' },
  mint: { short: 'Mint.com', blurb: 'Pull in transactions from many banks, categorise spending and send budget alerts.', difficulty: 'Intermediate' },
  social_graph: { short: 'Social graph', blurb: 'Shortest path and friend-of-friend queries over a very large social graph.', difficulty: 'Intermediate' },
  query_cache: { short: 'Query cache', blurb: 'A key-value store that fronts a search engine and evicts with LRU.', difficulty: 'Intermediate' },
  sales_rank: { short: 'Sales rank', blurb: 'Compute the best-selling products per category from a stream of orders.', difficulty: 'Intermediate' },
  scaling_aws: { short: 'Scaling on AWS', blurb: 'Grow from one box to millions of users, one bottleneck at a time.', difficulty: 'Advanced' },
};

export const OOD = {
  hash_table: { blurb: 'Build a hash map: hashing, buckets and collision handling.' },
  lru_cache: { blurb: 'A least-recently-used cache with a linked list and a lookup table.' },
  call_center: { blurb: 'Route calls through operators, supervisors and directors.' },
  deck_of_cards: { blurb: 'Model cards, hands and a generic deck, then a game of blackjack.' },
  parking_lot: { blurb: 'Vehicles, spots and levels for a multi-level parking garage.' },
  online_chat: { blurb: 'Users, chats, requests and messages for a chat server.' },
};

// Interactive widgets layered on top of a page. `wrap` finds the first matching block and tags it
// (the original stays in the page as the no-JS fallback); `append` adds an empty mount point.
export const WIDGETS = {
  'interview/study-guide/': { type: 'study-planner', wrap: 'table' },
  'reference/latency-numbers/': { type: 'latency', wrap: 'code' },
  'reference/powers-of-two/': { type: 'powers', wrap: 'code' },
  'learn/availability-patterns/': { type: 'nines', append: true },
};

// Original, interactive pages that live in site/content/labs/<slug>.md. Each markdown file
// mounts its widget with a raw <div data-widget="..."></div>.
export const LABS = [
  { slug: 'scaling-story', title: 'From one user to millions', blurb: 'Follow one product as it grows, nine stages at a time, and see which problem each building block solves.' },
  { slug: 'estimator', title: 'Capacity estimator', blurb: 'Turn users and request sizes into QPS, storage, bandwidth and server counts.' },
  { slug: 'consistent-hashing', title: 'Consistent hashing', blurb: 'Add and remove nodes on a hash ring and see how few keys have to move.' },
  { slug: 'cache-eviction', title: 'Cache eviction', blurb: 'Replay the same traffic through LRU, LFU, FIFO and random eviction.' },
  { slug: 'load-balancing', title: 'Load balancing', blurb: 'Compare round robin, least connections, hashing and weighted routing under load.' },
  { slug: 'load-curve', title: 'The load curve', blurb: 'See why response time explodes near full utilisation, and how adding servers moves you back.' },
  { slug: 'replication', title: 'Replication', blurb: 'Write to a primary, read from replicas, then crash the primary and count what is lost.' },
  { slug: 'sharding', title: 'Sharding strategies', blurb: 'Split 600 users across shards by range, hash or lookup table and see which one tips over.' },
  { slug: 'message-queue', title: 'Queues and back pressure', blurb: 'Make a producer faster than its consumers and watch the queue fill, drop, or push back.' },
  { slug: 'dns-resolution', title: 'DNS lookup', blurb: 'Walk a lookup from browser to authoritative server and see how caches skip the walk.' },
  { slug: 'cdn', title: 'CDN edge caching', blurb: 'Request a file from three continents with no CDN, a pull CDN and a push CDN.' },
  { slug: 'tcp-udp', title: 'TCP vs UDP', blurb: 'Send the same packets over a lossy link and compare what arrives, and when.' },
  { slug: 'cap-theorem', title: 'CAP in practice', blurb: 'Partition a three-node store and watch it choose between consistency and availability.' },
];

// Topic page -> labs worth trying from it.
export const RELATED_LABS = {
  'learn/start-here/': ['labs/scaling-story/'],
  'learn/cache/': ['labs/cache-eviction/'],
  'learn/dns/': ['labs/dns-resolution/'],
  'learn/cdn/': ['labs/cdn/'],
  'learn/asynchronism/': ['labs/message-queue/'],
  'learn/communication/': ['labs/tcp-udp/'],
  'learn/load-balancer/': ['labs/load-balancing/', 'labs/load-curve/'],
  'learn/availability-vs-consistency/': ['labs/cap-theorem/'],
  'learn/consistency-patterns/': ['labs/cap-theorem/'],
  'learn/availability-patterns/': ['labs/cap-theorem/'],
  'learn/database/': ['labs/replication/', 'labs/sharding/', 'labs/consistent-hashing/', 'labs/estimator/', 'databases/playground/'],
  'learn/performance-vs-scalability/': ['labs/load-curve/', 'labs/estimator/'],
  'learn/latency-vs-throughput/': ['labs/load-curve/', 'labs/estimator/'],
  'interview/approach/': ['labs/estimator/'],
  'reference/powers-of-two/': ['labs/estimator/'],
  'reference/latency-numbers/': ['labs/estimator/'],
};

// Page -> pages worth reading first ("Before this"). The build checks that every path exists
// and that the chain never loops back on itself.
export const PREREQS = {
  'learn/latency-vs-throughput/': ['learn/performance-vs-scalability/'],
  'learn/availability-vs-consistency/': ['learn/performance-vs-scalability/'],
  'learn/consistency-patterns/': ['learn/availability-vs-consistency/'],
  'learn/availability-patterns/': ['learn/consistency-patterns/'],
  'learn/cdn/': ['learn/dns/'],
  'learn/load-balancer/': ['learn/dns/'],
  'learn/reverse-proxy/': ['learn/load-balancer/'],
  'learn/application-layer/': ['learn/load-balancer/'],
  'learn/asynchronism/': ['learn/application-layer/'],
  'learn/database/': ['learn/consistency-patterns/'],
  'learn/cache/': ['learn/database/'],
  'labs/replication/': ['learn/database/'],
  'labs/sharding/': ['learn/database/'],
  'labs/cap-theorem/': ['learn/availability-vs-consistency/'],
  'labs/message-queue/': ['learn/asynchronism/'],
  'labs/cache-eviction/': ['learn/cache/'],
  'labs/consistent-hashing/': ['learn/database/'],
  'labs/load-balancing/': ['learn/load-balancer/'],
  'labs/load-curve/': ['learn/performance-vs-scalability/', 'learn/latency-vs-throughput/'],
  'labs/dns-resolution/': ['learn/dns/'],
  'labs/cdn/': ['learn/cdn/'],
  'labs/tcp-udp/': ['learn/communication/'],
  'labs/estimator/': ['interview/approach/'],
  'databases/how-rows-are-stored/': ['learn/database/'],
  'databases/btree-indexes/': ['databases/how-rows-are-stored/'],
  'databases/index-design/': ['databases/btree-indexes/'],
  'databases/scan-types/': ['databases/btree-indexes/'],
  'databases/reading-plans/': ['databases/scan-types/'],
  'databases/joins/': ['databases/reading-plans/'],
  'databases/statistics/': ['databases/reading-plans/'],
  'databases/pagination-and-n-plus-one/': ['databases/btree-indexes/'],
  'databases/query-checklist/': ['databases/reading-plans/'],
  'databases/tuning-exercises/': ['databases/reading-plans/'],
  'databases/transactions/': ['databases/how-rows-are-stored/'],
  'databases/ctes/': ['databases/reading-plans/'],
  'databases/window-functions/': ['databases/ctes/'],
  'databases/views-functions-triggers/': ['databases/ctes/'],
  'databases/partitioning/': ['databases/scan-types/'],
  'databases/sharding-and-scale/': ['databases/partitioning/'],
  'databases/isolation-and-mvcc/': ['databases/transactions/'],
  'databases/locks-and-deadlocks/': ['databases/isolation-and-mvcc/'],
  'databases/connection-pooling/': ['databases/transactions/'],
};

// The Databases section: original pages in site/content/databases/<slug>.md, grouped into modules.
// Pages run their SQL examples against the sample database at build time (see scripts/lib/db-runs.mjs).
export const DB_MODULES = [
  { id: 'start', label: 'Start here' },
  { id: 'storage', label: 'How data is stored and found' },
  { id: 'plans', label: 'Reading query plans' },
  { id: 'sql', label: 'Writing faster SQL' },
  { id: 'concurrency', label: 'Concurrency' },
  { id: 'scale', label: 'Scaling a table' },
  { id: 'practice', label: 'Practice' },
];

export const DB_PAGES = [
  { slug: 'playground', module: 'start', title: 'SQL playground', blurb: 'A real PostgreSQL database in your browser, loaded with a sample shop. Run queries and read their plans.', draft: true },
  { slug: 'how-rows-are-stored', module: 'storage', title: 'How a table is stored', blurb: 'Pages, row addresses, row versions, VACUUM and the write-ahead log: what a table is on disk.', draft: true },
  { slug: 'btree-indexes', module: 'storage', title: 'B-tree indexes', blurb: 'How the default index finds one row among millions in three or four page reads, and what it costs.', draft: true },
  { slug: 'index-design', module: 'storage', title: 'Designing indexes', blurb: 'Column order, covering, partial and expression indexes, and when an index is ignored or hurts.', draft: true },
  { slug: 'scan-types', module: 'storage', title: 'Scan types', blurb: 'Sequential, index, bitmap and index-only scans, and how the planner chooses between them.', draft: true },
  { slug: 'reading-plans', module: 'plans', title: 'Reading EXPLAIN', blurb: 'Read a query plan line by line, spot the red flags, and use the plan to fix a slow query.', draft: true },
  { slug: 'joins', module: 'plans', title: 'Join algorithms', blurb: 'Nested loop, hash and merge joins: how each works, what it costs, and when the planner picks it.', draft: true },
  { slug: 'statistics', module: 'plans', title: 'Planner statistics', blurb: 'What ANALYZE records, how estimates are made, and why they go wrong.', draft: true },
  { slug: 'pagination-and-n-plus-one', module: 'sql', title: 'Pagination and N+1', blurb: 'Why OFFSET gets slower every page, keyset pagination, and replacing many small queries with one.', draft: true },
  { slug: 'ctes', module: 'sql', title: 'Common table expressions', blurb: 'WITH for readable steps, inlined or materialized CTEs, recursive queries and data changes in one statement.', draft: true },
  { slug: 'window-functions', module: 'sql', title: 'Window functions and materialized views', blurb: 'Rankings, top N per group, running totals and previous-row comparisons; storing an expensive result.', draft: true },
  { slug: 'views-functions-triggers', module: 'sql', title: 'Views, functions and triggers', blurb: 'Logic inside the database: what views, functions, procedures and triggers are good for, and what they cost.', draft: true },
  { slug: 'partitioning', module: 'scale', title: 'Partitioning', blurb: 'Range, list and hash partitions, partition pruning, dropping old data, and the limits.', draft: true },
  { slug: 'sharding-and-scale', module: 'scale', title: 'Replicas and sharding', blurb: 'When one server is not enough: read replicas, sharding, and how they relate to partitioning.', draft: true },
  { slug: 'transactions', module: 'concurrency', title: 'Transactions', blurb: 'ACID, savepoints, and the lost update that transactions alone do not prevent.', draft: true },
  { slug: 'isolation-and-mvcc', module: 'concurrency', title: 'Isolation levels and MVCC', blurb: 'What each isolation level lets a transaction see, shown with recordings from a real server.', draft: true },
  { slug: 'locks-and-deadlocks', module: 'concurrency', title: 'Locks and deadlocks', blurb: 'Lock modes, waiting, the lock queue behind a migration, deadlocks, SKIP LOCKED and advisory locks.', draft: true },
  { slug: 'connection-pooling', module: 'concurrency', title: 'Connection pooling', blurb: 'Why connections are expensive, what a pool does, PgBouncer modes and how to size a pool.', draft: true },
  { slug: 'query-checklist', module: 'practice', title: 'Slow query checklist', blurb: 'A method for any slow query, and a table from what the plan shows to the likely fix.', draft: true },
  { slug: 'interview-questions', module: 'practice', title: 'Database interview questions', blurb: 'Eleven questions interviewers ask about indexes, transactions and scale, with answers to compare against yours.', draft: true },
  { slug: 'tuning-exercises', module: 'practice', title: 'Query-tuning exercises', blurb: 'Twelve slow queries from a real-looking shop. Fix each one; the database checks your plan.', draft: true },
];
