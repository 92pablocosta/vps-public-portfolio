#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# EXAMPLE — sanitized, educational. NOT the production script.
#
# The real script is secret-bearing: it embeds a monitoring push URL, which is
# itself a credential. It is root-owned, mode 0750, excluded from version
# control, and its contents were deliberately left unread during audits.
# Only this placeholder template is published.
#
# Purpose: report liveness for a host-native service that exposes no HTTP
# endpoint, so an external prober has nothing to probe.
#
# Install:  /usr/local/bin/agent-uptime-push.sh   (root:root, chmod 0750)
# Invoked:  by agent-uptime-push.service, driven by agent-uptime-push.timer
# -----------------------------------------------------------------------------
set -euo pipefail

SERVICE="agent-gateway.service"

# Supply this OUTSIDE this file in a real deployment — a root-owned 0600
# environment file read via EnvironmentFile=, or a secret store. Embedding the
# URL in the script is what forces the script itself to be treated as a secret.
PUSH_URL="${PUSH_URL:?PUSH_URL must be provided by the environment}"

# ---- The whole point of this script -----------------------------------------
# Push ONLY when the service is genuinely active.
#
# A heartbeat that fires unconditionally from a timer proves the timer works,
# not that the service works — it monitors itself. Gating the push on the real
# service state is what makes the ABSENCE of a heartbeat meaningful, which is
# the signal the monitor actually alerts on.
# -----------------------------------------------------------------------------
if ! systemctl is-active --quiet "${SERVICE}"; then
    # Deliberately silent: no push. The monitor's missed-heartbeat window fires
    # the incident. Exit 0 so systemd records a clean run of the check itself —
    # "the service is down" is a valid result, not a failure of the checker.
    exit 0
fi

# --fail       : non-2xx becomes a non-zero exit, so the unit reports failure
# --silent     : no progress noise in the journal
# --show-error : but do show real errors
# --max-time   : never let a hung request outlive the timer interval
curl --fail --silent --show-error --max-time 10 "${PUSH_URL}" > /dev/null

# Note: the URL must never be echoed, logged, or included in error output.
# `set -x` in this script would leak it into the journal.
