import type { ApiPayload, MetaEnvelope, ParsedTestRun, Highlight } from '../types';

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 10000;

const NON_RETRYABLE_STATUS_CODES = [400, 401, 403];

interface ApiSuccessBody {
  data?: { runId: string; healthScore: number | null; highlights?: Highlight[] };
}

interface ApiErrorBody {
  error?: { code: string; message: string };
}

export interface SendResult {
  success: boolean;
  runId?: string;
  healthScore?: number | null;
  highlights?: Highlight[];
  errorCode?: string;
  errorMessage?: string;
}

export interface MetaFields {
  framework?: string;
  testJobName?: string;
}

export function buildPayload(parsedRun: ParsedTestRun, metaFields?: MetaFields): ApiPayload {
  const meta: MetaEnvelope = {
    workflow: process.env.GITHUB_WORKFLOW ?? '',
    job: process.env.GITHUB_JOB ?? '',
  };

  if (metaFields?.framework) {
    meta.framework = metaFields.framework;
  }

  if (metaFields?.testJobName) {
    meta.testJobName = metaFields.testJobName;
  }

  return {
    meta,
    results: {
      ...parsedRun,
      repository: {
        name: process.env.GITHUB_REPOSITORY ?? '',
        id: Number(process.env.GITHUB_REPOSITORY_ID) || 0,
      },
      git: {
        sha: process.env.GITHUB_SHA ?? '',
        branch: process.env.GITHUB_REF_NAME ?? '',
      },
      ciRunId: process.env.GITHUB_RUN_ID ?? '',
    },
  };
}

export async function sendTestRun(
  apiUrl: string,
  apiKey: string,
  parsedRun: ParsedTestRun,
  metaFields?: MetaFields,
): Promise<SendResult> {
  const payload = buildPayload(parsedRun, metaFields);
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(`${apiUrl}/api/v1/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiSuccessBody;
        return {
          success: true,
          runId: body.data?.runId,
          healthScore: body.data?.healthScore,
          highlights: body.data?.highlights ?? [],
        };
      }

      const errorBody = (await response.json().catch(
        (): ApiErrorBody => ({
          error: { code: 'UNKNOWN', message: `HTTP ${response.status}` },
        }),
      )) as ApiErrorBody;

      const errorCode = errorBody.error?.code ?? 'UNKNOWN';
      const errorMessage = errorBody.error?.message ?? `HTTP ${response.status}`;
      lastError = `${errorCode} - ${errorMessage}`;

      if (NON_RETRYABLE_STATUS_CODES.includes(response.status)) {
        return { success: false, errorCode, errorMessage };
      }

      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    success: false,
    errorCode: 'NETWORK_ERROR',
    errorMessage: lastError ?? 'API unreachable after retries',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
