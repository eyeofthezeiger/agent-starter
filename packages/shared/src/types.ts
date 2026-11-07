// Types shared by the core, the Slack app and the Chrome extension.

/** Where a record came from. Each source has an explicit trust level in the gate. */
export type Source =
  | "slack_command" // the slash command set in agent.config.json (default /ask)
  | "slack_shortcut" // "Send to queue" message shortcut
  | "slack_mention"
  | "slack_dm"
  | "slack_ambient"
  | "chrome" // extension right-click "Send to queue"
  | "notes" // a personal capture tool (handwritten or voice notes); work items only, off by default
  | "seed"; // synthetic data

export type Lane = "work" | "personal";

/** explicit = someone asked directly; inferred = observe only, digest with Accept/Ignore; ignore = drop. */
export type Trust = "explicit" | "inferred" | "ignore";

export type GateDecision = "admit" | "observe" | "reject";

export type ItemStatus =
  | "new" // stored, waiting for triage
  | "pending_approval" // triage proposed an action; waits for a human
  | "needs_answer" // triage confidence too low; asks the owner instead of guessing
  | "approved"
  | "rejected"
  | "context" // goes to the context store, not Jira
  | "fyi"
  | "dropped";

export type Category = "work_task" | "context" | "fyi" | "ignore";
export type Urgency = "today" | "this_week" | "later";

/** Approval tiers from the security baseline. A person promotes a class; never automatic. */
export type ApprovalTier = "read" | "draft" | "send_with_approval" | "automatic";

export interface IntakeRequest {
  source: Source;
  /** Stable id in the source system (Slack channel:ts, trigger id, URL hash). */
  nativeId: string;
  author: string;
  text: string;
  linkBack?: string;
  lane?: Lane;
  /** true when the message was addressed to the agent (command, DM, mention, shortcut). */
  addressed?: boolean;
  threadKey?: string;
  refs?: string[];
  sourceTs?: string;
}

export interface IntakeResponse {
  id: string;
  decision: GateDecision;
  duplicate: boolean;
  /** Short text the source can show right away (the "instant ack"). */
  ack: string;
}

export interface QueueItem {
  id: string;
  source: Source;
  author: string;
  text: string | null;
  linkBack: string | null;
  status: ItemStatus;
  gateDecision: GateDecision;
  category: Category | null;
  urgency: Urgency | null;
  confidence: number | null;
  reason: string | null;
  proposedAction: ProposedAction | null;
  createdAt: string;
}

export interface ProposedAction {
  kind: "jira.create_issue" | "context.store" | "ask_owner";
  summary: string;
  tier: ApprovalTier;
}

export interface Brief {
  id: string;
  kind: "morning_digest" | "meeting_brief" | "inferred_digest";
  title: string;
  body: string;
  createdAt: string;
}

export interface CoreStatus {
  ok: boolean;
  paused: boolean;
  dryRun: boolean;
  triage: string;
}
