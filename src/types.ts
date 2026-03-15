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
  toolName?: string;
}

export interface MetaEnvelope {
  workflow: string;
  job: string;
  framework?: string;
  testJobName?: string;
}

export interface ApiPayload {
  meta: MetaEnvelope;
  results: ParsedTestRun & {
    repository: { name: string; id: number };
    git: { sha: string; branch: string };
    ciRunId: string;
  };
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
