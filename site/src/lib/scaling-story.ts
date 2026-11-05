// The architecture shown at each stage of "from one user to millions". Pure data so the layout can be tested:
// boxes must not overlap and every line must join two boxes that exist at that stage.

export interface Component { id: string; label: string; sub?: string; x: number; y: number; w: number; h: number; ghost?: boolean }
export interface Edge { from: string; to: string; dashed?: boolean }
export interface Architecture { components: Component[]; edges: Edge[] }

export const STAGES = 9;

interface Def extends Component { from: number; until?: number; labelFrom?: Record<number, string> }

// Canvas is 800 x 340.
const COMPONENTS: Def[] = [
  { id: 'users', label: 'Users', x: 8, y: 150, w: 76, h: 48, from: 1 },
  { id: 'mono', label: 'One server', sub: 'web + app + database', x: 260, y: 138, w: 140, h: 72, from: 1, until: 1 },
  { id: 'web', label: 'Web server', x: 260, y: 150, w: 110, h: 48, from: 2, until: 2 },
  { id: 'db', label: 'Database', x: 545, y: 138, w: 120, h: 56, from: 2, until: 4 },
  { id: 'dns', label: 'DNS', x: 108, y: 40, w: 76, h: 40, from: 3 },
  { id: 'lb', label: 'Load balancer', x: 108, y: 150, w: 112, h: 48, from: 3 },
  { id: 'w1', label: 'Web server', x: 260, y: 60, w: 110, h: 44, from: 3 },
  { id: 'w2', label: 'Web server', x: 260, y: 150, w: 110, h: 44, from: 3 },
  { id: 'w3', label: 'Web server', x: 260, y: 240, w: 110, h: 44, from: 3 },
  { id: 'cache', label: 'Cache', x: 430, y: 60, w: 84, h: 44, from: 4 },
  { id: 'primary', label: 'Primary', x: 545, y: 100, w: 120, h: 44, from: 5, labelFrom: { 8: 'Shard A' } },
  { id: 'r1', label: 'Replica', x: 545, y: 152, w: 120, h: 40, from: 5 },
  { id: 'r2', label: 'Replica', x: 545, y: 198, w: 120, h: 40, from: 5 },
  { id: 'cdn', label: 'CDN', sub: 'static files', x: 108, y: 255, w: 100, h: 48, from: 6 },
  { id: 'queue', label: 'Queue', x: 430, y: 262, w: 84, h: 40, from: 7 },
  { id: 'workers', label: 'Workers', x: 545, y: 262, w: 120, h: 40, from: 7 },
  { id: 'shardB', label: 'Shard B', x: 690, y: 100, w: 100, h: 44, from: 8 },
  { id: 'region2', label: 'Second region: a full copy of this stack, reached through geo DNS', x: 108, y: 310, w: 682, h: 26, from: 9, ghost: true },
];

// Lines between boxes, each with the stage range in which it is drawn.
const EDGE_DEFS: { from: string; to: string; stage: number; until?: number; dashed?: boolean }[] = [
  { from: 'users', to: 'mono', stage: 1, until: 1 },
  { from: 'users', to: 'web', stage: 2, until: 2 },
  { from: 'web', to: 'db', stage: 2, until: 2 },
  { from: 'users', to: 'dns', stage: 3, dashed: true },
  { from: 'users', to: 'lb', stage: 3 },
  { from: 'lb', to: 'w1', stage: 3 },
  { from: 'lb', to: 'w2', stage: 3 },
  { from: 'lb', to: 'w3', stage: 3 },
  { from: 'w1', to: 'db', stage: 3, until: 4 },
  { from: 'w2', to: 'db', stage: 3, until: 4 },
  { from: 'w3', to: 'db', stage: 3, until: 4 },
  { from: 'w1', to: 'cache', stage: 4 },
  { from: 'w2', to: 'primary', stage: 5 },
  { from: 'w2', to: 'r1', stage: 5 },
  { from: 'w3', to: 'r2', stage: 5 },
  { from: 'primary', to: 'r1', stage: 5, dashed: true },
  { from: 'primary', to: 'r2', stage: 5, dashed: true },
  { from: 'users', to: 'cdn', stage: 6 },
  { from: 'w3', to: 'queue', stage: 7 },
  { from: 'queue', to: 'workers', stage: 7 },
  { from: 'primary', to: 'shardB', stage: 8, dashed: true },
];

const inRange = (stage: number, from: number, until?: number) => stage >= from && (until === undefined || stage <= until);

export function architectureAt(stage: number): Architecture {
  const s = Math.min(Math.max(1, stage), STAGES);
  const components = COMPONENTS.filter((c) => inRange(s, c.from, c.until)).map((c) => {
    const override = c.labelFrom && Object.entries(c.labelFrom).filter(([k]) => Number(k) <= s).sort((a, b) => Number(b[0]) - Number(a[0]))[0];
    const { from: _f, until: _u, labelFrom: _l, ...rest } = c;
    void _f; void _u; void _l;
    return { ...rest, label: override ? override[1] : c.label };
  });
  const ids = new Set(components.map((c) => c.id));
  const edges = EDGE_DEFS.filter((e) => inRange(s, e.stage, e.until) && ids.has(e.from) && ids.has(e.to)).map(({ from, to, dashed }) => ({ from, to, dashed }));
  return { components, edges };
}

/** Ids that appear at this stage but were not there at the one before it. */
export function newAt(stage: number): string[] {
  const now = new Set(architectureAt(stage).components.map((c) => c.id));
  const before = new Set(stage > 1 ? architectureAt(stage - 1).components.map((c) => c.id) : []);
  return [...now].filter((id) => !before.has(id));
}
