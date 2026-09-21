### Forge Review GitHub App Setup

This guide takes you from an empty GitHub organization to a working Forge Review installation. It assumes you have never configured a GitHub App before. You need Node.js 20+, pnpm 9+, and admin access to the GitHub organization that owns the repositories you want reviewed.

### Create the GitHub App

Open your organization settings, then Developer settings, then GitHub Apps, and choose New GitHub App. Give the app a name such as Forge Review and a short description of what it does.

### Configure the Homepage URL

Set the homepage URL to the public address where Forge Review will run, for example `https://forge-review.example.com`. This URL is shown on the app page and is not used for webhook delivery.

### Configure the Webhook URL

Enable the webhook and set the webhook URL to `https://forge-review.example.com/webhooks/github`. For local development, expose your machine with a tunnel (see the local development section below) and use the tunnel URL instead.

### Configure the Webhook Secret

Generate a random secret of at least 32 characters and paste it into the webhook secret field. Save the same value as `GITHUB_WEBHOOK_SECRET` in your server environment. Forge Review rejects every webhook whose HMAC-SHA256 signature does not match this secret.

### Generate the Private Key

In the app settings, generate a private key and download the resulting PEM file. Save the App ID from the app settings page as `GITHUB_APP_ID` and the full PEM contents as `GITHUB_PRIVATE_KEY` in your server environment. The key is used to sign short-lived tokens for each installation.

### Configure Permissions

Request the minimum repository permissions:

- Contents: Read
- Pull requests: Read and Write
- Metadata: Read

Pull request write access is required to publish reviews and commit statuses. Contents read access is required to fetch diffs, configuration, and guidelines.

### Subscribe to Pull Request Events

Under webhook subscriptions, subscribe to the Pull request event. Forge Review handles the opened, reopened, and synchronize actions and acknowledges everything else without action.

### Install the App on a Repository

Open the app page, choose Install, and select the repositories to review. Note the installation: Forge Review mints a repository-scoped token per installation, so it can only ever touch repositories where it is installed.

### Configure Server Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
GITHUB_APP_ID=your-app-id
GITHUB_PRIVATE_KEY=your-private-key
GITHUB_WEBHOOK_SECRET=your-webhook-secret

NVIDIA_API_KEY=your-nvidia-api-key
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=nvidia/nemotron-3-ultra-550b-a55b

PORT=3000
```

Never commit the `.env` file. The LLM variables set the default provider; a repository can override provider and model in its own configuration file.

### Add the Repository Configuration

Create `.github/forge-review.yml` on the default branch of each repository you want reviewed:

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

Configuration is read from the trusted base branch, so a pull request cannot disable reviews or redirect the model endpoint for its own review. Optionally add `.github/forge-review.md` with repository-specific review guidance.

### Open a Test Pull Request

Open a pull request in the installed repository that changes at least one reviewable source file. Forge Review starts automatically. No manual trigger and no GitHub Action is required.

### Verify the Webhook

Open the app settings, then Advanced, then Recent Deliveries. Find the `pull_request` delivery for your test PR and confirm GitHub received a 202 response. A missing delivery means the webhook URL is unreachable or the tunnel has expired.

### Verify the Review

On the test pull request, confirm the Forge Review commit status appears, followed by a consolidated review with a summary and inline findings. Then check the server logs for the correlation ID line showing repository, PR number, duration, finding count, provider, model, and token usage.

### Troubleshoot Failures

Invalid signature errors mean `GITHUB_WEBHOOK_SECRET` does not match the app settings. Authentication failures mean the App ID or private key is wrong or the key was regenerated. A review that never appears usually means the webhook URL is unreachable, the app is not installed on the repository, or the base-branch configuration sets `enabled: false`. Model errors appear in the server logs with the provider, status code, and retry count.

### Local Development

Run `pnpm install` once, then `pnpm dev` to start the API on port 3000. Expose it with a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and point the app webhook URL at the tunnel address plus `/webhooks/github`. Open a test PR in a repository where the app is installed, watch the tunnel and server logs, and confirm the review appears on the PR.
