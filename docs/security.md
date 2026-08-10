# Security Model

How the environment is protected, and — more importantly — how each control was
*verified* rather than assumed.

> Sanitized. No hostnames, addresses, usernames, ports beyond the public three,
> file contents of secret-bearing scripts, or production paths.

---

## 1. Principles

1. **Smallest defensible perimeter.** Three public TCP ports. Everything else is
   dropped by default.
2. **Configuration is a hypothesis; effective state is evidence.** Every control
   below was confirmed against the running system, or is explicitly marked as
   unverified.
3. **Least privilege, enforced at the Unix layer.** Not by policy documents, and
   not by trusting a process to behave.
4. **Secrets never enter Git.** Not sanitized, not "temporarily", not as sample
   data.
5. **An anomaly is a question, not a verdict.** Several findings looked alarming
   and turned out benign — but only investigation could establish that.

## 2. Perimeter

- Provider-level firewall in front of the host, in addition to the host
  firewall. Two independent filters, so a misconfiguration in one is not
  automatically an exposure.
- UFW with `DEFAULT_INPUT_POLICY="DROP"` and `DEFAULT_FORWARD_POLICY="DROP"`,
  outbound permitted, `IPV6=yes` so the second address family is governed rather
  than ignored.
- Exactly three inbound services: SSH, HTTP, HTTPS.

**Verification limit recorded honestly:** the UFW *defaults* file states policy
only. It does not prove which allow rules exist, and it does not capture
Docker-managed packet filtering. Capturing a sanitized **effective** ruleset
remains an open item.

Example: [`../examples/host/ufw-defaults.example`](../examples/host/ufw-defaults.example)

## 3. SSH

Hardening applied through a drop-in rather than by editing the distribution's
base file, so the change is reviewable and survives package updates:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
```

Plus a Fail2ban jail for SSH.

### The contradiction, and how it was settled

The distribution's base `sshd_config` contained a **late** `PermitRootLogin yes`
while the `Include`d drop-in set `PermitRootLogin no`. OpenSSH uses the *first*
obtained value for such keywords, and the `Include` appears near the top — so
the drop-in should win.

"Should win" is a claim about parsing, not evidence. It was resolved by reading
the daemon's own view:

```bash
sudo sshd -t                              # syntax check BEFORE any reload
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|logingracetime) '
sudo systemctl reload ssh                 # only after both checks pass
```

Result: `permitrootlogin no`. The intended policy was in force.

Two habits came out of this:

- **Never reload a daemon whose syntax you have not checked**, on a host whose
  only access path is that daemon. `sshd -t` before `systemctl reload` is the
  difference between a config error and a lockout.
- **Always keep a second authenticated session open** while changing SSH.

An outstanding review item from the same audit: the base file explicitly enables
`X11Forwarding`, which has no use on this host and should be disabled.

Example: [`../examples/host/sshd-hardening.example.conf`](../examples/host/sshd-hardening.example.conf)

## 4. Host controls

Confirmed **enabled and active** by direct inspection, not by installation
records:

| Control | Purpose |
| --- | --- |
| UFW | Packet filtering, default deny inbound/forward |
| Fail2ban | Brute-force mitigation on SSH |
| AppArmor | Mandatory access control profiles, module confirmed loaded |
| auditd | Kernel-level audit trail |
| journald | Bounded retention: size caps, 7-day retention, daily rotation, compression |
| unattended-upgrades | Automatic security patching, periodic lists update enabled |

Runtime sysctl state observed directly rather than inferred from files:

- reverse-path filtering enabled;
- TCP syncookies enabled;
- ICMP redirects neither accepted nor sent (this host is not a router);
- kernel pointer restriction and `dmesg` restriction enabled;
- hardlink and symlink protection enabled;
- ASLR enabled.

Examples:
[`../examples/host/sysctl-network-hardening.example.conf`](../examples/host/sysctl-network-hardening.example.conf),
[`../examples/host/journald.example.conf`](../examples/host/journald.example.conf)

## 5. Privilege design

| Subject | Privilege | Reason |
| --- | --- | --- |
| Admin user | `sudo` **with password**, no `NOPASSWD` | Every privileged action is a conscious act with an audit trail |
| Admin user | **not** in the `docker` group | Docker group membership is effectively passwordless root; `sudo docker …` keeps the prompt |
| Agent user | No sudo, no docker group, no docker socket, no copied SSH keys | Blast radius bounded by Unix permissions, not by the agent's judgement |
| Traefik | Docker socket mounted **read-only** | Needs container metadata only. Read-only limits — but does not eliminate — the exposure; socket access remains privileged |
| Containers | `no-new-privileges:true` on edge containers | Standard privilege-escalation containment |

### On the `docker` group

Adding a user to `docker` is frequently recommended as a convenience fix for
permission errors. It grants the ability to start a container mounting the host
root filesystem, which is root access without a password prompt. Keeping the
admin user out of the group costs a few keystrokes per command and removes an
entire silent-escalation path. This was an explicit decision, re-affirmed rather
than drifted into.

### On AI agents

An AI agent running with root is not an agent — it is an unbounded process
acting on probabilistic output. Constraining it at the Unix layer is cheap,
verifiable, and independent of how well the model behaves on any given day.
See [`ai-assisted-engineering.md`](ai-assisted-engineering.md).

## 6. Anomalies investigated

Two findings that looked like incidents and were not. Both are recorded here
because the *method* is the point.

### Unknown loopback listeners

An audit surfaced two listeners on `127.0.0.1` — one TCP, one UDP — that were
not accounted for by any documented service. They were traced to their owning
processes and classified:

```text
EXPECTED / BENIGN / LOCALHOST-ONLY
```

Neither was reachable from outside the host. The correct outcome was neither
"probably fine" nor "possible compromise" — it was identification, followed by
a written classification with the evidence attached.

### `net.ipv4.ip_forward=1`

IP forwarding was enabled at runtime, which on a non-router host is worth a
second look. No assignment existed in `/etc/sysctl.conf`, `/etc/sysctl.d/`,
`/usr/lib/sysctl.d/`, or `/lib/sysctl.d/`.

Correlation with the live Docker iptables chains — the Docker-managed chains
present, IPv4 `FORWARD` policy `DROP`, and counters showing live traffic through
those chains — supported the conclusion that this is runtime state set and
managed by Docker bridge networking.

It was recorded as an **inference, not a fact**, because no persistence file
proves ownership. The operational decisions were: do not change it, and do not
add a duplicate persistent sysctl entry to "document" something Docker manages
itself. A comment that misstates ownership is worse than no comment.

### IPv6

Audited separately from IPv4 rather than assumed to follow it. All Docker
networks reported IPv6 disabled and the shared proxy network was confirmed
IPv4-only. Dual-stack hosts routinely have a firewall posture in one family that
does not match the other; the only way to know is to check both.

## 7. Secret handling

Material classified as secret-bearing and therefore **never** committed:

- environment files, credential files, and agent config/auth files;
- the ACME store and any private key material;
- the monitoring heartbeat script — it embeds a push URL that is itself a
  credential. It is held at restrictive ownership and mode, and its contents
  were deliberately **left unread** during audits. Only a placeholder template
  is documented;
- SQLite databases and Docker volume contents;
- Restic repository password and object-storage credentials (planned system).

Repository rules, applied to both the private ops repo and this public one:

1. Sanitize before a file enters the repository; replace real values with named
   placeholders such as `${SECRET_NAME}`.
2. Never use a real credential as sample data, even temporarily.
3. Review `git diff` and `git diff --cached` before every commit.
4. Run a secret scan before staging; if a candidate cannot be proven safe,
   **stop** and report only the file and line — never the value.
5. Treat `.gitignore` as accident reduction, not as a security control.

Example scanner:
[`../examples/scripts/secret-scan.example.sh`](../examples/scripts/secret-scan.example.sh)

### If a secret is ever committed

1. Stop staging; do not push.
2. Report file and line only.
3. Identify the owner and exposure scope through a secure channel.
4. **Rotate or revoke first.** History rewriting is cleanup, not remediation —
   assume anything pushed is already captured.
5. Remove from working tree and history.
6. Document the incident without reproducing the value.

## 8. Known gaps

Stated rather than omitted:

- Effective UFW ruleset not yet captured in sanitized form.
- Fail2ban jail configuration, auditd ruleset, and unattended-upgrades policy
  confirmed *active* but not yet reviewed in detail.
- `X11Forwarding` still enabled in the base SSH config; should be disabled.
- Image tags not yet resolved to immutable digests.
- No automated secret scanning in CI yet (currently a pre-commit step).
- Monitoring cannot observe its own outage — see [`monitoring.md`](monitoring.md).
