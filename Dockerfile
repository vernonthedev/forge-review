FROM node:20-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm run build

ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
