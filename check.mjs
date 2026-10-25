// Checks Apple's in-store pickup availability for the iPhone Duo 256GB in
// Austin, TX and sends a push notification through ntfy when it turns available.
//
// Usage:
//   NTFY_TOPIC=... node check.mjs                 # normal check
//   NTFY_TOPIC=... node check.mjs --test-notify   # send a test push and exit
//
// State is kept in state.json so you only get alerted when a store goes
// from unavailable to available, not on every run.

import { readFile, writeFile } from "node:fs/promises";

const PARTS = {
  "MK1E4LL/A": "iPhone Duo 256GB Star White",
  "MK1F4LL/A": "iPhone Duo 256GB Night Sky",
};

// Apple stores in Austin. The API also returns San Antonio/Houston stores; we ignore those.
const STORES = {
  R085: "Barton Creek",
  R216: "Domain Northside",
};

const LOCATION = "78701";
const BUY_URL = "https://www.apple.com/shop/buy-iphone/iphone-duo";
const STATE_FILE = new URL("./state.json", import.meta.url);
// Warn once if Apple has been unreachable for this long, so failures aren't silent.
const FAILURE_ALERT_MS = 20 * 60 * 1000;

const TOPIC = process.env.NTFY_TOPIC;
if (!TOPIC) {
  console.error("NTFY_TOPIC is not set");
  process.exit(1);
}

async function fetchAvailability() {
  const params = new URLSearchParams({ pl: "true", location: LOCATION });
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
  if (!res.ok) throw new Error(`Apple returned HTTP ${res.status}`);
  const stores = (await res.json())?.body?.stores;
  if (!Array.isArray(stores)) throw new Error("Unexpected response shape from Apple");

  // { "R085|MK1E4LL/A": { available, store, model, quote } }
  const result = {};
  for (const store of stores) {
    if (!STORES[store.storeNumber]) continue;
    for (const part of Object.keys(PARTS)) {
      const pa = store.partsAvailability?.[part];
      result[`${store.storeNumber}|${part}`] = {
        available: pa?.pickupDisplay === "available",
        store: STORES[store.storeNumber],
        model: PARTS[part],
        quote: pa?.pickupSearchQuote ?? "unknown",
      };
    }
  }
  if (Object.keys(result).length === 0) throw new Error("No Austin stores in Apple response");
  return result;
}

async function notify({ title, message, priority = "urgent", tags = "iphone,rotating_light" }) {
  const res = await fetch(`https://ntfy.sh/${TOPIC}`, {
    method: "POST",
    body: message,
    headers: { Title: title, Priority: priority, Tags: tags, Click: BUY_URL },
  });
  if (!res.ok) throw new Error(`ntfy failed: HTTP ${res.status}`);
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

async function main() {
  if (process.argv.includes("--test-notify")) {
    await notify({
      title: "iPhone Duo watcher test",
      message: "If you see this, notifications are working.",
      priority: "default",
      tags: "white_check_mark",
    });
    console.log("Test notification sent");
    return;
  }

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
        priority: "default",
        tags: "warning",
      });
      next.failureAlerted = true;
    }
    await saveState(prev, next);
    process.exitCode = 1;
    return;
  }

  for (const v of Object.values(current)) {
    console.log(`${v.available ? "AVAILABLE" : "-"}\t${v.model} @ ${v.store}: ${v.quote}`);
  }

  const newlyAvailable = Object.entries(current).filter(
    ([key, v]) => v.available && !prev.availability?.[key]
  );
  if (newlyAvailable.length) {
    await notify({
      title: "iPhone Duo available for pickup in Austin!",
      message: newlyAvailable.map(([, v]) => `${v.model} @ Apple ${v.store} (${v.quote})`).join("\n"),
    });
    console.log(`Sent alert for ${newlyAvailable.length} item(s)`);
  }

  const availability = Object.fromEntries(
    Object.entries(current).map(([k, v]) => [k, v.available])
  );
  await saveState(prev, { availability });
}

await main();
