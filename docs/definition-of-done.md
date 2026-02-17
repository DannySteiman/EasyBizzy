# Definition of Done (EasyBizzy)

A feature is DONE only if:

- Data model updated (minimal, tenantId enforced)
- Queries + mutations implemented
- Guards enforce:
  - requireTenant
  - requireRole
  - requireActiveSubscription
- UI implemented (mobile-first contract respected)
- Empty + loading states exist
- Manual test checklist passes
- npm run lint passes
- Build succeeds
