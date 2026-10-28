/** Guidance for people testing a scenario by talking to it. */
export interface TestGuide<S extends string = string> {
  /** Sample data callers can use (e.g. accounts). */
  sampleData?: { title: string; columns: string[]; rows: string[][] };
  /** Requests the agent handles. */
  handles: string[];
  /** What the agent won't do, or hands to a person. */
  limits: string[];
  /** Example lines for the current state. */
  stateHints: Partial<Record<S, string[]>>;
  /** Full test calls: what to say, in order, and the states to expect. */
  scripts: { title: string; lines: string[]; expect: string }[];
}
