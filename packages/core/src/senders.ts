import type { Config } from "./config.ts";
import { jiraConfigured } from "./config.ts";
import type { MessengerBus, BusEvent } from "./bus/index.ts";
import { JiraClient } from "./atlassian/jira.ts";
import type { SenderRegistry } from "./outbox.ts";

/**
 * The only code that writes to the outside world. With DRY_RUN=true (the
 * default) every sender logs what it would do and returns a fake result.
 */
export function createSenders(cfg: Config, bus: MessengerBus, log: (msg: string) => void = console.log): SenderRegistry {
  const jira = jiraConfigured(cfg)
    ? new JiraClient({ baseUrl: cfg.JIRA_BASE_URL!, email: cfg.JIRA_EMAIL!, apiToken: cfg.JIRA_API_TOKEN! }, cfg.JIRA_PROJECT_KEY, cfg.JIRA_ISSUE_TYPE)
    : null;

  return {
    "slack.post_message": async (p) => {
      if (cfg.DRY_RUN || !cfg.SLACK_BOT_TOKEN) {
        // No raw message text in logs: log where it would go and how long it is.
        log(`[dry-run] slack.post_message channel=${String(p.channel)} chars=${String(p.text ?? "").length}`);
        return { dryRun: true };
      }
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: p.channel, thread_ts: p.threadTs, text: p.text, blocks: p.blocks, unfurl_links: false }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; ts?: string; channel?: string };
      if (!body.ok) throw new Error(`chat.postMessage: ${body.error ?? res.status}`);
      return { ts: body.ts, channel: body.channel };
    },

    "jira.create_issue": async (p) => {
      if (cfg.DRY_RUN || !jira) {
        const key = `${cfg.JIRA_PROJECT_KEY}-DRY${String(p.idempotencyLabel ?? "").slice(-4)}`;
        log(`[dry-run] jira.create_issue ${key} item=${String(p.itemId)}`);
        return { key, dryRun: true };
      }
      const issue = await jira.createIssue({
        summary: String(p.summary),
        description: String(p.description),
        linkBack: typeof p.linkBack === "string" ? p.linkBack : undefined,
        labels: ["chief-of-staff"],
        idempotencyLabel: typeof p.idempotencyLabel === "string" ? p.idempotencyLabel : undefined,
      });
      return { key: issue.key, id: issue.id };
    },

    "bus.publish": async (p) => {
      if (cfg.DRY_RUN) {
        log(`[dry-run] bus.publish ${String(p.type)}`);
        return { dryRun: true };
      }
      await bus.publish({ ...(p as unknown as BusEvent), at: new Date().toISOString() });
    },
  };
}
