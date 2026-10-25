# iPhone Duo watcher (Austin, TX)

Checks in-store pickup availability for the **iPhone Duo 256GB** (Star White and
Night Sky) at Apple **Barton Creek** and **Domain Northside**. When either store
goes from unavailable to available, it sends a push notification through
[ntfy](https://ntfy.sh).

- `check.mjs`: the checker. It has no dependencies and needs Node 18 or newer.
- `.github/workflows/check.yml`: runs the checker on GitHub Actions.
- `state.json`: last known availability, committed only when it changes.

It uses Apple's undocumented `shop/retail/pickup-message` endpoint, which can
change without notice. If checks fail for more than 20 minutes, you get one
warning notification.

## Setup

1. **Phone:** install the ntfy app and subscribe to your topic name, which is
   stored as the `NTFY_TOPIC` repo secret.
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
NTFY_TOPIC=your-topic node check.mjs                # one check
NTFY_TOPIC=your-topic node check.mjs --test-notify  # send a test push
```

To watch other models, edit `PARTS` in `check.mjs`. 512GB: `MK1G4LL/A`,
`MK1H4LL/A`. 1TB: `MK1J4LL/A`, `MK1L4LL/A`. 2TB: `MK1Q4LL/A`, `MK1R4LL/A`.

## Stopping it

Disable the cron-job.org job and run `gh workflow disable check.yml`, or
archive the repo.
