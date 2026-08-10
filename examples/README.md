# Examples

**Sanitized, educational reconstructions. Not production files.**

Every file here uses `${PLACEHOLDER}` values and generic account names and
paths. None of them is a copy of a deployed file, and none contains a hostname,
IP address, email address, token, push URL, key, or real path.

They are published to show *reasoning*, which is why the comments are longer
than the configuration. Copying them without understanding the comments is not
the intended use.

## Contents

| Path | What it demonstrates |
| --- | --- |
| `docker/traefik-compose.example.yaml` | The only stack that publishes host ports; read-only socket mount and its honest limits |
| `docker/traefik-static.example.yaml` | `exposedByDefault: false`, dashboard not insecure, HTTP→HTTPS redirect, ACME; and the placeholder-rendering caveat |
| `docker/n8n-compose.example.yaml` | No host port; the credential-encryption-key dependency that breaks naive restores |
| `docker/uptime-kuma-compose.example.yaml` | No host port; WAL-mode backup caveat; the follow-redirects monitor dependency |
| `docker/landing-compose.example.yaml` | Read-only document root; the stack used for the deliberate failure test |
| `systemd/agent-gateway.example.service` | Least privilege for a host-native agent, enforced by the OS; restart semantics |
| `systemd/agent-gateway-umask.example.conf` | Drop-in overrides instead of editing vendor units |
| `systemd/agent-uptime-push.example.timer` | `AccuracySec` and `Persistent` for a 60-second heartbeat |
| `systemd/agent-uptime-push.example.service` | Oneshot semantics; why `inactive (dead)` is correct |
| `scripts/uptime-push.example.sh` | Gating the heartbeat on real service state, so silence means something |
| `scripts/secret-scan.example.sh` | Pre-commit scanning that reports file and line but never the value |
| `host/sshd-hardening.example.conf` | Drop-in hardening, and the `sshd -t` / `sshd -T` verification that settled a real contradiction |
| `host/ufw-defaults.example` | Default policy ≠ ruleset; explicit IPv6 handling |
| `host/sysctl-network-hardening.example.conf` | Only declaring what was verified; why `ip_forward` is deliberately absent |
| `host/journald.example.conf` | Bounded retention as an availability control, with the trade-off named |

## Deploying anything from here

Don't, directly. These files omit the deployment-time rendering of placeholders
by design, and validating that rendering step is an open item in the real
project. Read them, take the reasoning, and write your own.
