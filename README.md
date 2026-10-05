# amy-host (Render)

Twilio ConversationRelay WebSocket service for Handprints "Amy".

**Status (2026-10-05):** deployed DARK on Render `srv-db209srtqb8s73bjdp10` (`AMY_ENABLED=0`, healthz `amy:"off"`).
Phase 4 TEST-LINE guardrails in code (see `src/config/guardrails.ts`, `npm test` → phase4 suite).
Flip runbook: `/workspace/phone/AMY_PHASE4_TEST_LINE_FLIP_RUNBOOK_2026-10-05.md`. `AMY_ENABLED` must stay `0` until Security CLOSED PASS.

- Test line only: setup `to` must be `+14696891960`, facility 2 (hard-coded; env cannot widen).
- Tuition: bundled `config/fact_sheets/mesquite.json` only, verified against the greened list; output filter on every model reply.
- Press 1 at any point → `end` with `handoffData` **string** `{"reason":"transfer"}` → Oracle amy-done Dials the school line.
- Cost estimate per call → Edge `amy-call-summary` `kind=cost_meta` → `phone_call.enroll_answers._amy_cost`.

- No service-role Supabase key here (C15).
- No PII in logs (CallSid + facility_id only) (C6).
- OpenAI calls use `store: false`; prefers `/v1/responses` (C24 / P2-3).
- Facility bound server-side from token / setup params (C18).
- C14 consume: Edge `amy-relay-consume` → `amy_relay_nonce` (atomic insert). **No in-memory Set.**
- Edge tools require `phone_line.amy_enabled=true` (P1-2).
- C22 urgent alert + Curriculum after-hours safety lines built; still fail-closed while `AMY_ENABLED=0`.

See `/workspace/phone/AMY-BUILD_2026-09-29.md` and Security review `2026-09-29-amy-build-only-review.md`.

```bash
npm test          # local unit/mock
npm run typecheck
```
