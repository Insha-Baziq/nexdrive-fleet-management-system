import fs from "node:fs";

const nativeFetch = globalThis.fetch.bind(globalThis);
const stateFile = process.env.NEXDRIVE_VERIFY_AUTH_THROTTLE_STATE;
const windowMs = 10_000;
const maxPerWindow = 3;
let localRequests = [];
let queue = Promise.resolve();

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recentRequests(now) {
  let requests = localRequests;
  if (stateFile && fs.existsSync(stateFile)) {
    try {
      requests = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      requests = localRequests;
    }
  }
  return requests.filter((timestamp) => Number.isFinite(timestamp) && now - timestamp < windowMs);
}

globalThis.fetch = async (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const isEmailSignIn = method === "POST" && new URL(target, process.env.BETTER_AUTH_URL).pathname.endsWith("/api/auth/sign-in/email");
  if (!isEmailSignIn) return nativeFetch(input, init);

  let release;
  const turn = new Promise((resolve) => { release = resolve; });
  const previous = queue;
  queue = turn;
  await previous;

  try {
    let recent = recentRequests(Date.now());
    if (recent.length >= maxPerWindow) {
      await pause(Math.max(0, windowMs - (Date.now() - recent[0]) + 150));
      recent = recentRequests(Date.now());
    }
    const now = Date.now();
    localRequests = [...recent.filter((timestamp) => now - timestamp < windowMs), now];
    if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(localRequests));
  } finally {
    release();
  }

  return nativeFetch(input, init);
};
