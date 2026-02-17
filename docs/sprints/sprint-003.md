# Sprint 003

Sprint Goal:
EasyBizzy is deployed to production and Polar webhooks provision tenants correctly with backend-authoritative gating enforced.

Frozen Scope:
- Vercel deploy (Next.js)
- Convex prod deploy
- Clerk prod env keys
- Polar prod webhook URL + secret
- End-to-end provisioning test
- Subscription gating validation (fail closed)

Out of Scope:
- New product features
- UI redesign
- Any refactors not required for prod deploy

Tasks:
[ ] Verify env var matrix (dev vs prod)
[ ] Deploy Convex to prod
[ ] Deploy Next.js to Vercel
[ ] Configure Clerk production keys + URLs
[ ] Configure Polar production webhook + secret
[ ] Run end-to-end test checklist
[ ] Fix any production-only issues
[ ] Confirm fail-closed behavior on unclear subscription state
