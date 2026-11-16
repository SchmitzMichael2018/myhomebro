# Public planning client identity and admission

## PythonAnywhere trust contract

[PythonAnywhere's client-IP documentation](https://help.pythonanywhere.com/pages/WebAppClientIPAddresses/)
states that `REMOTE_ADDR` identifies its load balancer. Its edge sets `X-Real-IP`
to the peer from which it received the request. Only the final item of
`X-Forwarded-For` is guaranteed; earlier items may be attacker-controlled.

The public planner therefore supports two explicit modes:

- `PUBLIC_PLANNING_CLIENT_IP_SOURCE=direct` (default): use canonical
  `REMOTE_ADDR` and ignore all client-IP headers.
- `PUBLIC_PLANNING_CLIENT_IP_SOURCE=pythonanywhere`: use a strictly validated,
  single `X-Real-IP`. If `X-Forwarded-For` is present, its final address must
  canonicalize to the same value. Earlier entries and other identity headers
  are ignored. Missing, malformed, scoped, duplicated, or inconsistent trusted
  values stop planning with a generic 503 before allocating slots or invoking AI.

IPv6 addresses are canonicalized. IPv4-mapped IPv6 uses the same bucket as IPv4.
No mode is inferred from Host, request headers, or private network ranges.

## Required deployment verification

PythonAnywhere mode must never be enabled on an origin reachable directly by
untrusted callers or behind an arbitrary header-preserving proxy. The setting
is a hosting-specific trust assertion, not an automatic proof of topology.

Before enabling it, the deployment operator must verify:

1. Every public route to this app passes through PythonAnywhere's controlled
   edge; there is no separate direct origin route to the WSGI app.
2. The edge overwrites incoming `X-Real-IP` and appends its inbound peer as the
   final `X-Forwarded-For` value, as documented. Caller-supplied identity headers
   cannot become the trusted value. Validate using a permitted staging/diagnostic
   path, not the paid production planning endpoint or exposed debug settings.
3. Any additional CDN/proxy is understood. PythonAnywhere identifies that
   upstream peer; this implementation does not trust CDN headers or walk farther
   back through the chain. Clients sharing that peer may share a quota.

Only after these checks, configure both values in the shared deployment
environment used by all WSGI workers:

```dotenv
PUBLIC_PLANNING_CLIENT_IP_SOURCE=pythonanywhere
PUBLIC_PLANNING_PYTHONANYWHERE_INGRESS_VERIFIED=true
```

`manage.py check` reports `core.E131` for an unsupported mode and `core.E132`
when PythonAnywhere mode lacks the explicit verification flag. Runtime resolution
also fails closed. The flag records the operator's verification; it cannot make
an incorrectly exposed origin safe. Changing settings or topology requires a
fresh review. No production configuration is changed by this code change.

## Shared SQLite admission

Migration `0333_public_improvement_plan_slot` must exist before updated workers
serve previews. Six keyed slots per canonical client enforce a rolling-hour
quota across workers through unique inserts and conditional updates. Metadata
contains only keyed hashes and expiry timestamps, not answers or plan content.
Missing or unavailable storage fails closed before provider use.

SQLite tests use a real shared file, DELETE journal mode, a 20-second busy
timeout, independent connections, and synchronized competing snapshots. Cover
first claims, expired-slot reuse, initial bursts, and PythonAnywhere clients.
These operations use ordinary primary-key constraints and conditional UPDATEs;
no SQLite-version-specific UPSERT or RETURNING feature is required. Record the
SQLite version actually tested separately from production's version.

The preview view explicitly opts out of `ATOMIC_REQUESTS`, even when enabled
globally. Only short admission writes are atomic: slots commit before provider
invocation, SQLite write locks are not held during network calls, and a provider
interruption cannot refund a counted attempt. Preserve and revalidate this
boundary when changing middleware or transaction policy. A lock timeout denies
the attempt with 503 rather than allowing an unaccounted provider call.
