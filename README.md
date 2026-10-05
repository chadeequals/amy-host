# amy-host (Render)

Twilio ConversationRelay WebSocket service for Handprints "Amy".

**Status:** slice-2 bodies + durable C14 consume wired. **NOT deployed.** `AMY_ENABLED` must stay `0` until Security CLOSED PASS on C13–C24 + S1–S18.

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
