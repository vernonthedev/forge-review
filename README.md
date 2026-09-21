# Forge Review

An independent GitHub AI code reviewer powered by configurable LLMs.

## Overview

Forge Review is a standalone GitHub App that automatically reviews pull requests using configurable OpenAI-compatible LLM providers. It operates independently of GitHub Actions - receiving webhook events, retrieving PR context through the GitHub API, performing AI code reviews, and publishing findings back to the PR as GitHub reviews with inline comments.

## Features

- **GitHub App Integration**: Proper GitHub App authentication with installation-scoped tokens
- **Configurable LLM Providers**: Support for any OpenAI-compatible API (NVIDIA NIM, OpenRouter, DeepSeek, Together, Groq, vLLM, self-hosted)
- **Repository Configuration**: Per-repo configuration via `.github/forge-review.yml`
- **Custom Guidelines**: Repository-specific review guidelines via `.github/forge-review.md`
- **Structured Reviews**: JSON-structured LLM output with validation
- **Finding Verification**: Optional second-pass verification to reduce false positives
- **Incremental Reviews**: Avoids duplicate comments on synchronize events
- **Async Processing**: Webhook acknowledges quickly, review runs in background
- **Security-First**: Webhook signature verification, prompt injection protection, no code execution

## Architecture

```
forge-review/
├── apps/
│   └── api/                 # Hono HTTP server
├── packages/
│   ├── github/              # GitHub API client & webhook handling
│   ├── llm/                 # LLM provider abstraction
│   ├── review-engine/       # Review orchestration
│   ├── config/              # Configuration parsing & validation
│   └── shared/              # Shared types & utilities
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- GitHub App credentials

### Installation

```bash
# Clone and install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials
```

### Environment Variables

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

### Development

```bash
# Start development server
pnpm dev

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### GitHub App Setup

1. Create a GitHub App in your organization settings
2. Configure permissions:
   - Repository permissions: Contents (Read), Pull requests (Read & Write), Metadata (Read)
   - Subscribe to: Pull request events
3. Set webhook URL to `https://your-domain.com/webhooks/github`
4. Generate and save the private key
5. Install the app on target repositories

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

Create `.github/forge-review.md` with your review guidelines.

## Supported LLM Providers

Any OpenAI-compatible API:

- NVIDIA NIM (default)
- OpenRouter
- DeepSeek
- Together AI
- Groq
- vLLM
- Self-hosted endpoints

## Security

- All webhook payloads verified via HMAC-SHA256
- Repository content treated as untrusted input
- Prompt injection protection via strict instruction hierarchy
- No code execution during review
- No access to environment secrets from repository content

## License

MIT