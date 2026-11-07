#!/usr/bin/env bash
# Worker entrypoint. A stub on purpose: with WORKER_ENABLED=false (the default)
# it checks the sandbox and prints what it would run, then exits.
#
# Usage (once enabled):
#   docker compose --profile worker run --rm worker "<ticket key>" "<task prompt>"
set -euo pipefail

TICKET="${1:-COS-0}"
PROMPT="${2:-Describe the repository layout. Do not change anything.}"
BRANCH="agent/$(echo "$TICKET" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"

fail() { echo "worker: $*" >&2; exit 1; }

# 1. No production credentials. The worker gets only the agent's own tokens.
for var in DATABASE_URL CORE_API_TOKEN SLACK_BOT_TOKEN SLACK_APP_TOKEN JIRA_API_TOKEN \
           AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY GOOGLE_APPLICATION_CREDENTIALS GH_ADMIN_TOKEN; do
  if [ -n "${!var:-}" ]; then fail "refusing to start: $var is set. Workers never get production credentials."; fi
done

# 2. Egress only through the allowlist proxy.
[ -n "${HTTPS_PROXY:-}" ] || fail "HTTPS_PROXY is not set; egress must go through the allowlist proxy."

# 3. Only the mounted workspace is writable.
[ -w /workspace ] || fail "/workspace is not writable."

echo "worker: sandbox checks passed (ticket=$TICKET branch=$BRANCH)"

CLAUDE_CMD=(claude -p "$PROMPT"
  --output-format json
  --max-turns 30
  # Tool allowlist: read and edit files, run tests and git. No web fetches, no other shells.
  --allowedTools "Read,Edit,Write,Glob,Grep,Bash(git status:*),Bash(git diff:*),Bash(git add:*),Bash(git commit:*),Bash(npm test:*),Bash(npm run lint:*)")

if [ "${WORKER_ENABLED:-false}" != "true" ]; then
  echo "worker: WORKER_ENABLED is not true. Would run, in /workspace/repo on branch $BRANCH:"
  printf '  %q' "${CLAUDE_CMD[@]}"; echo
  exit 0
fi

[ -n "${ANTHROPIC_API_KEY:-}" ] || fail "ANTHROPIC_API_KEY (an organization-owned key) is required."
[ -n "${WORKER_REPO_URL:-}" ] || fail "WORKER_REPO_URL is required."

# One clone per run, one branch per ticket (a fresh worktree in practice).
cd /workspace
rm -rf repo
GIT_ASKPASS=/bin/echo git -c "http.extraHeader=Authorization: Bearer ${AGENT_GITHUB_TOKEN:-}" clone --depth 50 "$WORKER_REPO_URL" repo
cd repo
git config user.name "chief-of-staff-agent"
git config user.email "agent@users.noreply.github.com"
# Branch-only push: the hook refuses any ref that is not agent/*.
git config core.hooksPath /usr/local/share/agent-hooks
git switch -c "$BRANCH"

"${CLAUDE_CMD[@]}" | tee /workspace/last-run.json

# Pushing is a separate, explicit step the core asks for after review. Kept here
# commented so the stub never pushes on its own.
# git -c "http.extraHeader=Authorization: Bearer ${AGENT_GITHUB_TOKEN}" push origin "$BRANCH"
