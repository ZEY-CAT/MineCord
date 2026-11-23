# MineCord Protected Data Exposure Remediation Plan

## Verified facts

- GitHub reports `ZEY-CAT/MineCord` as a public repository.
- A read-only tree query shows `server/data.json` in the current public `main` tree.
- GitHub's path history contains the initial public commit `21d88166174a46fd0449418904c97a621b7ace09` from 2026-10-08. The file's content was not fetched or inspected.
- The protected local file remains present at SHA-256 `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`.
- The owner has decided the repository must remain public. The working checkout's `server/data.json` and databases must be preserved byte-for-byte during a controlled private migration. No history rewrite, force-push, or repository setting change is authorized.

## Owner decisions and required follow-up

1. **Public-repository constraint:** Keep `ZEY-CAT/MineCord` public as explicitly directed. Removing the file from the current tree stops future tip exposure but does not remove prior public commits, cached blobs, clones, or downloads.
2. **Content assessment and credential rotation:** An authorized owner/operator should inspect the protected file only in a controlled environment and classify whether it contains credentials, personal information, account records, messages, or other user data. Do not paste contents into an issue, chat, CI log, or handoff. Rotate/revoke any credentials that may have been included through their issuing services; maintain an internal record of which services were assessed without publishing secret values. Follow applicable incident-response and retention obligations for personal/private records.
3. **History disposition:** History rewriting remains unapproved. If desired later, obtain separate explicit approval for the exact refs and publication method, coordinate with collaborators, and consider GitHub support for cached views. Never force-push under the current decision.

Potential credential classes for the owner to assess, **not confirmed present in this file**: local account password hashes (prompt resets for affected accounts if hashes were public), active MineCord sessions/cookies, OAuth authorization or refresh tokens, Minecraft/Xbox tokens, Eaglercraft connector/pairing tokens, Developer Portal account hashes/invitations, and encrypted vault entries. Separately assess provider/API secrets (Google, Microsoft, GitHub, TURN/Metered, OpenAI), vault-encryption keys, deploy tokens, and signing credentials if they were stored in the affected history or reused there. Revoke sessions and one-time connector credentials from the exposure window; rotate only the provider credentials that the authorized assessment finds exposed. No credential value or protected file content was read for this handoff.

## Safe execution sequence after owner approval

1. Keep the source and SQLite files untouched until a verified private backup and active copy exist. Keep backups access-controlled and outside Git/CI artifacts.
2. Stop the local server, migrate JSON, SQLite (including WAL state), and Developer Portal config to a private directory, verify hashes/integrity, and retain a rollback copy.
3. Start MineCord on the migrated database and verify account/message persistence without logging or exporting private content. Move the original files into the private rollback area only after startup succeeds; stage a Git deletion of the tracked JSON path only after the working copy is safely outside the checkout.
4. Add and verify a staging/CI guard so future source commits cannot include `server/data.json`, local databases, or secrets. `.gitignore` alone does not untrack an already tracked file.
5. A normal, non-rewriting commit can remove the path from the latest branch tree. This does not sanitize any existing public commit. Do not rewrite refs or force-push without a separate explicit authorization; do not change repository visibility.
6. Ask GitHub support about cached views where appropriate. Inform collaborators that existing clones and downloads require separate handling; repository changes cannot erase those copies.

## Render persistence gate

No production deployment should happen until an authorized operator can verify in Render that:

- A persistent disk is attached to the correct service and mounted at the declared absolute root.
- `MINECORD_PERSISTENT_DATA_DIR` names that root and `DATABASE_URL` resolves to a SQLite file contained within it.
- The current production database has a verified backup before any restart, path change, migration, or deploy.
- A staging restart/redeploy test with an isolated database proves persistence; production data is not used for the test.

The application startup guard checks declared paths but cannot prove Render actually mounted the disk. Render dashboard access and confirmation of the current database location/backup are external operator requirements.

## Current status

Owner decision: keep repository public. Private migration is authorized; history rewriting is not. Source credential classification and rotation remain an owner/operator task because contents must not be exposed in this handoff. No Render disk or production database has been verified.
