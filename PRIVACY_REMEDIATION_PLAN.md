# MineCord Protected Data Exposure Remediation Plan

## Verified facts

- GitHub reports `ZEY-CAT/MineCord` as a public repository.
- A read-only tree query shows `server/data.json` in the current public `main` tree.
- GitHub's path history contains the initial public commit `21d88166174a46fd0449418904c97a621b7ace09` from 2026-10-08. The file's content was not fetched or inspected.
- The protected local file remains present at SHA-256 `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`.
- Existing local data, uncommitted edits, and databases must remain untouched. No history rewrite, force-push, or repository setting change has been made.

## Owner decisions required

1. **Containment:** Decide whether to make the existing repository private now. Before changing visibility, confirm who and what currently depend on public clone access, public Pages/releases, and unauthenticated CI or deployment integrations. Private visibility limits future access to the repository; it cannot recall prior clones or downloads.
2. **Content assessment:** An authorized owner/operator should inspect the protected file only in a controlled environment and classify whether it contains credentials, personal information, account records, messages, or other user data. Do not paste the contents into an issue, chat, CI log, or this handoff. If credentials are present, rotate/revoke them through their issuing services. If personal/private records are present, follow the operator's incident-response and retention obligations.
3. **History disposition:** Decide explicitly whether existing history should remain available to authorized repository users, or whether a history rewrite is required. A rewrite is a high-impact operation and must not proceed without explicit authorization and an agreed ref/coordination plan.

## Safe execution sequence after owner approval

1. Preserve the current local file and its verified hash. Make a separate encrypted, access-controlled backup through the normal data-backup process; do not use Git or CI artifacts for this backup.
2. Freeze pushes and release/deploy workflows while the owner assesses the data and chooses containment. Keep the current local branch and all uncommitted work intact.
3. If a rewrite is explicitly approved, perform it in a separate disposable mirror clone, never in this working checkout. Enumerate branches and tags to be sanitized; remove the path from every approved ref, verify all rewritten trees and reachable commits without printing the file content, and coordinate with collaborators before publishing rewritten refs. A force-push is not authorized by this plan; obtain separate explicit approval if the chosen publication method requires one. Consider a new private sanitized repository if replacing history in place is not approved.
4. Ask GitHub support about cached views where appropriate. Inform collaborators that existing clones and downloaded copies require their own handling; a rewritten repository cannot erase those copies.
5. Add and verify a staging/CI guard so future source commits cannot include `server/data.json`, local databases, or secrets. A `.gitignore` entry alone is insufficient while a path is already tracked.
6. Reopen pushes only after the owner confirms the selected repository visibility/history outcome and the sanitized refs have been independently verified.

## Render persistence gate

No production deployment should happen until an authorized operator can verify in Render that:

- A persistent disk is attached to the correct service and mounted at the declared absolute root.
- `MINECORD_PERSISTENT_DATA_DIR` names that root and `DATABASE_URL` resolves to a SQLite file contained within it.
- The current production database has a verified backup before any restart, path change, migration, or deploy.
- A staging restart/redeploy test with an isolated database proves persistence; production data is not used for the test.

The application startup guard checks declared paths but cannot prove Render actually mounted the disk. Render dashboard access and confirmation of the current database location/backup are external operator requirements.

## Current status

Waiting for owner decisions on repository visibility, data classification, and history disposition. No protected contents were inspected. No repository settings, remote history, Render environment, production database, or deployment was changed.
