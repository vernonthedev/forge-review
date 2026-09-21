import { createCorrelationId } from '@forge-review/shared';
import { fetchChangedFiles, fetchRepositoryConfig, fetchGuidelines, createReview, generateFindingId, type ReviewComment } from '@forge-review/github';
import { createProvider, type ReviewModel, type ProviderConfig, type ModelResponse } from '@forge-review/llm';
import { parseRepositoryConfig, getDefaultConfig, type RepositoryConfig } from '@forge-review/config';
import type {
  ReviewInput,
  ReviewResult,
  ReviewFinding,
  ReviewLifecycleStage,
  ChangedFile,
} from '@forge-review/shared';

export interface ReviewContext {
  correlationId: string;
  installationId: number;
  repository: { owner: string; name: string; fullName: string };
  pullRequest: {
    number: number;
    title: string;
    description: string;
    baseBranch: string;
    headBranch: string;
    baseSha: string;
    headSha: string;
  };
  token: string;
  config: RepositoryConfig;
  guidelines?: string;
}

export interface ReviewJob {
  id: string;
  stage: ReviewLifecycleStage;
  context: ReviewContext;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  result?: ReviewResult;
  usage?: ModelResponse['usage'];
}

export class ReviewEngine {
  private model: ReviewModel;

  constructor(providerConfig: ProviderConfig) {
    this.model = createProvider(providerConfig);
  }

  async executeReview(context: ReviewContext): Promise<ReviewJob> {
    const job: ReviewJob = {
      id: createCorrelationId(),
      stage: 'RECEIVED',
      context,
      startedAt: new Date(),
    };

    try {
      job.stage = 'COLLECTING_CONTEXT';
      const changedFiles = await this.collectChangedFiles(context);
      const filteredFiles = this.filterFiles(changedFiles, context.config.exclude);

      job.stage = 'REVIEWING';
      const reviewInput = this.buildReviewInput(context, filteredFiles);
      const result = await this.model.review(reviewInput);
      job.result = result;
      job.usage = (this.model as any).lastUsage;

      if (context.config.review.verifyFindings) {
        job.stage = 'VERIFYING';
        const verifiedFindings = await this.verifyFindings(context, result.findings, filteredFiles);
        job.result = { ...result, findings: verifiedFindings };
      }

      job.stage = 'PUBLISHING';
      await this.publishReview(context, job.result!);

      job.stage = 'COMPLETED';
      job.completedAt = new Date();
    } catch (error) {
      job.stage = 'FAILED';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      throw error;
    }

    return job;
  }

  private async collectChangedFiles(context: ReviewContext): Promise<ChangedFile[]> {
    const files = await fetchChangedFiles(
      context.token,
      context.repository.owner,
      context.repository.name,
      context.pullRequest.baseSha,
      context.pullRequest.headSha
    );
    return files.map((f) => ({
      filename: f.filename,
      status: f.status as ChangedFile['status'],
      patch: f.patch,
      additions: f.additions,
      deletions: f.deletions,
    }));
  }

  private filterFiles(files: ChangedFile[], excludePatterns: string[]): ChangedFile[] {
    return files.filter((file) => {
      if (file.status === 'deleted') return false;
      if (!file.patch || file.patch.length === 0) return false;
      return !excludePatterns.some((pattern) => this.matchPattern(file.filename, pattern));
    });
  }

  private matchPattern(filename: string, pattern: string): boolean {
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\/\*/g, '__DOUBLE_STAR_SLASH__')
      .replace(/\*\*/g, '__DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
      .replace(/__DOUBLE_STAR__/g, '.*');
    return new RegExp(`^${regexPattern}$`).test(filename);
  }

  private buildReviewInput(context: ReviewContext, changedFiles: ChangedFile[]): ReviewInput {
    return {
      repository: context.repository,
      pullRequest: context.pullRequest,
      changedFiles,
      repositoryConfig: context.config,
      guidelines: context.guidelines,
    };
  }

  private async verifyFindings(
    context: ReviewContext,
    findings: ReviewFinding[],
    changedFiles: ChangedFile[]
  ): Promise<ReviewFinding[]> {
    const validFindings: ReviewFinding[] = [];

    for (const finding of findings) {
      const isValid = this.validateFinding(finding, changedFiles, context.pullRequest.headSha);
      if (isValid) {
        validFindings.push(finding);
      } else {
        console.log(`[${context.correlationId}] Rejected finding: ${finding.file}:${finding.line} - ${finding.title}`);
      }
    }

    return validFindings.slice(0, context.config.review.maxComments);
  }

  private validateFinding(finding: ReviewFinding, changedFiles: ChangedFile[], _headSha: string): boolean {
    const file = changedFiles.find((f) => f.filename === finding.file);
    if (!file) return false;

    if (finding.line <= 0) return false;

    const patchLines = this.extractChangedLines(file.patch || '');
    if (!patchLines.includes(finding.line)) {
      return false;
    }

    return true;
  }

  private extractChangedLines(patch: string): number[] {
    const lines: number[] = [];
    let currentLine = 0;

    for (const line of patch.split('\n')) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1], 10);
        }
      } else if (line.startsWith('+')) {
        lines.push(currentLine);
        currentLine++;
      } else if (line.startsWith('-')) {
      } else {
        currentLine++;
      }
    }

    return lines;
  }

  private async publishReview(context: ReviewContext, result: ReviewResult): Promise<void> {
    const comments: ReviewComment[] = result.findings.map((finding) => ({
      path: finding.file,
      line: finding.line,
      body: `${this.formatFinding(finding)}\n\n${generateFindingId(finding.file, finding.line, finding.title)}`,
    }));

    const event = this.determineReviewEvent(result.findings);

    await createReview(context.token, {
      owner: context.repository.owner,
      repo: context.repository.name,
      pullRequestNumber: context.pullRequest.number,
      commitSha: context.pullRequest.headSha,
      body: result.summary,
      event,
      comments,
    });
  }

  private formatFinding(finding: ReviewFinding): string {
    const severityLabel = finding.severity.toUpperCase();
    let body = `${severityLabel}\n${finding.file}:${finding.line}\n\n${finding.body}`;
    if (finding.suggestion) {
      body += `\n\nSuggestion:\n${finding.suggestion}`;
    }
    return body;
  }

  private determineReviewEvent(findings: ReviewFinding[]): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
    const hasCritical = findings.some((f) => f.severity === 'critical');
    const hasHigh = findings.some((f) => f.severity === 'high');

    if (hasCritical || hasHigh) {
      return 'REQUEST_CHANGES';
    }
    return 'COMMENT';
  }
}

export async function createReviewEngine(providerConfig: ProviderConfig): Promise<ReviewEngine> {
  return new ReviewEngine(providerConfig);
}

export async function loadRepositoryConfig(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<RepositoryConfig> {
  const content = await fetchRepositoryConfig(token, owner, repo, ref);
  if (!content) {
    return getDefaultConfig();
  }
  const { config, errors } = parseRepositoryConfig(content);
  if (errors.length > 0) {
    console.warn('Configuration errors:', errors);
  }
  return config;
}

export async function loadGuidelines(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<string | undefined> {
  const content = await fetchGuidelines(token, owner, repo, ref);
  return content || undefined;
}