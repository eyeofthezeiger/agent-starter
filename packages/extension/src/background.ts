import { api } from "./api.ts";
import { intakeFromClick } from "./format.ts";

const MENU_ID = "cos_send_to_queue";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Send to queue", contexts: ["selection", "link", "page"] });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

function flashBadge(text: string, color: string) {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 4000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const req = intakeFromClick({ pageUrl: info.pageUrl, linkUrl: info.linkUrl, selectionText: info.selectionText, pageTitle: tab?.title });
  if (!req) return flashBadge("!", "#b00020");
  try {
    const res = await api.intake(req);
    flashBadge(res.duplicate ? "=" : "✓", "#1a7f37");
    // Tell an open side panel to refresh. No listener is fine.
    chrome.runtime.sendMessage({ type: "queue-changed" }).catch(() => undefined);
  } catch (err) {
    console.error("Send to queue failed", err);
    flashBadge("!", "#b00020");
  }
});
