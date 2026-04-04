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

export interface TestsChangedEntry {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  duration: number;
  previousStatus?: 'passed' | 'failed' | 'skipped' | 'errored';
}

export interface TestsChangedReport {
  newTests: TestsChangedEntry[];
  removedTests: TestsChangedEntry[];
  statusChanged: TestsChangedEntry[];
  hasChanges: boolean;
}

export interface FlakyTestInfo {
  name: string;
  suite: string;
  flakyRate: number;
  flipCount: number;
  recentStatuses: ('passed' | 'failed' | 'skipped' | 'errored')[];
}

export interface FlakyDetectionResult {
  flakyTests: FlakyTestInfo[];
  hasFlakyTests: boolean;
}

export interface PerfRegressionInfo {
  name: string;
  suite: string;
  currentDuration: number;
  medianDuration: number;
  increasePercent: number;
}

export interface PerfRegressionResult {
  regressions: PerfRegressionInfo[];
  hasRegressions: boolean;
  sparkline: string;
}

export interface DeltaTestInfo {
  name: string;
  suite: string;
}

export type TrendDirection = 'up' | 'stable' | 'down';

export interface TrendIndicators {
  passRate: {
    direction: TrendDirection;
    current: number;
    delta: number;
    sparkline: string;
  };
  duration: {
    direction: TrendDirection;
    current: number;
    delta: number;
    deltaPercent: number;
    sparkline: string;
  };
  testCount: {
    current: number;
    delta: number;
  };
}

export interface DeltaComparison {
  testsAdded: DeltaTestInfo[];
  testsRemoved: DeltaTestInfo[];
  newlyFailing: DeltaTestInfo[];
  newlyPassing: DeltaTestInfo[];
  passRatePrev: number;
  passRateCurr: number;
  passRateDelta: number;
  durationPrev: number;
  durationCurr: number;
  durationDelta: number;
  durationDeltaPercent: number;
  hasChanges: boolean;
}
