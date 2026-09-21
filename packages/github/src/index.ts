import { createHmac } from 'crypto';
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
  const response = await fetch(`${GITHUB_API_URL}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to create installation token: ${response.statusText}`);
  }

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

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function fetchChangedFiles(
  token: string,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<Array<{ filename: string; status: string; patch?: string; additions: number; deletions: number }>> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`, {
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
    return atob(data.content);
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
  ref: string
): Promise<string | null> {
  return fetchFileContent(token, owner, repo, '.github/forge-review.md', ref);
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
  const response = await fetch(`${GITHUB_API_URL}/repos/${params.owner}/${params.repo}/pulls/${params.pullRequestNumber}/reviews`, {
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create review: ${error}`);
  }

  return response.json() as Promise<{ id: number; html_url: string }>;
}

export async function fetchExistingReviews(
  token: string,
  owner: string,
  repo: string,
  pullRequestNumber: number
): Promise<Array<{ id: number; user: { login: string }; body: string }>> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/pulls/${pullRequestNumber}/reviews`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch reviews: ${response.statusText}`);
  }

  return response.json() as Promise<Array<{ id: number; user: { login: string }; body: string }>>;
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