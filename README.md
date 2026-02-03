# EasyBizzy — Multi-Tenant SaaS Foundation

A minimal, secure multi-tenant backbone for a business/workspace SaaS built with Convex.

## Architecture Overview

### Two Application Layers

1. **Mother App** (SaaS Admin layer) - Used only by `SAAS_ADMIN` users
2. **Main App** (Customer layer) - Used by customer workspaces: `OWNER`, `MANAGER`, `WORKER`

### Roles

| Role | Layer | Scope | Description |
|------|-------|-------|-------------|
| `SAAS_ADMIN` | Mother App | Global | System administrators (not stored in userTenants) |
| `OWNER` | Main App | Tenant-wide | Full tenant access, billing, user management |
| `MANAGER` | Main App | Branch-level | Branch operations, staff management |
| `WORKER` | Main App | Branch-level | Basic operations (orders, etc.) |

## Project Structure

```
├── app/                        # Next.js App Router frontend
│   ├── layout.tsx              # Root layout with Convex provider
│   ├── page.tsx                # Entry gate (role-based routing)
│   ├── pricing/page.tsx        # Pricing page (start checkout)
│   ├── admin/page.tsx          # SAAS_ADMIN dashboard (Mother App)
│   ├── checkout/
│   │   ├── success/page.tsx    # Post-checkout success (polls for tenant)
│   │   └── cancel/page.tsx     # Checkout canceled
│   └── app/[tenantId]/
│       ├── layout.tsx          # Tenant app layout with auth guard
│       ├── onboarding/page.tsx # Owner onboarding (new tenant)
│       ├── manager/home/page.tsx # OWNER/MANAGER dashboard
│       └── worker/home/page.tsx  # WORKER dashboard
├── convex/
│   ├── schema.ts               # Data models (tenants, branches, userTenants)
│   ├── tenants.ts              # Tenant management functions
│   ├── branches.ts             # Branch management functions
│   ├── checkout.ts             # Polar checkout actions
│   ├── users.ts                # User info queries
│   ├── polarWebhooks.ts        # Internal mutations for Polar webhooks
│   ├── http.ts                 # HTTP endpoints (Polar webhooks)
│   └── lib/
│       ├── index.ts            # Central exports
│       ├── types.ts            # Type definitions
│       ├── saasAdmin.ts        # SAAS_ADMIN allowlist mechanism
│       ├── tenantContext.ts    # getTenantContext() helper
│       ├── guards.ts           # requireTenantContext() and guards
│       └── polar.ts            # Polar webhook verification & helpers
└── package.json
```

## Data Models

### tenants
The business/workspace (customer of the SaaS).

```typescript
{
  name: string,
  planTier: "BASIC" | "PRO" | "ENTERPRISE",
  subscriptionStatus: "inactive" | "active" | "past_due" | "canceled",
  polarCustomerId?: string,      // For Polar integration
  polarSubscriptionId?: string,  // For Polar integration
  createdAt: number
}
```

### branches
Physical locations belonging to a tenant.

```typescript
{
  tenantId: Id<"tenants">,
  name: string,
  address?: string,
  isMainBranch: boolean,
  createdAt: number
}
```

### userTenants
Membership table linking users to tenants with roles.

```typescript
{
  userId: string,              // From Convex Auth
  tenantId: Id<"tenants">,
  role: "OWNER" | "MANAGER" | "WORKER",
  branchId?: Id<"branches">,   // Null = all branches (typically OWNER)
  createdAt: number
}
```

## Core Concepts

### Tenant Context

Every Main App operation must resolve tenant context first. The `getTenantContext()` function returns:

```typescript
type TenantContext = {
  currentUserId: string,
  currentTenantId: Id<"tenants">,
  currentMembershipId: Id<"userTenants">,
  currentRole: "OWNER" | "MANAGER" | "WORKER",
  currentBranchId: Id<"branches"> | null,
  planTier: "BASIC" | "PRO" | "ENTERPRISE",
  subscriptionStatus: "inactive" | "active" | "past_due" | "canceled",
  isSaasAdmin: boolean
}
```

### Guards (Security)

Guards ensure secure access patterns. **Always use them**.

```typescript
// Basic tenant context (required for ALL Main App operations)
const tenantCtx = await requireTenantContext(ctx, args.tenantId);

// Role checks
requireOwner(tenantCtx);                      // OWNER only
requireManager(tenantCtx);                    // OWNER or MANAGER
requireRole(tenantCtx, ["OWNER", "MANAGER"]); // Custom roles

// Subscription checks
requireActiveSubscription(tenantCtx);
requirePlanTier(tenantCtx, "PRO");

// Branch checks
requireBranchAccess(tenantCtx, branchId);

// Combined (all-in-one)
const tenantCtx = await requireAll(ctx, {
  tenantId: args.tenantId,
  requiredRoles: ["OWNER", "MANAGER"],
  requireActive: true,
  requiredTier: "PRO",
  branchId: args.branchId,
});
```

### SAAS_ADMIN

SAAS_ADMIN is managed via email allowlist (not in database):

```typescript
// In convex/lib/saasAdmin.ts, add emails to the allowlist:
const SAAS_ADMIN_EMAILS = [
  "admin@yourcompany.com",
];

// For Mother App operations:
await requireSaasAdmin(ctx);
```

## Usage Examples

### Creating a Tenant

```typescript
// In your frontend, call the createTenant mutation
const result = await convex.mutation(api.tenants.createTenant, {
  name: "My Business",
  branchName: "Downtown Location",
});
// Returns: { tenantId, branchId, membershipId }
```

### Querying with Tenant Context

```typescript
// ALWAYS start with the guard
export const getOrders = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    
    // ALL queries must use tenantCtx.currentTenantId
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantCtx.currentTenantId))
      .collect();
    
    return orders;
  },
});
```

### Adding New Tables

When adding new tables, ALWAYS:

1. Include `tenantId` field
2. Include `branchId` if branch-specific
3. Add index `by_tenant` and optionally `by_branch`

```typescript
// In schema.ts
orders: defineTable({
  tenantId: v.id("tenants"),
  branchId: v.id("branches"),
  // ... other fields
})
  .index("by_tenant", ["tenantId"])
  .index("by_branch", ["branchId"])
```

## Frontend Routing

### Entry Gate (`/`)

When users visit the root page, they're routed based on role and subscription:

| Condition | Destination |
|-----------|-------------|
| SAAS_ADMIN | `/admin` (Mother App) |
| OWNER/MANAGER with active tenant | `/app/{tenantId}/manager/home` |
| WORKER with active tenant | `/app/{tenantId}/worker/home` |
| No tenant (needs to subscribe) | `/pricing` |
| Setup pending | `/checkout/success` |

### Checkout Flow (Webhook-First)

```
User selects plan -> Polar Checkout -> Payment -> Polar Webhook
                                                      |
                                                      v
                                          Creates: Tenant + Branch + OWNER
                                                      |
                                                      v
/checkout/success polls isMyTenantReady -> Redirects to /app/{tenantId}/onboarding
```

**Key Points:**
- Client NEVER creates tenant directly
- Webhook is authoritative for tenant creation
- `/checkout/success` polls every 1.5s for up to 60s
- `userId` in metadata links subscription to OWNER

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Initialize Convex (in one terminal):
   ```bash
   npx convex dev
   ```

3. Start Next.js frontend (in another terminal):
   ```bash
   npm run dev:frontend
   ```

4. Add SAAS_ADMIN emails in `convex/lib/saasAdmin.ts`

## Environment Variables

### Frontend (.env.local)

```env
# Convex URL (get from Convex dashboard)
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

### Backend (Convex Environment Variables)

```bash
# Set via Convex CLI
npx convex env set POLAR_ACCESS_TOKEN "polar_pat_xxxxx"
npx convex env set POLAR_WEBHOOK_SECRET "whsec_xxxxx"
npx convex env set POLAR_ENVIRONMENT "sandbox"  # or "production"
npx convex env set APP_BASE_URL "http://localhost:3000"  # or production URL
```

## Polar Integration

### Setup

1. **Create products in Polar Dashboard**
   - BASIC Plan - $9.99/month
   - PRO Plan - $29.99/month
   - ENTERPRISE Plan - $99.99/month

2. **Configure environment variables in Convex**
   ```bash
   npx convex env set POLAR_ACCESS_TOKEN "polar_pat_xxxxx"
   npx convex env set POLAR_WEBHOOK_SECRET "whsec_xxxxx"
   npx convex env set POLAR_ENVIRONMENT "sandbox"
   npx convex env set APP_BASE_URL "http://localhost:3000"
   ```

3. **Map product IDs to plan tiers**
   In `convex/lib/polar.ts`, update the `POLAR_PRODUCT_TO_TIER` mapping:
   ```typescript
   const POLAR_PRODUCT_TO_TIER = {
     "prod_xxxxx": "BASIC",
     "prod_yyyyy": "PRO",
     "prod_zzzzz": "ENTERPRISE",
   };
   ```

4. **Configure webhook in Polar Dashboard**
   - URL: `https://[your-deployment].convex.site/webhooks/polar`
   - Events: `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`

### Webhook Flow

```
User → Polar Checkout → Polar sends webhook → /webhooks/polar → Updates tenant subscription
```

### Creating a Checkout Session (Frontend)

When creating a checkout, include the `tenantId` in metadata:

```typescript
// Call Polar API to create checkout
const checkout = await polar.checkouts.create({
  productId: "prod_xxxxx",
  successUrl: "https://yourapp.com/success",
  metadata: {
    tenantId: "your-tenant-id-here"  // Links subscription to tenant
  }
});
```

### Handled Webhook Events

| Event | Action |
|-------|--------|
| `subscription.created` | Sets `subscriptionStatus: "active"`, links `polarSubscriptionId` |
| `subscription.updated` | Updates `planTier` and `subscriptionStatus` |
| `subscription.canceled` | Sets `subscriptionStatus: "canceled"` (or keeps active if cancel_at_period_end) |
| `subscription.revoked` | Sets `subscriptionStatus: "inactive"` |

## What's NOT Included (Yet)

- **Auth Integration** - Using placeholders; integrate Clerk/Auth0/etc.
- **Additional roles** - Exactly SAAS_ADMIN, OWNER, MANAGER, WORKER
- **Email/notifications** - Not implemented
- **Full product UI** - Only placeholder pages; implement your business logic

## Security Notes

1. **Fail Closed**: If tenant context cannot be resolved, the request is blocked
2. **No Bypassing**: All Main App operations go through `requireTenantContext()`
3. **SAAS_ADMIN Bypass**: SAAS_ADMINs can bypass role/subscription checks for admin purposes
4. **Branch Isolation**: MANAGER/WORKER only see their assigned branch data
