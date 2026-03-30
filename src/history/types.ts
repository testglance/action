export interface HistoryTestEntry {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  duration: number;
}

export interface HistoryEntry {
  timestamp: string;
  commitSha: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    duration: number;
  };
  tests: HistoryTestEntry[];
}

export interface HistoryFile {
  version: 1;
  branch: string;
  entries: HistoryEntry[];
}

export interface HistoryStorage {
  load(): Promise<HistoryFile | null>;
  save(history: HistoryFile): Promise<void>;
  clear(): Promise<void>;
}
