# Authenticated owner material admission

POST `/api/web/material-admission`, same-origin authenticated JSON body:
`{appsModuleId, materialId, fingerprint, confirmed:true}`.

This existing owner Web entry reads exact prepared material from active apps.overview (pinned by moduleId), checks actual apps identity/version and target baseline from modules.list. No browser-supplied identity, target or owner flags are accepted. It persists an invocation key before modules.admit; an uncertain admission call can repeat only this idempotent exact keyed call. Successful admission replies are persisted and returned unchanged. It never calls submit, approve or activate. Apps then submits the exact material under its own identity with the returned original requestKey. Unknown candidate outcomes stay query-only.

The route is HTTP-owner only, not registered as a cross-app tool. Generic /call still rejects all modules.* calls. No kernel authority or API changes, no authority field change in apps, no new approval resolver.

New tests: `bun test material-admission.bun.test.ts` (4 pass/17 assertions). Candidate test.ts also runs checkMaterialAdmission. Local full directory bun test includes browser-only and checkout-only tests and is not a valid portable all-green command. The source export has no chrona/testing local SDK; actual candidate checks remain separate evidence.
