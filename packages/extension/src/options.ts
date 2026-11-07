import { DEFAULT_CORE_URL, getSettings } from "./api.ts";

const url = document.querySelector("#coreUrl") as HTMLInputElement;
const token = document.querySelector("#token") as HTMLInputElement;
const saved = document.querySelector("#saved") as HTMLElement;

const s = await getSettings();
url.value = s.coreUrl;
token.value = s.token;

(document.querySelector("form") as HTMLFormElement).onsubmit = async (e) => {
  e.preventDefault();
  const coreUrl = url.value.trim() || DEFAULT_CORE_URL;
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(coreUrl)) {
    saved.textContent = "Use a localhost address. The manifest only allows localhost:8787.";
    return;
  }
  await chrome.storage.local.set({ coreUrl, token: token.value.trim() });
  saved.textContent = "Saved.";
};
