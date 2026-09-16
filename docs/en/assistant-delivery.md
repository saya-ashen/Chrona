# Assistant result delivery: reuse decision

Status: source-based comparison and recommendation; no adapter installed,
configured, or verified against a real recipient. This document supports phase 0
of the [personal-assistant plan](proactive-personal-assistant-plan.md).

## Recommendation

For the first phone/browser-push pilot, prototype a **thin ntfy HTTP integration**
rather than implementing notification clients, mobile push, subscriptions, or a
message service in Chrona. Prefer a user-approved existing instance/account.
This is an engineering recommendation, not authorization to deploy ntfy or send
messages, and the user's preferred delivery channel is still unconfirmed.

If the user prefers an existing email/chat destination, evaluate **Apprise** first
instead of making them adopt a new push application. If **Gotify is already in
use**, reuse it rather than adding ntfy solely for Chrona. These branches depend
on the actual recipient device, privacy requirements, and existing setup.

Do not integrate all three now. Select one after an explicitly approved prototype
and recipient test. Existing public documentation is not runtime certification.

## Comparison

Documentation reviewed on 2026-09-16. These are upstream capabilities, not claims
about any currently configured Chrona deployment. Upstream default branches/docs
are mutable; pin and review the chosen version before depending on it.

| Option | What Chrona can reuse | Cost / boundaries | Decision |
| --- | --- | --- | --- |
| Existing daily-agent channel | Familiar recipient and existing delivery stack | Must independently work while the original conversation is closed; no such endpoint or receipt contract has been verified here | Prefer if already available and verifiable; do not assume the current interactive terminal is a background delivery channel |
| ntfy | HTTP publication, subscriber clients, configurable cached replay, authentication, notification updates | Need a protected destination, approved hosting/account and recipient client; cached messages create retention/privacy obligations | Recommended first push prototype; a small HTTP adapter can avoid another language/runtime dependency |
| Gotify | Send-only application tokens, server-held messages and receiving clients | Need an existing or approved server/client setup; device suitability and recovery behavior require testing | Strong reuse choice when already deployed; no reason to replace a working installation |
| Apprise / Apprise API | Many existing delivery destinations; stateful preconfigured destination references | CLI/library adds a Python integration or API service dependency; protect administrative configuration and destination selection | Prefer for an existing email/chat channel or later genuine multi-channel need, not as a mandatory extra service for one push destination |

### Evidence and implications

1. [ntfy publication](https://docs.ntfy.sh/publish/) documents HTTP publication,
   message IDs and authenticated protected topics. Its caching section warns:
   **"If `Cache: no` is used, messages will only be delivered to connected
   subscribers"** and may be missed on reconnect. The documented default cache
   is 12 hours, configurable by the service. Therefore disabling retention is a
   real reliability/privacy trade-off, not a free security improvement.
2. The same ntfy page describes notification updates as **append-only** history:
   **"a new message is created that indicates the update, clear, or delete
   action."** A sequence ID can help clients replace a visible notification, but
   is not evidence that repeated HTTP requests create only one server record or
   cause exactly one alert. Do not treat it as a transactional idempotency API.
3. [Gotify introduction](https://gotify.net/docs/) separates sending applications
   from receiving/managing clients. [Push messages](https://gotify.net/docs/pushmsg)
   documents `POST /message` with an application token and says only the creating
   user can see that application's messages. Use a sender credential in headers,
   never an administrative/client token or a credential-bearing URL.
4. [Apprise API README](https://github.com/caronc/apprise-api/blob/master/README.md)
   documents stateless `/notify/` with caller-supplied destinations and stateful
   `/notify/{KEY}` with preconfigured destinations. For Chrona, prefer a fixed
   approved destination reference; never let model output supply arbitrary
   service URLs, tags that widen recipients, attachments or credential-bearing
   notification URLs.
5. The Apprise README also documents configuration locking, reverse-proxy Basic
   authentication and a webhook for notification-call results. A call-result
   webhook is not evidence of recipient delivery or readership. No webhook or
   public callback ingress is needed for the first Chrona integration.
6. [Apprise API LICENSE](https://github.com/caronc/apprise-api/blob/master/LICENSE)
   is MIT in the inspected source. Exact version/license/dependency review for
   the selected ntfy/Gotify/Apprise distribution remains a pre-integration gate;
   this comparison does not certify the license of an entire bundled stack.

None of the reviewed publish interfaces establishes a universal exactly-once
send or human-read guarantee. Treat missing guarantees as unsupported until a
specific version/channel demonstrates them; absence in this bounded review is
not a claim that no related upstream feature can exist.

## Minimal Chrona responsibility

Reuse transport, but retain the product decisions that no generic notification
service can know:

- Is this finalized result, new finding, decision or sustained failure worth
  interrupting the user about? No-change runs should normally be silent.
- Is the selected recipient authorized to see the proposed payload right now?
- Has this result/change already been published, superseded, cancelled or expired?
- Was the last attempt accepted, definitely rejected, or left uncertain?

Initially send a small redacted summary with an authorized result reference. A
localhost URL will not work on a remote phone by magic; approve a safe access path
or send a sufficient permitted summary. Do not expose Chrona publicly just to
make links work. Do not include a bearer token in a result link.

Persist the finalized-output/destination/version identity and outcome needed to
recover a restart between result commitment and publication. Reuse an existing
job/queue if its guarantees fit. Add only the missing transactional coordination,
not a competing notification platform.

`queued`, `channel_accepted`, `failed`, and `uncertain` are distinct observations.
Only record delivered/read when the chosen channel actually provides that
trusted evidence. Delivery retry must not restart research or reaccept a result.

An HTTP timeout after the service accepted a message is an ambiguity. Prefer
query/reconciliation when supported; otherwise show uncertainty and use an
explicit duplicate-risk retry policy. Do not infer that all network failures
are safe to retry. Recheck revocation/expiry before retrying queued messages.

## Prototype gate (not run yet)

Use synthetic public content and an approved test destination, not real
application data, for the first live send. Before any live test, implement local
fixtures for:

1. Allowed endpoint/destination, auth headers, payload limits and redaction.
2. Definite acceptance, rejected credentials, rate limiting and server errors.
3. Timeout before versus after possible acceptance, including stable local IDs.
4. Restart before enqueue, after enqueue, and after send before receipt storage.
5. A revoked destination, expired message, paused Goal and duplicate publication.
6. Offline subscriber reconnect and declared cache/retention behavior.
7. A malicious result attempting to add recipients, URLs or sensitive attachments.
8. A result link usable from the actual recipient device without weakened auth.

Pin the evaluated version; record which receipt and idempotency properties were
observed, rather than generalizing from a 2xx response. Only then select and ship
one adapter. Real sends, credentials, installation and deployment remain separate
approvals from the currently approved Goal-capture implementation.

## Remaining phase-0 blockers

- Live Chrona management connection currently fails with `fetch failed`; no live
  workspace/client/provider inventory or deployed version has been verified.
- The execution provider and its enforceable read/search surface are not yet
  selected/certified. Existing source-level provider labels are insufficient.
- Recipient channel/device, hosting/privacy choice and permitted content remain
  unconfirmed. No notification credential has been requested or stored.
- Pilot sources, file access, remote model processing, cadence, limits and
  retention await user confirmation before standing work is activated.

These do not block isolated Goal-capture development. They do block claiming that
phase 0 or the always-on assistant is complete.
