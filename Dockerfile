# One Dockerfile, one target per Node service. Build from the repo root:
#   docker build --target core .
#   docker build --target slack-app .
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/slack-app/package.json packages/slack-app/
COPY packages/extension/package.json packages/extension/
# tsx runs the TypeScript directly, so dev deps are needed at runtime.
RUN npm ci --include=dev --workspace @cos/shared --workspace @cos/core --workspace @cos/slack-app --include-workspace-root=false
COPY tsconfig.base.json agent.config.json ./
COPY packages/shared packages/shared
COPY seed seed
COPY evals evals
COPY skills skills

FROM base AS core
COPY packages/core packages/core
USER node
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "@cos/core"]

FROM base AS slack-app
COPY packages/slack-app packages/slack-app
USER node
CMD ["npm", "run", "start", "-w", "@cos/slack-app"]
