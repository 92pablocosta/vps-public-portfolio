# Diagrams

Mermaid source, rendered inline by GitHub. Sanitized: no hostnames, addresses,
or production paths.

---

## 1. System architecture

```mermaid
flowchart TB
    net["Internet"]

    subgraph edge["Perimeter"]
        pfw["Provider firewall"]
        ufw["UFW<br/>default deny inbound + forward<br/>allow 22 / 80 / 443"]
    end

    ssh["OpenSSH<br/>key-only auth · Fail2ban"]

    subgraph host["Ubuntu Server VPS (single node)"]
        subgraph dock["Docker"]
            tr["Traefik v3<br/>TLS termination · ACME<br/>host 80/443 → published"]
            subgraph proxynet["Docker network: proxy — internal, IPv4-only"]
                land["nginx<br/>landing page"]
                n8n["n8n<br/>SQLite + encryption key"]
                kuma["Uptime Kuma<br/>SQLite"]
            end
        end

        subgraph sysd["systemd — host-native"]
            agent["Agent<br/>dedicated user<br/>no sudo · no docker socket<br/>no declared listener"]
            timer["heartbeat timer<br/>every 60s"]
        end
    end

    net --> pfw --> ufw
    ufw -- "22/tcp" --> ssh
    ufw -- "80/443 tcp" --> tr
    tr --> land
    tr --> n8n
    tr --> kuma
    timer --> agent
    timer -. "push only while<br/>gateway is active" .-> kuma
```

## 2. Request path

```mermaid
sequenceDiagram
    participant U as User
    participant F as Firewall (provider + UFW)
    participant T as Traefik
    participant A as Application container

    U->>F: HTTPS to ${DOMAIN}:443
    F->>T: allowed (443 open)
    Note over T: TLS termination<br/>ACME certificate
    T->>T: match Host rule from container labels
    T->>A: HTTP over the internal proxy network
    A-->>T: response
    T-->>U: HTTPS response

    Note over U,F: Plain HTTP on :80 is answered<br/>with a permanent redirect to HTTPS<br/>(and serves the ACME challenge)
    Note over F,A: The application publishes no host port.<br/>It is unreachable except through Traefik.
```

## 3. Trust boundaries and privilege

```mermaid
flowchart TB
    internet["Internet — untrusted"]

    subgraph perim["Perimeter — packet filtering only"]
        fw["Provider firewall + UFW"]
    end

    subgraph edgeb["Edge — terminates TLS, sees plaintext"]
        traefik["Traefik"]
    end

    subgraph appb["Application — no host exposure"]
        apps["nginx · n8n · Uptime Kuma"]
    end

    subgraph hostb["Host — privileged"]
        docker["Docker daemon<br/>root-equivalent"]
        admin["Admin user<br/>sudo WITH password<br/>NOT in docker group"]
        agent["Agent user<br/>no sudo · no docker group<br/>no socket · no copied SSH keys"]
    end

    internet --> fw --> traefik --> apps
    traefik -. "read-only socket mount<br/>(container metadata only)" .-> docker
    admin -. "interactive sudo,<br/>per action" .-> docker
    agent -. "no path exists" .-x docker
```

## 4. Monitoring signals

```mermaid
flowchart LR
    subgraph pull["Pull — HTTP checks"]
        kuma["Uptime Kuma"]
        kuma --> c1["landing page → 200"]
        kuma --> c2["n8n readiness → 200"]
        kuma --> c3["monitoring UI<br/>follow redirects → final 200"]
    end

    subgraph pushp["Push — heartbeat"]
        t["systemd timer (60s)"] --> o["oneshot unit"]
        o --> q{"gateway active?"}
        q -- yes --> p["push"]
        q -- no --> miss["no push"]
    end

    p --> kuma
    miss -. "missing heartbeat<br/>→ incident" .-> kuma
    kuma --> alert["Chat alert<br/>dedicated bot,<br/>separate from the agent's bot"]

    blind["Blind spot: monitoring shares the host it watches.<br/>It cannot alert on its own outage or on total host loss."]
    kuma -.-> blind
```

## 5. Backup pipeline — *operational and restore-validated*

```mermaid
flowchart LR
    live["Live SQLite<br/>WAL mode, application writing"]
    snap["Application-consistent<br/>snapshot"]
    stage["Staging<br/>restrictive perms<br/>bounded lifetime"]
    restic["Restic<br/>encrypted · deduplicated"]
    b2["Backblaze B2<br/>off-site"]
    verify["Verify<br/>6/6 databases · integrity · retention"]
    clean["Remove staging<br/>only after verification"]

    live --> snap --> stage --> restic --> b2
    b2 --> verify --> clean

    restore["Real off-site restore<br/>6/6 databases verified"]
    b2 --> restore

    warn["A plain copy of the .db during writes<br/>can omit most of the live state<br/>— the WAL was larger than the database."]
    live -.-> warn
```

## 6. Disaster Recovery — two halves

```mermaid
flowchart TB
    loss["Host loss"]

    subgraph g["Reproducible — Git"]
        g1["Compose · proxy config"]
        g2["systemd units · host hardening"]
        g3["Local patches, pinned"]
        g4["Runbooks"]
    end

    subgraph b["Irreproducible — encrypted backup"]
        b1["SQLite databases"]
        b2["Volume contents"]
        b3["Credential encryption material"]
        b4["Secrets · ACME state"]
    end

    loss --> g
    loss --> b
    g --> shape["Correct shape,<br/>no data"]
    b --> data["Data,<br/>nowhere to put it"]
    shape --> ok["Recovered service"]
    data --> ok

    gate["Validation gate:<br/>NOT complete until a real restore test<br/>on an isolated host, with recorded<br/>timings, evidence, and gaps."]
    ok -.-> gate
```

## 7. AI-assisted engineering loop

```mermaid
flowchart LR
    h["Human<br/>goal · constraints · risk tolerance"] --> ai["AI assistant<br/>investigate · draft commands<br/>review config · flag risk"]
    ai --> prop["Proposal<br/>inspection or change"]
    prop --> gate{"Human review<br/>Necessary?<br/>Reversible?<br/>What breaks?<br/>Rollback?"}
    gate -- "rejected / revised" --> ai
    gate -- "approved" --> sys["System<br/>privileged steps run manually<br/>via interactive sudo"]
    sys --> ver["Verification<br/>against real system state"]
    ver -- "contradicts the model" --> ai
    ver --> doc["Documentation<br/>evidence · decisions · open TODOs"]
    doc --> h
```

## 8. Change lifecycle

```mermaid
stateDiagram-v2
    [*] --> Inspect
    Inspect --> Plan: current state, provenance, risk established
    Plan --> Change: intent, validation, rollback, approval defined
    Change --> Verify: smallest reviewable change applied
    Verify --> Document: effective state and behaviour confirmed
    Verify --> Plan: result contradicts expectation
    Document --> [*]

    note right of Inspect
        Read-only. No changes.
    end note
    note right of Verify
        Check effective state,
        not intended state.
    end note
    note right of Document
        Includes what could NOT
        be verified.
    end note
```
