# Backup Strategy

> **Status: design complete, implementation in progress.**
> Restic + Backblaze B2 is **planned and not yet implemented**. No restore has
> been tested. Current protection is provider-side snapshots only.

---

## 1. Design

```mermaid
flowchart LR
    live["Live SQLite<br/>(application writing)"]
    snap["Application-consistent<br/>snapshot"]
    stage["Staging directory<br/>restrictive perms<br/>bounded lifetime"]
    restic["Restic<br/>encrypted · deduplicated · versioned"]
    b2["Backblaze B2<br/>off-site object storage"]

    live --> snap --> stage --> restic --> b2

    verify["Verify: snapshot exists<br/>integrity check<br/>retention applied"]
    restic -.-> verify
    cleanup["Remove staging<br/>after verified success"]
    verify -.-> cleanup
```

Each arrow exists for a reason:

- **live → snapshot** — because copying a live database is not backing it up
  (§3).
- **snapshot → staging** — so the encryption/upload step reads a file nobody is
  writing to, with a bounded window and restrictive permissions.
- **staging → Restic** — encryption happens *before* the data leaves the host,
  so the storage provider never holds plaintext.
- **Restic → B2** — off-site, because a backup on the same host does not survive
  the failure it exists for.
- **verify → cleanup** — staging is removed only after verification, never
  before.

## 2. Data classification

Backups are designed by category, not by directory listing, because the
categories have genuinely different requirements.

### Critical mutable data

Application state that cannot be recreated from source configuration: the
SQLite databases and volume contents for the automation platform, the
monitoring platform, and the host-native agent.

Requirements: consistent capture, defined retention, integrity checks, and a
**tested** restore.

### Secret-bearing recovery material

Credentials and keys required to restore service — including the material that
decrypts other backed-up data. Backed up through a separately controlled,
encrypted process. **Never in Git**, sanitized or otherwise.

Includes agent configuration and auth files, environment files, the ACME store,
and the monitoring heartbeat script (whose embedded push URL is itself a
credential).

Open question, recorded rather than glossed: **custody**. A backup whose only
key lives inside the backup is not a recovery plan. Where the repository
password and object-storage credentials are held off-host is undecided.

### Reproducible configuration

Compose files, proxy config, systemd units, host hardening. Belongs in Git, with
secret values as placeholders. Does not belong in the backup — duplicating it
there creates two sources of truth that will drift.

### Operational documentation

Architecture records, decisions, inventories, runbooks. Git, and evolving with
the system rather than written once.

### Disposable / runtime data

Logs, caches, temporary files, dependency directories, container layers.
Excluded by default. Diagnostic-retention exceptions must be argued for
individually, not assumed.

## 3. Why naïve SQLite copies are unsafe

This is the technical core of the design, and it is not hypothetical here.

SQLite in **write-ahead logging (WAL)** mode does not write committed
transactions straight into the main `.db` file. Commits land in a `-wal` file
and are folded back into the database at checkpoints; a `-shm` file holds the
shared index that makes the WAL readable. Consequently:

- a copy of only `.db` taken during writes can be **stale by the entire contents
  of the WAL**;
- a copy of `.db`, `-wal`, and `-shm` taken non-atomically can be **internally
  inconsistent** — three files from three different instants;
- either can be **unusable** rather than merely old.

Inspection of the running system made the scale concrete:

| Database | `-wal` size relative to main DB |
| --- | --- |
| Automation platform | WAL **≈ 3× larger** than the database |
| Monitoring platform | WAL **larger** than the database |
| Agent state stores | WAL **0 bytes at the moment of inspection** |

The first two mean a naïve `.db` copy would not lose a little recent state — it
would omit **most** of the live state.

The third row is the more dangerous one. Observing an empty WAL **once** proves
nothing about the next run. A backup design that quietly relies on "the WAL is
usually empty" works perfectly until the first busy moment, which is exactly the
moment worth backing up. The recorded rule is explicit: **do not assume WAL
files are always empty.**

The correct approach is an application-aware consistency mechanism (SQLite's own
online backup / `VACUUM INTO`, or an application-supported export), chosen and
tested **per application** against what that application actually supports.
That selection is **in progress** and is a prerequisite for calling the backup
implemented.

## 4. The encryption-key dependency

The single highest-value finding of the audit work:

> The automation platform's stored credentials are encrypted with a key held in
> a small config file inside its data volume — **not** in an environment
> variable, and not anywhere in the Compose configuration.

Consequences:

- a backup containing the database but not that file restores every workflow
  intact and **every stored credential undecryptable**;
- the failure is silent at restore time. The service starts, the workflows are
  there, and the breakage only surfaces when a workflow tries to authenticate;
- the file is small enough to be overlooked by any inventory built from file
  sizes or "important-looking" names.

This was found during a **pre-implementation inventory**, not during a recovery.
That timing is the whole argument for auditing state before designing a backup:
the same discovery made during an outage is an unrecoverable outage.

Handling constraint: the key must never be printed, logged, or echoed — during
backup, restore, or the restore *test*. How to verify a restored key works
without ever displaying it is an explicit open item.

## 5. Inventory

A privileged, read-only inventory pass produced a path-level list of everything
that must survive host loss, with each path classified by recovery value. It is
marked **complete for the current plan** — not complete in the absolute sense.

Its own recorded limits:

- which sysctl drop-ins are operator-authored versus OS defaults is not fully
  separated;
- whether one stray proxy config backup file is needed is undetermined;
- whether the landing-page content has an off-host source of record is
  unconfirmed;
- off-host custody of the backup credentials is undecided.

The inventory has a **re-run trigger**: any new stack, volume change, or custom
systemd unit invalidates it. An inventory without a trigger becomes fiction on
the first change nobody thought to record.

Notably, this pass closed gaps that an earlier **unprivileged** audit had
explicitly flagged as unverifiable — it had been denied access to Docker, the
stack directory, and the named volumes, and said so. Naming the gaps rather than
guessing at them is what made the later pass targeted.

## 6. Remaining work

| Item | Status |
| --- | --- |
| Choose and test a consistency mechanism per SQLite consumer | **In progress** |
| Restic repository layout and B2 bucket policy | **Planned** |
| Scheduling, locking, retry, and failure alerting | **Planned** |
| Retention and pruning policy | **Planned** |
| Integrity checks and restore-test cadence | **Planned** |
| RTO / RPO targets | **Undefined** |
| Off-host custody of repository password and B2 credentials | **Undecided** |
| Verify the restored encryption key without printing it | **Open** |
| **A real restore test** | **Not performed** |

## 7. Non-negotiables

- Never expose repository or storage credentials in Git, command output, logs,
  or documentation.
- Never overwrite live data without a verified rollback copy and explicit
  approval.
- Never infer SQLite consistency from a successful file copy — a copy that
  completes without error tells you nothing about whether the result opens.
- **A backup system is not complete until a restore has been tested.** Until
  then it is an unproven hypothesis with a cron schedule.
