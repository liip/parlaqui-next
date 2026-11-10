# The daily roster import

`POST /api/import` fetches the current members of the Federal Assembly from the Swiss Parliament
Open Data Web Service (ws.parl.ch) in the four languages, validates the snapshot, checks that
each photo exists and publishes everything in one transaction. A snapshot that fails validation
is rejected and the members already stored stay untouched.

## Environment

- `IMPORT_TOKEN`: bearer token, 32 characters or more, or the route answers 404. Generate one
  with `openssl rand -hex 24`.
- `PARL_API_KEY`: API key for ws.parl.ch (request one at https://ws.parl.ch/registration). If it
  is unset the route answers 500 with a message naming the variable.

## Answers

The body is the outcome as JSON, for example
`{"status":"published","national":200,"states":46,"withoutPhoto":0}`.

| Status      | HTTP | Meaning                                                           |
| ----------- | ---- | ----------------------------------------------------------------- |
| `published` | 200  | the snapshot was valid and is now live                            |
| `skipped`   | 200  | another import was already running                                |
| `rejected`  | 502  | the snapshot failed validation, the stored roster is unchanged    |
| `failed`    | 502  | ws.parl.ch or the database failed, the stored roster is unchanged |

A snapshot is `rejected`, with every reason in `detail`, when:

- an id appears twice within one language (`fr records repeat ids …`), e.g. pages that overlap because the
  data changed while paging;
- a record of a Nationalrat or Ständerat member lacks a required field (id, name, gender, canton, party) and
  would drop out as if the person had left (`2 incomplete council member records: 491, 18110`). Records of
  other types, such as Federal Council members, are left out without a reason; a member record without a
  known council is left out and counted as `incomplete` in the detail of a published run;
- a council has fewer or more members than its seats allow (Nationalrat 195 to 200, Ständerat 44 to 46),
  or a canton code is unknown;
- more than 10 members, or 5 % of the snapshot if that is more, would lose the photo code they have: the
  photo check says no photo (`photo check says no photo for …`) or ws.parl.ch sends no `legacyId` for them
  (`ws.parl.ch sends no photo code for …`).

A member without `legacyId` whose portrait is already on rokka keeps the stored code, like a member whose
photo check fails while rokka holds the last good copy. When the photo check itself cannot be reached, every
stored code is kept and the detail says `photo checks failed N, kept stored codes`.

Non-2xx for `rejected` and `failed` is deliberate: a command calling the route then exits non-zero, and a scheduler shows
the run as failed.

With `ROKKA_API_KEY` set, a published import then refreshes the portraits on rokka, still under the import lease (a `running` row in `roster_import` that the import renews every 30 s and that runs out 2 minutes after a process died), and
the answer carries `photos`: `unchanged`, `uploaded`, `missing` (parlament.ch answers 404 or no image), `held` (the
same file served for several members, i.e. a placeholder) and `failed` (download, check or upload failed after one
retry). Every case except `uploaded` keeps the copy already on rokka. When `failed` is above zero, or the refresh
itself crashed (`photosError`), the answer is `502` although the roster is published, so a portrait that silently
stops refreshing still fails the call, and the daily import logs it as a warning. The counts are appended to `roster_import.detail`.

## Firing it every day

The server imports by itself: an hourly timer starts the import once per Zurich day, at startup too, so a new
database gets its roster within seconds of the first start. A roster already published that Zurich day is not
fetched again, so restarts and deploys do not import again. Without `PARL_API_KEY` there is no daily import.
The outcome is logged (`roster import published: ...`); a failed or rejected import is logged as a warning and
tried again at the next hourly check.

`POST /api/import` still starts one by hand, for example after a change in parliament:

```
node -e "fetch('http://127.0.0.1:3000/api/import',{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+process.env.IMPORT_TOKEN}}).then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)},e=>{console.error(e);process.exit(1)})"
```

It runs inside the app container (`kubectl exec deploy/parlaqui -- node -e "..."`), which
has no curl, and reads `IMPORT_TOKEN` from the container environment, so the token is never typed. The call stays
on the loopback, so no firewall or redirect to the public name is involved. The lease keeps it from running
alongside the daily import: the second one answers `skipped`.

## Reading the history

Every run leaves one row in `roster_import`:

```sql
select id, started_at, finished_at, status, national, states, without_photo, detail
from roster_import
order by id desc
limit 10;
```

`status` is `running`, `published`, `rejected` or `failed`; `detail` says why a run was rejected
or failed. A row stuck at `running` is a run that was interrupted; the next run closes such rows as `failed` with detail `interrupted`.

A run normally lasts a few minutes: the first one with a rokka key uploads every portrait and took under two minutes locally, later ones upload only the portraits that changed. In the worst case the photo checks and downloads take well over ten minutes if parlament.ch hangs. Node's `fetch` in the one-liner waits at most five minutes for the answer, so such a slow run looks failed to the caller while the server finishes it; `roster_import` always holds the real outcome.

## When the data is old

The home page shows a notice when no import has been published in the last 72 hours. Until the
mailer exists, that notice and the warnings in the log are the signals that the import needs
attention.
