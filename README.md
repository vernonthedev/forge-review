### Forge Review

An independent GitHub AI code reviewer powered by configurable LLMs.

### Overview

Forge Review is a standalone GitHub App that automatically reviews pull requests using configurable OpenAI-compatible LLM providers. It operates independently of GitHub Actions: it receives webhook events, retrieves PR context through the GitHub API, performs AI code reviews, and publishes findings back to the PR as GitHub reviews with inline comments.

### Features

- GitHub App authentication with installation-scoped tokens
- Configurable LLM providers: any OpenAI-compatible API (NVIDIA NIM, OpenRouter, DeepSeek, Together, Groq, vLLM, self-hosted)
- Repository configuration via `.github/forge-review.yml` with YAML and JSON support
- Custom review guidelines via `.github/forge-review.md`
- Structured JSON reviews validated with Zod
- Second-pass finding verification to reduce false positives
- Incremental reviews that avoid duplicate comments on synchronize events
- Commit statuses showing pending, success, and failure per review
- Async processing: webhooks acknowledge in milliseconds, reviews run in the background
- Security-first: signature verification, trusted-base configuration, no code execution

### Architecture

```text
forge-review/
├── apps/
│   └── api/                 # Hono HTTP server
├── packages/
│   ├── github/              # GitHub API client and webhook handling
│   ├── llm/                 # LLM provider abstraction
│   ├── review-engine/       # Review orchestration
│   ├── config/              # Configuration parsing and validation
│   └── shared/              # Shared types and utilities
```

A review flows through receive, context collection, model review, verification, publishing, and completion stages, with every step tagged by a correlation ID.

### Quick Start

#### Prerequisites

- Node.js 20+
- pnpm 9+
- GitHub App credentials

#### Installation

```bash
pnpm install
cp .env.example .env
```

Edit `.env` with your credentials.

#### Environment Variables

```env
GITHUB_APP_ID=your-app-id
GITHUB_PRIVATE_KEY=your-private-key
GITHUB_WEBHOOK_SECRET=your-webhook-secret

NVIDIA_API_KEY=your-nvidia-api-key
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=nvidia/nemotron-3-ultra-550b-a55b

PORT=3000
NODE_ENV=development
```

The LLM variables set the default provider. A repository can override provider and model in its own configuration file.

#### Development

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
```

See `docs/github-app-setup.md` for the full setup walkthrough, including tunnel-based local development.

### GitHub App Setup

1. Create a GitHub App in your organization settings.
2. Configure permissions: Contents (Read), Pull requests (Read and Write), Metadata (Read).
3. Subscribe to Pull request events.
4. Set the webhook URL to `https://your-domain.com/webhooks/github`.
5. Generate and save the private key.
6. Install the app on target repositories.

See `docs/github-app-setup.md` for the complete fourteen-step guide.

### Repository Configuration

Create `.github/forge-review.yml` in your repository:

```yaml
enabled: true

model:
  provider: nvidia
  model: nvidia/nemotron-3-ultra-550b-a55b

review:
  severity_threshold: medium
  max_comments: 15
  incremental: true
  verify_findings: true

exclude:
  - "**/*.lock"
  - "dist/**"
  - ".next/**"
  - "coverage/**"
  - "node_modules/**"

guidelines:
  path: ".github/forge-review.md"
```

Both camelCase and snake_case review keys are accepted. Configuration is read from the trusted base branch, so a pull request cannot disable its own review. Create `.github/forge-review.md` with your review guidelines; it is treated as review context, never as executable instructions.

### Supported LLM Providers

Any OpenAI-compatible API:

- NVIDIA NIM (default)
- OpenRouter
- DeepSeek
- Together AI
- Groq
- vLLM
- Self-hosted endpoints

### Status Checks

Every review posts a Forge Review commit status on the head commit: pending while the review runs, success with the finding count when it completes, and failure only when the reviewer itself fails. Findings never fail the check, so Forge Review is informational by default and never blocks merges until you opt into enforcement.

### Testing

```bash
pnpm test
```

Tests use Vitest with mocks at every external boundary. No test requires GitHub credentials or live model calls. Coverage spans configuration parsing, webhook verification, diff handling, structured LLM responses, finding validation, verification, and review publishing.

### Deployment

Deploy the repository to Vercel. The serverless entry in `api/` serves the API under `/api/*` after `pnpm run build` compiles the workspace.

Set these environment variables in the Vercel dashboard before the first deploy: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `NVIDIA_API_KEY`, plus optional `LLM_BASE_URL`, `LLM_MODEL`, and `PORT`. Missing required values fail the deployment fast with named fields.

Point the GitHub App webhook URL at `https://<your-project>.vercel.app/api/webhooks/github`.

Function timeouts bound review length: the Hobby plan allows 60 seconds per execution, so large reviews can be cut off. Raise `maxDuration` in `vercel.json` as far as your plan allows, and keep diffs and verification budgets compact enough to fit inside the limit.

For local runs outside Vercel, build once and start the compiled server directly:

```bash
pnpm install --frozen-lockfile
pnpm run build
PORT=3000 node apps/api/dist/index.js
```

### Security

- All webhook payloads verified via HMAC-SHA256 with delivery replay protection
- Repository configuration loaded from the trusted base branch, never the PR head
- Service API keys never sent to repository-overridden model URLs
- Repository content treated as untrusted input with prompt hierarchy enforcement
- No code execution during review and no access to environment secrets from repository content
