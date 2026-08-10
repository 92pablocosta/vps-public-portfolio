# Lessons Learned

Each item below came from something that actually happened in this project, not
from a best-practices list.

---

## 1. Configuration on disk is a hypothesis. Effective state is the evidence.

The base SSH config said `PermitRootLogin yes`. A drop-in said `no`. Parsing
order says the drop-in wins. `sudo sshd -T` says `permitrootlogin no` — and only
that last one is evidence.

The generalization is bigger than SSH: a firewall's defaults file is not its
ruleset, a Compose file is not a running container, and a sysctl drop-in is not
the live kernel parameter. Every layer has a "what I wrote" and a "what is in
force", and they diverge quietly.

**Practice:** for anything that matters, find the command that asks the system
what it is actually doing, and prefer it to reading the file.

## 2. An audit without privilege must report what it could not see.

An unprivileged audit pass was denied Docker, the stack directory, and the named
volumes. It could easily have reported what it *did* see and stopped there —
which would have produced a document that looked complete and was not.

Instead it named the gaps. That list is exactly what made the later privileged
pass targeted and short.

**Practice:** treat "I could not verify X" as a first-class finding. An audit
that hides its boundary is worse than one with a small scope, because the reader
cannot tell the difference between "checked and fine" and "not checked".

## 3. Two sources disagreeing usually means they measured different things.

An audit saw `302 → /dashboard`. An earlier record expected a final `200`. The
instinct was to declare one of them stale.

Neither was wrong. One followed redirects, the other did not. The reconciliation
also produced the more useful finding: the monitor is only correct while it
follows redirects, and a "200-only, don't follow" configuration would generate
permanent false alarms against a perfectly healthy service.

**Practice:** before correcting a contradiction, check whether the two
observations used the same method. The reconciliation often contains a
dependency worth documenting.

## 4. Anomalies deserve investigation, not reflex.

Two loopback listeners nobody could account for. IP forwarding enabled on a
non-router host with no config file setting it. Both looked like findings. Both
were benign.

The failure modes on either side are equally bad: escalating benign noise
destroys the signal, and waving it away means the one real incident gets waved
away too.

**Practice:** identify, classify, record the evidence, and move on. And when the
conclusion rests on correlation rather than proof — as with `ip_forward` and the
Docker chains — say **inference**, not fact.

## 5. Backups are about restores, and storage engines have opinions.

Both application databases run SQLite in WAL mode, with write-ahead logs
*larger than the databases themselves*. A file copy of the `.db` alone during
writes would have omitted most of the live state — and it would have succeeded
silently, produced a plausibly-sized file, and failed only at restore.

The mirror-image trap was also present: other WAL files were 0 bytes at
inspection. Building a design around that observation would work until the first
busy moment.

**Practice:** know how your database actually persists data before you design a
backup for it. And never let "the copy succeeded" stand in for "the restore
works".

## 6. Find the recovery-blocking dependency before the recovery.

The automation platform's stored credentials are encrypted with a key in a small
config file inside its volume — not an environment variable, not in the Compose
file. Restore the database without it and you get every workflow intact and
every credential undecryptable, with no error at startup.

That was found during a pre-implementation inventory. The same discovery during
an outage is an unrecoverable outage.

**Practice:** inventory state *before* designing the backup, and specifically
hunt for the small files that unlock the big ones.

## 7. Git and backups are not the same thing, and neither restores alone.

Git holds the reproducible half: Compose, units, hardening, patches, runbooks.
The encrypted backup holds the irreproducible half: databases, volumes,
encryption material, secrets. A rebuild from Git alone comes back empty; a
restore from backup alone has data and nowhere to put it.

**Practice:** classify every artefact as reproducible or not, and make sure each
class has an owner. "It's all in the repo" is the most confident version of this
mistake.

## 8. An environment that cannot reproduce its own patches is not reproducible.

The host-native agent carries a local source modification. Rebuilding from the
upstream commit alone yields subtly different behaviour, discoverable only under
the exact conditions the patch exists for.

Preserving it meant: storing the reviewed diff, recording the base commit,
recording and verifying a SHA-256 — and being precise that the digest proves
**file integrity only**, not that the patch applies cleanly or behaves
correctly. Those remain restore-test acceptance criteria.

**Practice:** treat local modifications as first-class recovery artefacts, and
be exact about what your verification actually establishes.

## 9. Least privilege applies to AI agents, and it is cheap up front.

No passwordless sudo. Admin user out of the `docker` group. The agent with no
sudo, no docker group, no socket access, and no copied SSH keys. Each of these
cost minutes to set up and would cost a rebuild to retrofit after an incident.

The `docker` group deserves its own mention: it is the single most commonly
recommended "fix" for Docker permission errors, and it is functionally
passwordless root. Declining it costs five characters per command.

**Practice:** bound an agent's blast radius with Unix permissions, not with
instructions. Model behaviour is a distribution; file permissions are not.

## 10. Test the alert, not the alert configuration.

Stopping the landing container on purpose — and watching detection, notification,
delivery, restart, and recovery notification all actually happen — validated
something no amount of configuration review could.

A monitor that has never fired is an untested monitor, and the most common way
monitoring fails is not detection but delivery.

**Practice:** deliberately break something, on purpose, on a schedule.

## 11. Monitoring that shares a host with its subject has a blind spot.

Uptime Kuma cannot alert on its own outage or on total host loss. This is
structural, not a configuration mistake.

**Practice:** name the blind spot in the monitoring documentation. An
undocumented gap becomes an assumed capability, and assumed capabilities fail
exactly when they are needed.

## 12. Write down the finish line before you approach it.

"Not complete until a real restore test" was recorded before the backup system
was designed. Because of that, backups are still labelled **planned** and DR is
still labelled **skeleton** in this repository — rather than quietly rounded up
to "done" once the scripts existed.

**Practice:** define the acceptance criterion while the work is still abstract,
when there is no pressure to be generous with yourself.

## 13. Model output is a hypothesis.

Assistants contributed most of the investigation, drafting, and documentation in
this project, and were wrong or imprecise often enough that the verification step
earned its place several times over.

**Practice:** let the assistant generate, and let the system decide. Speed and
coverage from the model; the definition of proof from the human.
