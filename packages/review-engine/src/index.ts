import { createCorrelationId } from '@forge-review/shared';
import { fetchChangedFiles, fetchRepositoryConfig, fetchGuidelines, createReview, fetchReviewComments, generateFindingId, type ReviewComment, isBinaryFile, truncatePatch } from '@forge-review/github';
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
  eventType: 'opened' | 'reopened' | 'synchronize';
  previousReviewSha?: string;
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
  private readonly maxPatchSize = 50000;
  private readonly maxTotalPatchSize = 200000;

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
      const processedFiles = this.processFiles(filteredFiles);

      job.stage = 'REVIEWING';
      const reviewInput = this.buildReviewInput(context, processedFiles);
      const result = await this.model.review(reviewInput);
      job.result = result;
      job.usage = (this.model as any).lastUsage;

      if (context.config.review.verifyFindings) {
        job.stage = 'VERIFYING';
        const verifiedFindings = await this.verifyFindings(context, result.findings, processedFiles);
        job.result = { ...result, findings: verifiedFindings };
      }

      job.stage = 'PUBLISHING';
      const finalResult = job.result!;
      
      if (context.config.review.incremental && context.eventType === 'synchronize') {
        const existingComments = await fetchReviewComments(
          context.token,
          context.repository.owner,
          context.repository.name,
          context.pullRequest.number
        );
        
        const existingFindingIds = new Set<string>();
        for (const comment of existingComments) {
          const findingId = comment.body.match(/<!-- forge-review:finding:([^>]+) -->/);
          if (findingId) existingFindingIds.add(findingId[1]);
        }
        
        const newFindings = finalResult.findings.filter((f) => 
          !existingFindingIds.has(`${f.file}:${f.line}:${f.title}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50))
        );
        
        if (newFindings.length === 0) {
          console.log(`[${context.correlationId}] Incremental review: no new findings for PR #${context.pullRequest.number}`);
          job.stage = 'COMPLETED';
          job.completedAt = new Date();
          return job;
        }
        
        job.result = { ...finalResult, findings: newFindings };
      }
      
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
      context.pullRequest.headSha,
      context.pullRequest.number
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
      if (isBinaryFile(file.filename)) return false;
      if (!file.patch || file.patch.length === 0) return false;
      return !excludePatterns.some((pattern) => this.matchPattern(file.filename, pattern));
    });
  }

  private processFiles(files: ChangedFile[]): ChangedFile[] {
    let totalSize = 0;
    return files.map((file) => {
      let patch = file.patch || '';
      if (patch.length > this.maxPatchSize) {
        patch = truncatePatch(patch, this.maxPatchSize);
      }
      totalSize += patch.length;
      if (totalSize > this.maxTotalPatchSize) {
        patch = truncatePatch(patch, Math.max(0, this.maxTotalPatchSize - (totalSize - patch.length)));
      }
      return { ...file, patch };
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

  private buildVerificationPrompt(finding: ReviewFinding): string {
    return `You are verifying a code review finding. Determine if this finding is valid, invalid, or uncertain.

Finding to verify:
- File: ${finding.file}:${finding.line}
- Title: ${finding.title}
- Description: ${finding.body}
- Severity: ${finding.severity}
- Category: ${finding.category}
- Confidence: ${finding.confidence}
${finding.suggestion ? `- Suggestion: ${finding.suggestion}` : ''}

Respond with a JSON object containing:
{
  "summary": "Brief assessment",
  "findings": [
    {
      "severity": "low",
      "category": "other",
      "file": "verification",
      "line": 1,
      "title": "valid|invalid|uncertain",
      "body": "Explanation of verification result",
      "confidence": 0.9
    }
  ]
}`;
  }

  private async verifyFindings(
    context: ReviewContext,
    findings: ReviewFinding[],
    changedFiles: ChangedFile[]
  ): Promise<ReviewFinding[]> {
    if (findings.length === 0) return [];

    const verifiedFindings: ReviewFinding[] = [];

    for (const finding of findings) {
      const isValid = this.validateFinding(finding, changedFiles, context.pullRequest.headSha);
      if (!isValid) {
        console.log(`[${context.correlationId}] Rejected finding (validation): ${finding.file}:${finding.line} - ${finding.title}`);
        continue;
      }

      const verification = await this.verifyFindingWithModel(context, finding);
      if (verification === 'valid') {
        verifiedFindings.push(finding);
      } else {
        console.log(`[${context.correlationId}] Rejected finding (verification): ${finding.file}:${finding.line} - ${finding.title} (${verification})`);
      }
    }

    return verifiedFindings.slice(0, context.config.review.maxComments);
  }

  private async verifyFindingWithModel(context: ReviewContext, finding: ReviewFinding): Promise<'valid' | 'invalid' | 'uncertain'> {
    this.buildVerificationPrompt(finding); // Build prompt for potential future use
    const result = await this.model.review({
      ...this.buildReviewInput(context, []),
      pullRequest: {
        ...context.pullRequest,
        title: `Verification: ${finding.title}`,
        description: `Verify if this finding is valid:\n\n${finding.body}`,
      },
      changedFiles: [],
      repositoryConfig: { ...context.config, review: { ...context.config.review, verifyFindings: false } },
    });

    const verification = result.findings[0];
    if (!verification) return 'uncertain';

    const title = verification.title.toLowerCase();
    if (title.includes('invalid') || title.includes('false positive')) return 'invalid';
    if (title.includes('valid') || title.includes('confirmed')) return 'valid';
    return 'uncertain';
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

  private filterFindingsForPublish(findings: ReviewFinding[], config: RepositoryConfig): ReviewFinding[] {
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    const threshold = severityOrder[config.review.severityThreshold] ?? 2;

    return findings
      .filter((f) => severityOrder[f.severity] >= threshold)
      .filter((f) => f.confidence >= 0.7)
      .slice(0, config.review.maxComments);
  }

  private async publishReview(context: ReviewContext, result: ReviewResult): Promise<void> {
    const filteredFindings = this.filterFindingsForPublish(result.findings, context.config);
    const comments: ReviewComment[] = filteredFindings.map((finding) => ({
      path: finding.file,
      line: finding.line,
      body: `${this.formatFinding(finding)}\n\n${generateFindingId(finding.file, finding.line, finding.title)}`,
    }));

    const event = this.determineReviewEvent(filteredFindings);

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
  ref: string,
  path: string = '.github/forge-review.md'
): Promise<string | undefined> {
  const content = await fetchGuidelines(token, owner, repo, ref, path);
  return content || undefined;
}