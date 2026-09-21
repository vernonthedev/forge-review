import { createHmac } from 'crypto';
import { withRetry, HttpError } from '@forge-review/shared';
import type { WebhookPayload, ReviewEventType } from '@forge-review/shared';

export const GITHUB_API_URL = 'https://api.github.com';

export interface GitHubAppAuth {
  appId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return signature === expectedSignature;
}

export function extractInstallationId(payload: WebhookPayload): number {
  return payload.installation.id;
}

export function extractRepository(payload: WebhookPayload): { owner: string; name: string; fullName: string } {
  return {
    owner: payload.repository.owner.login,
    name: payload.repository.name,
    fullName: payload.repository.full_name,
  };
}

export function extractPullRequestInfo(payload: WebhookPayload): {
  number: number;
  title: string;
  description: string;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
} {
  return {
    number: payload.pull_request.number,
    title: payload.pull_request.title,
    description: payload.pull_request.body ?? '',
    baseBranch: payload.pull_request.base.ref,
    headBranch: payload.pull_request.head.ref,
    baseSha: payload.pull_request.base.sha,
    headSha: payload.pull_request.head.sha,
  };
}

export function isSupportedEvent(action: string): action is ReviewEventType {
  return ['opened', 'reopened', 'synchronize'].includes(action);
}

export async function createInstallationToken(auth: GitHubAppAuth, installationId: number): Promise<InstallationToken> {
  const jwt = await generateAppJwt(auth);
  const response = await withRetry(async () => {
    const attempted = await fetch(`${GITHUB_API_URL}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!attempted.ok) {
      throw new HttpError(attempted.status, `Failed to create installation token: ${attempted.statusText}`);
    }

    return attempted;
  });

  const data = (await response.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

async function generateAppJwt(auth: GitHubAppAuth): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: auth.appId,
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(auth.privateKey);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signingInput}.${encodedSignature}`;
}

function encodeDerLength(length: number): number[] {
  if (length < 128) return [length];
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function wrapPkcs1InPkcs8(pkcs1Der: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const rsaAlgorithmId = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const algorithmSequence = [0x30, ...encodeDerLength(rsaAlgorithmId.length), ...rsaAlgorithmId];
  const octetString = [0x04, ...encodeDerLength(pkcs1Der.length), ...pkcs1Der];
  const body = [0x02, 0x01, 0x00, ...algorithmSequence, ...octetString];
  return new Uint8Array([0x30, ...encodeDerLength(body.length), ...body]);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const isPkcs1 = pem.includes('-----BEGIN RSA PRIVATE KEY-----');
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  let binaryDer = new Uint8Array(Buffer.from(pemContents, 'base64'));

  if (isPkcs1) {
    binaryDer = wrapPkcs1InPkcs8(binaryDer);
  }

  return crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function fetchChangedFiles(
  token: string,
  owner: string,
  repo: string,
  _baseSha: string,
  _headSha: string,
  pullNumber?: number
): Promise<Array<{ filename: string; status: string; patch?: string; additions: number; deletions: number }>> {
  if (!pullNumber) {
    const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/compare/${_baseSha}...${_headSha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch changed files: ${response.statusText}`);
    }

    const data = (await response.json()) as { files: Array<{ filename: string; status: string; patch?: string; additions: number; deletions: number }> };
    return data.files;
  }

  const allFiles: Array<{ filename: string; status: string; patch?: string; additions: number; deletions: number }> = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PR files: ${response.statusText}`);
    }

    const files = (await response.json()) as Array<{ filename: string; status: string; patch?: string; additions: number; deletions: number }>;
    if (files.length === 0) break;

    allFiles.push(...files);

    if (files.length < perPage) break;
    page++;
  }

  return allFiles;
}

export function isBinaryFile(filename: string): boolean {
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.war', '.ear', '.woff', '.woff2', '.ttf', '.eot', '.otf'];
  return binaryExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

export function truncatePatch(patch: string, maxLength: number): string {
  if (patch.length <= maxLength) return patch;
  return patch.slice(0, maxLength) + '\n... (truncated)';
}

export async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText}`);
  }

  const data = (await response.json()) as { content: string; encoding: string };
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf8');
  }
  return data.content;
}

export async function fetchRepositoryConfig(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<string | null> {
  return fetchFileContent(token, owner, repo, '.github/forge-review.yml', ref);
}

export async function fetchGuidelines(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  path: string = '.github/forge-review.md'
): Promise<string | null> {
  return fetchFileContent(token, owner, repo, path, ref);
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  side?: 'RIGHT' | 'LEFT';
}

export interface CreateReviewParams {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  commitSha: string;
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments: ReviewComment[];
}

export async function createReview(token: string, params: CreateReviewParams): Promise<{ id: number; html_url: string }> {
  const response = await withRetry(async () => {
    const attempted = await fetch(`${GITHUB_API_URL}/repos/${params.owner}/${params.repo}/pulls/${params.pullRequestNumber}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commit_id: params.commitSha,
        body: params.body,
        event: params.event,
        comments: params.comments.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
          side: c.side ?? 'RIGHT',
        })),
      }),
    });

    if (!attempted.ok) {
      const error = await attempted.text();
      throw new HttpError(attempted.status, `Failed to create review: ${error}`);
    }

    return attempted;
  });

  return response.json() as Promise<{ id: number; html_url: string }>;
}

export async function fetchReviewComments(
  token: string,
  owner: string,
  repo: string,
  pullRequestNumber: number
): Promise<Array<{ id: number; path: string; line: number; body: string }>> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/pulls/${pullRequestNumber}/comments`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch review comments: ${response.statusText}`);
  }

  return response.json() as Promise<Array<{ id: number; path: string; line: number; body: string }>>;
}

export const FORGE_REVIEW_COMMENT_MARKER = '<!-- forge-review:finding:';

export function isForgeReviewComment(body: string): boolean {
  return body.includes(FORGE_REVIEW_COMMENT_MARKER);
}

export function extractFindingId(body: string): string | null {
  const match = body.match(/<!-- forge-review:finding:([^>]+) -->/);
  return match ? match[1] : null;
}

export function createFindingMarker(findingId: string): string {
  return `<!-- forge-review:finding:${findingId} -->`;
}

export function generateFindingId(file: string, line: number, title: string): string {
  const hash = `${file}:${line}:${title}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  return `${hash}_${Date.now().toString(36)}`;
}

export type CommitStatusState = 'pending' | 'success' | 'failure' | 'error';

export interface CreateCommitStatusParams {
  owner: string;
  repo: string;
  sha: string;
  state: CommitStatusState;
  description: string;
  context?: string;
}

export const FORGE_REVIEW_STATUS_CONTEXT = 'Forge Review';

export async function createCommitStatus(token: string, params: CreateCommitStatusParams): Promise<void> {
  await withRetry(
    async () => {
      const attempted = await fetch(`${GITHUB_API_URL}/repos/${params.owner}/${params.repo}/statuses/${params.sha}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: params.state,
          description: params.description.slice(0, 140),
          context: params.context ?? FORGE_REVIEW_STATUS_CONTEXT,
        }),
      });

      if (!attempted.ok) {
        const error = await attempted.text();
        throw new HttpError(attempted.status, `Failed to create commit status: ${error}`);
      }

      return attempted;
    },
    { maxAttempts: 2 }
  );
}