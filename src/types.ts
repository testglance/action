export interface ParsedTestRun {
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    duration: number;
  };
  suites: ParsedSuite[];
}

export interface ParsedSuite {
  name: string;
  tests: ParsedTestCase[];
  duration: number;
}

export interface ParsedTestCase {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  duration: number;
  errorMessage?: string;
  errorType?: string;
}
