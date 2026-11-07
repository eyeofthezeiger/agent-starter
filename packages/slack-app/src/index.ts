import { App, LogLevel, type AllMiddlewareArgs, type BlockAction, type ButtonAction, type SlackActionMiddlewareArgs } from "@slack/bolt";
import { ACTION_APPROVE, ACTION_PAUSE_TOGGLE, ACTION_REJECT, CoreApiError, CoreClient, homeView, itemBlocks } from "@cos/shared";
import { loadAgentConfig } from "@cos/shared/agent-config";
import { fromMessageShortcut, fromSlashCommand } from "./intake.ts";

type ButtonArgs = SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs;

const agent = loadAgentConfig();
const COMMAND = agent.slack.command;
const ALLOWED_USERGROUP_ID = agent.team.allowedUsergroupId;

const {
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  CORE_URL = "http://localhost:8787",
  CORE_API_TOKEN = "",
  GATE_SYNC_MINUTES = "15",
} = process.env;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  // Stay up (so `docker compose up` stays green) but do nothing until tokens are set.
  console.warn("SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set. The Slack app is idle. See README > Create the Slack app.");
  setInterval(() => undefined, 1 << 30);
} else {
  await start(SLACK_BOT_TOKEN, SLACK_APP_TOKEN);
}

async function start(botToken: string, appToken: string) {
  const core = new CoreClient({ baseUrl: CORE_URL, token: CORE_API_TOKEN });
  // Socket Mode: an outbound websocket, so no public URL or open port.
  const app = new App({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.INFO });

  const coreError = (err: unknown) =>
    err instanceof CoreApiError && err.status === 403 ? `Only ${agent.owner.name} (or a named approver) can do that.` : "The queue is unreachable right now. Nothing was lost on your side; try again in a minute.";

  // <command> <request>, e.g. /ask review the pricing copy by Friday
  app.command(COMMAND, async ({ command, ack, respond }) => {
    await ack(); // inside Slack's 3-second window, before any network call
    const req = fromSlashCommand(command);
    if (!req) return void (await respond({ response_type: "ephemeral", text: `Add what you need, e.g. \`${COMMAND} review the pricing copy by Friday\`.` }));
    try {
      const res = await core.intake(req);
      await respond({ response_type: "ephemeral", text: res.ack });
    } catch (err) {
      console.error(err);
      await respond({ response_type: "ephemeral", text: coreError(err) });
    }
  });

  // Message shortcut: "Send to queue"
  app.shortcut("send_to_queue", async ({ shortcut, ack, client }) => {
    await ack();
    if (shortcut.type !== "message_action") return;
    let permalink: string | undefined;
    try {
      permalink = (await client.chat.getPermalink({ channel: shortcut.channel.id, message_ts: shortcut.message.ts })).permalink;
    } catch {
      /* a missing permalink is fine */
    }
    const req = fromMessageShortcut(
      { user: shortcut.user, channel: shortcut.channel, message: shortcut.message as { ts: string; text?: string; user?: string; thread_ts?: string } },
      permalink,
    );
    const say = (text: string) => client.chat.postEphemeral({ channel: shortcut.channel.id, user: shortcut.user.id, text });
    if (!req) return void (await say("That message has no text to queue."));
    try {
      await say((await core.intake(req)).ack);
    } catch (err) {
      console.error(err);
      await say(coreError(err));
    }
  });

  // Approve / Reject buttons (in DMs and on App Home). The core checks the approver list too.
  const decideHandler = (approve: boolean) =>
    async ({ ack, body, action, client, respond }: ButtonArgs) => {
      await ack();
      const actor = body.user.id;
      try {
        const { item } = approve ? await core.approve(action.value ?? "", actor) : await core.reject(action.value ?? "", actor);
        if (body.container?.type === "message") {
          await respond({ replace_original: true, text: `${approve ? "Approved" : "Rejected"} by <@${actor}>`, blocks: itemBlocks(item) as never });
        }
      } catch (err) {
        console.error(err);
        await client.chat.postEphemeral({ channel: body.channel?.id ?? actor, user: actor, text: coreError(err) }).catch(() => undefined);
      }
      if (body.view?.type === "home") await publishHome(client, actor);
    };
  app.action<BlockAction<ButtonAction>>(ACTION_APPROVE, decideHandler(true));
  app.action<BlockAction<ButtonAction>>(ACTION_REJECT, decideHandler(false));

  // Pause switch on App Home.
  app.action<BlockAction<ButtonAction>>(ACTION_PAUSE_TOGGLE, async ({ ack, body, action, client }) => {
    await ack();
    try {
      await core.setPaused(action.value === "pause", body.user.id);
    } catch (err) {
      console.error(err);
    }
    await publishHome(client, body.user.id);
  });

  // App Home: the queue view.
  app.event("app_home_opened", async ({ event, client }) => {
    if (event.tab === "home") await publishHome(client, event.user);
  });

  async function publishHome(client: App["client"], userId: string) {
    try {
      const [{ items }, { briefs }, status] = await Promise.all([core.queue(), core.briefs(3), core.status()]);
      await client.views.publish({ user_id: userId, view: homeView(items, briefs, status.paused) as never });
    } catch (err) {
      console.error(err);
      await client.views.publish({
        user_id: userId,
        view: { type: "home", blocks: [{ type: "section", text: { type: "mrkdwn", text: "The queue is unreachable right now." } }] },
      });
    }
  }

  // Gate sync: the allowed user group's members become the core's VIP list.
  async function syncGate() {
    if (!ALLOWED_USERGROUP_ID) return console.warn("team.allowedUsergroupId is empty in agent.config.json. Only the owner can send requests.");
    try {
      const res = await app.client.usergroups.users.list({ usergroup: ALLOWED_USERGROUP_ID });
      const { count } = await core.syncGateMembers(res.users ?? []);
      console.log(`gate sync: ${count} member(s)`);
    } catch (err) {
      console.error("gate sync failed; keeping the last list", err);
    }
  }

  await app.start();
  console.log(`Slack app connected (Socket Mode), listening for ${COMMAND}`);
  await syncGate();
  setInterval(syncGate, Number(GATE_SYNC_MINUTES) * 60_000);
}
