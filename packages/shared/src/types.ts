export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'architecture'
  | 'maintainability'
  | 'testing'
  | 'other';

export type ReviewEventType = 'opened' | 'reopened' | 'synchronize';

export type ReviewLifecycleStage =
  | 'RECEIVED'
  | 'COLLECTING_CONTEXT'
  | 'REVIEWING'
  | 'VERIFYING'
  | 'PUBLISHING'
  | 'COMPLETED'
  | 'FAILED';

export interface ReviewFinding {
  severity: Severity;
  category: Category;
  file: string;
  line: number;
  title: string;
  body: string;
  suggestion?: string;
  confidence: number;
}

export interface ReviewResult {
  summary: string;
  findings: ReviewFinding[];
}

export interface ReviewInput {
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  pullRequest: {
    number: number;
    title: string;
    description: string;
    baseBranch: string;
    headBranch: string;
    baseSha: string;
    headSha: string;
  };
  changedFiles: ChangedFile[];
  repositoryConfig: RepositoryConfig;
  guidelines?: string;
}

export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch?: string;
  additions: number;
  deletions: number;
}

export interface RepositoryConfig {
  enabled: boolean;
  model: ModelConfig;
  review: ReviewConfig;
  exclude: string[];
  guidelines?: GuidelinesConfig;
}

export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ReviewConfig {
  severityThreshold: Severity;
  maxComments: number;
  incremental: boolean;
  verifyFindings: boolean;
}

export interface GuidelinesConfig {
  path: string;
}

export interface WebhookPayload {
  action: ReviewEventType;
  installation: {
    id: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    base: {
      ref: string;
      sha: string;
    };
    head: {
      ref: string;
      sha: string;
    };
  };
}