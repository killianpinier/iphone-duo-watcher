# iPhone Duo watcher (Austin, TX)

Checks in-store pickup availability for the **iPhone Duo 256GB and 512GB**
(Star White and Night Sky) at the two Austin Apple stores, Barton Creek and
Domain Northside. When a model goes from unavailable to available, it sends a
high-priority push notification through [Pushover](https://pushover.net). Each
line in the alert links to that model's buy page.

Each run checks 3 times, 20 seconds apart, so with the every-minute trigger
below you get a check every 20 seconds. To go back to once a minute (fewer
requests to Apple), set the repo variable `CHECKS_PER_RUN` to `1`:
`gh variable set CHECKS_PER_RUN --body 1`.

Each check is one request to Apple for ZIP 78701, whose nearest stores include
both Austin stores.

- `check.mjs`: the checker. It has no dependencies and needs Node 18 or newer.
- `.github/workflows/check.yml`: runs the checker on GitHub Actions.
- `state.json`: last known availability, committed only when it changes.

It uses Apple's undocumented `shop/retail/pickup-message` endpoint, which can
change without notice. If checks fail for more than 20 minutes, you get one
warning notification.

## Setup

1. **Phone:** install the Pushover app and sign in. From <https://pushover.net>,
   copy your **User Key**, then create an application to get an **API Token**.
   Store them as the `PUSHOVER_USER` and `PUSHOVER_TOKEN` repo secrets.
2. **Every-minute trigger:** GitHub's built-in schedule often runs 10-30 minutes
   late, so an external pinger triggers the workflow instead.
   - Create a fine-grained GitHub token at
     <https://github.com/settings/personal-access-tokens/new>. Limit it to this
     repo only, with **Actions: Read and write** permission.
   - On <https://cron-job.org>, create a free account and add a cron job:
     - URL: `https://api.github.com/repos/<owner>/iphone-duo-watcher/actions/workflows/check.yml/dispatches`
     - Schedule: every 1 minute
     - Advanced → Request method: `POST`
     - Headers:
       - `Authorization: Bearer <token>`
       - `Accept: application/vnd.github+json`
       - `Content-Type: application/json`
     - Request body: `{"ref":"main"}`
     - A successful call returns HTTP **204**.

## Local use

```sh
export PUSHOVER_USER=... PUSHOVER_TOKEN=...
node check.mjs                # one check
node check.mjs --test-notify  # send a test push
CHECKS_PER_RUN=3 node check.mjs  # 3 checks, 20 seconds apart
```

To watch other models, edit `PARTS` in `check.mjs`. 1TB: `MK1J4LL/A`, `MK1L4LL/A`. 2TB: `MK1Q4LL/A`, `MK1R4LL/A`.

## Stopping it

Disable the cron-job.org job and run `gh workflow disable check.yml`, or
archive the repo.
