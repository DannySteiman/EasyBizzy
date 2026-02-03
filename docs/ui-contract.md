## Mobile-First UI Contract (Main App)

**Scope**: This contract applies to the **Main App only**: `app/app/[tenantId]/*`.

**Non-goals (do not do as part of this contract)**:
- Do NOT change backend logic (Convex, billing, webhooks, auth).
- Do NOT change routing structure or authentication.
- Do NOT rewrite existing pages.
- Do NOT add CSS frameworks unless already present.
- Do NOT add native-only APIs or App Store / Play Store configs yet.

### 1) Mobile-first is mandatory
- Design for small screens first (phone width).
- Desktop/tablet may enhance layout, but **mobile must always be usable**.
- No assumptions about mouse/keyboard.
- Must work at **360px width**.

### 2) Main App navigation model (bottom navigation)
- Main App uses **bottom navigation** as the primary navigation.
- Avoid sidebars and complex menus in Main App.
- Top bar is allowed only for:
  - page title
  - back button
  - small status badge (plan, trial)

#### Bottom tabs (intent)
- Dashboard
- Team
- Shifts
- Receipts
- Settings

#### Bottom tabs (route contract)
This contract intentionally locks the route patterns for future pages (no implementation now).

- **Dashboard**
  - OWNER/MANAGER: `/app/[tenantId]/manager/home`
  - WORKER: `/app/[tenantId]/worker/home`
- **Team**
  - OWNER/MANAGER: `/app/[tenantId]/manager/team`
  - WORKER: `/app/[tenantId]/worker/team`
- **Shifts**
  - OWNER/MANAGER: `/app/[tenantId]/manager/shifts`
  - WORKER: `/app/[tenantId]/worker/shifts`
- **Receipts**
  - OWNER/MANAGER: `/app/[tenantId]/manager/receipts`
  - WORKER: `/app/[tenantId]/worker/receipts`
- **Settings**
  - OWNER/MANAGER: `/app/[tenantId]/manager/settings`
  - WORKER: `/app/[tenantId]/worker/settings`

**Onboarding**: bottom navigation should still be present during onboarding (`/app/[tenantId]/onboarding`) for consistency.

### 3) Layout primitives (no tables)
- Use **cards, lists, and stacked sections**.
- Avoid tables completely.
- Avoid large modals; prefer full-screen dialogs/sheets.
- Buttons must be thumb-friendly.

### 4) Page responsibility
Each page must have:
- **1 primary purpose**
- **1 primary action** (at most)

### 5) Forms
- Prefer short, multi-step forms instead of long forms.
- Use inline validation.
- Prefer selects over free text where possible.

### 6) Responsiveness rules
- Vertical scrolling is preferred.
- Horizontal scrolling is discouraged (except intentional carousels).
- Content must remain usable at 360px without zoom.

### 7) Tap targets and accessibility
- Minimum tap target: **44px** height/width for interactive controls.
- Ensure sufficient contrast and readable type sizes on mobile.

---

## Copy/paste templates (for new work)

### New page contract (fill this into PR descriptions or page header comments)
- **Primary purpose**:
- **Primary action**:
- **Bottom nav**: present (Main App)
- **Top bar**: title/back/status badge only
- **No tables / no large modals**:
- **360px verified**:

### New component contract
- **Mobile-first**: usable at 360px
- **Tap targets**: >= 44px
- **Prefer lists/cards** over dense grids/tables
- **No modal traps**: use full-screen sheet where appropriate

