// Checks Apple's in-store pickup availability for the iPhone Duo 256GB and 512GB
// at the two Austin stores (Barton Creek and Domain Northside) and sends a
// high-priority push notification through Pushover when it turns available.
//
// Usage (needs PUSHOVER_USER and PUSHOVER_TOKEN set):
//   node check.mjs                 # normal check
//   node check.mjs --test-notify   # send a test push and exit
//
// CHECKS_PER_RUN (default 1) runs several checks in one go, CHECK_INTERVAL_SECONDS
// (default 20) apart. With a run triggered every minute, 3 checks per run means
// a check every 20 seconds.
//
// State is kept in state.json so you only get alerted when a store goes
// from unavailable to available, not on every run.

import { readFile, writeFile } from "node:fs/promises";

const PARTS = {
  "MK1E4LL/A": "iPhone Duo 256GB Star White",
  "MK1F4LL/A": "iPhone Duo 256GB Night Sky",
  "MK1G4LL/A": "iPhone Duo 512GB Star White",
  "MK1H4LL/A": "iPhone Duo 512GB Night Sky",
};

// Apple returns the 12 stores nearest to this ZIP (downtown Austin), which
// includes both Austin stores. Only the stores listed below are kept.
const LOCATION = "78701";
const STORES = new Set(["R085", "R216"]); // Barton Creek, Domain Northside

const BUY_URL = "https://www.apple.com/shop/buy-iphone/iphone-duo";
// Opens the buy page with this model's storage and color already selected.
const productUrl = (part) => `https://www.apple.com/shop/product/${part}`;
const STATE_FILE = new URL("./state.json", import.meta.url);
// Warn once if Apple has been unreachable for this long, so failures aren't silent.
const FAILURE_ALERT_MS = 20 * 60 * 1000;

const CHECKS_PER_RUN = Math.max(1, parseInt(process.env.CHECKS_PER_RUN, 10) || 1);
const CHECK_INTERVAL_MS = (parseInt(process.env.CHECK_INTERVAL_SECONDS, 10) || 20) * 1000;

const { PUSHOVER_USER, PUSHOVER_TOKEN } = process.env;
if (!PUSHOVER_USER || !PUSHOVER_TOKEN) {
  console.error("PUSHOVER_USER and PUSHOVER_TOKEN must be set");
  process.exit(1);
}

async function fetchStores(location) {
  const params = new URLSearchParams({ pl: "true", location });
  Object.keys(PARTS).forEach((p, i) => params.set(`parts.${i}`, p));

  const res = await fetch(`https://www.apple.com/shop/retail/pickup-message?${params}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      Accept: "application/json",
      Referer: BUY_URL,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Apple returned HTTP ${res.status} for ${location}`);
  const stores = (await res.json())?.body?.stores;
  if (!Array.isArray(stores)) throw new Error(`Unexpected response shape from Apple for ${location}`);
  return stores;
}

async function fetchAvailability() {
  const stores = await fetchStores(LOCATION);

  // { "R085|MK1E4LL/A": { available, store, model, quote, link } }
  const result = {};
  for (const store of stores) {
    if (!STORES.has(store.storeNumber)) continue;
    for (const part of Object.keys(PARTS)) {
      const pa = store.partsAvailability?.[part];
      result[`${store.storeNumber}|${part}`] = {
        available: pa?.pickupDisplay === "available",
        store: `${store.storeName} (${store.city})`,
        model: PARTS[part],
        quote: pa?.pickupSearchQuote ?? "unknown",
        link: productUrl(part),
      };
    }
  }
  // A store missing from one check and back in the next would re-trigger its
  // alerts, so treat a missing store as a failed check.
  const found = new Set(Object.keys(result).map((k) => k.split("|")[0]));
  const missing = [...STORES].filter((s) => !found.has(s));
  if (missing.length) throw new Error(`Store(s) missing from Apple response: ${missing.join(", ")}`);
  return result;
}

// Pushover priority 1 = high: makes a sound and gets through Pushover's quiet hours.
async function notify({ title, message, priority = 1, url = BUY_URL, html = false }) {
  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: new URLSearchParams({
      token: PUSHOVER_TOKEN,
      user: PUSHOVER_USER,
      title,
      message,
      priority: String(priority),
      url,
      url_title: "Open Apple Store",
      html: html ? "1" : "0",
    }),
  });
  if (!res.ok) throw new Error(`Pushover failed: HTTP ${res.status} ${await res.text()}`);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveState(prev, next) {
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  console.log("State changed, saved state.json");
}

// Pushover rejects messages over 1,024 characters, so long lists get cut short.
// Each line links to that model's buy page (Pushover HTML message).
function describe(items) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = items.map(
    // The title already says "iPhone Duo", so lines stay short enough to list all items.
    (v) => `<a href="${v.link}">${esc(`${v.model.replace(/^iPhone Duo /, "")} @ ${v.store}`)}</a>: ${esc(v.quote)}`
  );
  let message = "";
  for (const [i, line] of lines.entries()) {
    const more = `\n…and ${lines.length - i} more`;
    if ((message + "\n" + line).length + more.length > 1024) return message + more;
    message += (message ? "\n" : "") + line;
  }
  return message;
}

// One check: fetch, alert on newly available items, save state.
// Returns false if Apple couldn't be reached.
async function checkOnce() {
  const prev = await loadState();
  let current;
  try {
    current = await fetchAvailability();
  } catch (err) {
    console.error(`Check failed: ${err.message}`);
    const next = { ...prev, failingSince: prev.failingSince ?? Date.now() };
    if (!prev.failureAlerted && Date.now() - next.failingSince > FAILURE_ALERT_MS) {
      await notify({
        title: "iPhone Duo watcher is failing",
        message: `Can't reach Apple's availability API: ${err.message}`,
        priority: 0,
      });
      next.failureAlerted = true;
    }
    await saveState(prev, next);
    return false;
  }

  const items = Object.values(current);
  const availableCount = items.filter((v) => v.available).length;
  console.log(`Checked ${STORES.size} Austin stores, ${availableCount} available`);
  for (const v of items) {
    console.log(`${v.available ? "AVAILABLE" : "-"}\t${v.model} @ ${v.store}: ${v.quote}`);
  }

  const newlyAvailable = Object.entries(current)
    .filter(([key, v]) => v.available && !prev.availability?.[key])
    .map(([, v]) => v);

  if (newlyAvailable.length) {
    await notify({
      title: "iPhone Duo available for pickup in Austin!",
      message: describe(newlyAvailable),
      url: newlyAvailable[0].link,
      html: true,
    });
    console.log(`Sent alert for ${newlyAvailable.length} item(s)`);
  }

  const availability = Object.fromEntries(
    Object.entries(current).map(([k, v]) => [k, v.available])
  );
  await saveState(prev, { availability });
  return true;
}

async function main() {
  if (process.argv.includes("--test-notify")) {
    await notify({
      title: "iPhone Duo watcher test",
      message: "If you see this, notifications are working.",
      priority: 0,
    });
    console.log("Test notification sent");
    return;
  }

  // Checks are spaced from the start of the run, so a slow Apple response
  // doesn't push later checks back.
  const start = Date.now();
  for (let i = 0; i < CHECKS_PER_RUN; i++) {
    const wait = start + i * CHECK_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (CHECKS_PER_RUN > 1) console.log(`\n— Check ${i + 1} of ${CHECKS_PER_RUN} —`);
    if (!(await checkOnce())) process.exitCode = 1;
  }
}

await main();
