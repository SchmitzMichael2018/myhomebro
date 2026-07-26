# Capture Reopen Design Notes

Phase B.4 does not implement reopening. A future phase may introduce the following explicit workflow:

`Approved → Reopen → Clone approved snapshot → Review → Approve → Apply`

## Safety contract

- Reopen must be an explicit, permission-checked action available only before or through a separately defined post-application correction policy.
- The immutable approved snapshot and any successful application receipt remain unchanged.
- Reopen creates a new editable review revision by cloning the approved snapshot; it never edits the approved snapshot in place.
- The new revision records its source Capture version, actor, time, and reason.
- Approval creates another immutable snapshot with a new version.
- Application continues through preview, confirmation, adapters, idempotency, atomicity, and receipt rules.
- Existing created business records are not silently updated, deleted, merged, or reversed.
- The UI must distinguish the historical approved revision from the current reopened review and explain whether a prior application exists.

## Required future design work

- Define whether applied Captures can reopen and what correction workflow owns already-created records.
- Define revision storage and lifecycle transitions without weakening append-only events.
- Define permissions, concurrency behavior, stale-version recovery, and audit copy.
- Add migration, API, accessibility, mobile, rollback, and regression plans before implementation.
