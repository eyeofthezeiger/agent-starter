# Sandboxed coding worker: Claude Code in headless mode.
# Runs as a non-root user, read-only root filesystem (see docker-compose.yml),
# no production credentials, egress only through the allowlist proxy.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates jq \
  && rm -rf /var/lib/apt/lists/*

# Pin the version you have reviewed. Update it on purpose, not by accident.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && npm cache clean --force

RUN useradd --create-home --uid 10001 agent
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY pre-push /usr/local/share/agent-hooks/pre-push
RUN chmod 0555 /usr/local/bin/entrypoint.sh /usr/local/share/agent-hooks/pre-push

USER agent
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
