/**
 * CONVEX SCHEMA - Multi-Tenant Foundation
 * ========================================
 * 
 * This file defines the core data models for the multi-tenant SaaS:
 * 
 * 1. tenants             - The business/workspace organizations
 * 2. branches            - Physical locations belonging to a tenant
 * 3. userTenants         - Membership table linking users to tenants with roles
 * 4. tenantAccessEmails  - Email allowlist for MANAGER/WORKER access (no invites)
 * 
 * Note: SAAS_ADMIN is NOT stored here. It's handled separately via allowlist.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * TENANTS TABLE
   * =============
   * Represents a business/workspace organization (customer of our SaaS).
   * Each tenant can have multiple branches and multiple users.
   * 
   * planTier and subscriptionStatus are placeholders for Polar integration.
   */
  tenants: defineTable({
    // Display name of the business/workspace
    name: v.string(),
    
    // Subscription plan tier - determines feature access
    // Default: BASIC (set when creating tenant)
    planTier: v.union(
      v.literal("BASIC"),
      v.literal("PRO"),
      v.literal("BUSINESS"),
      v.literal("ENTERPRISE")
    ),
    
    // Current subscription status
    // - trialing: Free trial period (14 days)
    // - active: Paid subscription active
    // - inactive: No subscription
    // - past_due: Payment failed
    // - canceled: Subscription canceled
    subscriptionStatus: v.union(
      v.literal("trialing"),
      v.literal("inactive"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled")
    ),
    
    // Trial end date (timestamp) - when trial expires
    // Set to 14 days from creation for trial tenants
    trialEndsAt: v.optional(v.number()),
    
    // Polar integration placeholders (populated later by webhooks)
    polarCustomerId: v.optional(v.string()),
    polarSubscriptionId: v.optional(v.string()),
    
    // =========================================
    // CHECKOUT-FIRST CLAIMING FIELDS
    // =========================================
    // Email of the owner (from Polar checkout)
    // Used to claim the tenant after user signs up
    ownerEmail: v.optional(v.string()),
    
    // User ID of the owner (set when tenant is claimed)
    // Initially null for anonymous checkouts
    ownerId: v.optional(v.string()),
    
    // Whether the tenant has been claimed by a user
    // false = created via webhook, waiting for user to sign up
    // true = user has signed up and claimed this tenant
    claimed: v.optional(v.boolean()),
    
    // Timestamp when tenant was created
    createdAt: v.number(),
  })
    // Index for looking up tenant by Polar customer ID (for webhooks)
    .index("by_polar_customer", ["polarCustomerId"])
    // Index for looking up tenant by Polar subscription ID (for webhooks)
    .index("by_polar_subscription", ["polarSubscriptionId"])
    // Index for claiming unclaimed tenants by email
    .index("by_owner_email", ["ownerEmail"])
    // Index for finding tenants owned by a user
    .index("by_owner", ["ownerId"]),

  /**
   * BRANCHES TABLE
   * ==============
   * Physical locations belonging to a tenant.
   * Every tenant MUST have at least one branch (the main branch).
   * 
   * All Main App data should be scoped to both tenantId AND branchId
   * for proper multi-location support.
   */
  branches: defineTable({
    // Reference to the parent tenant
    tenantId: v.id("tenants"),
    
    // Display name of this branch/location
    name: v.string(),
    
    // Physical address of the branch
    address: v.optional(v.string()),
    
    // True if this is the primary/headquarters branch
    // Each tenant should have exactly one main branch
    isMainBranch: v.boolean(),
    
    // Soft-archive flag for locations.
    // Archived branches are hidden from most UI and should not be used for new assignments.
    // Optional for backwards compatibility with existing data.
    isArchived: v.optional(v.boolean()),

    // Timestamp when branch was created
    createdAt: v.number(),
  })
    // Index for fetching all branches of a tenant
    .index("by_tenant", ["tenantId"])
    // Index for finding the main branch of a tenant
    .index("by_tenant_main", ["tenantId", "isMainBranch"]),

  /**
   * USER_TENANTS TABLE (Membership)
   * ===============================
   * Links users to tenants with their role and optional branch assignment.
   * This is the source of truth for "who can access what tenant with what role".
   * 
   * Roles (Main App only):
   * - OWNER: Full access to tenant, can manage everything
   * - MANAGER: Can manage branch operations, limited admin
   * - WORKER: Basic operational access (e.g., take orders)
   * 
   * Note: SAAS_ADMIN is NOT stored here - it's a separate global concept.
   */
  userTenants: defineTable({
    // The Convex user ID (from Convex Auth)
    userId: v.string(),
    
    // Reference to the tenant this membership is for
    tenantId: v.id("tenants"),
    
    // Role within this tenant
    role: v.union(
      v.literal("OWNER"),
      v.literal("MANAGER"),
      v.literal("WORKER")
    ),
    
    // Optional branch assignment
    // - null/undefined means access to all branches (typically OWNER)
    // - set to specific branch for MANAGER/WORKER
    branchId: v.optional(v.id("branches")),
    
    // Timestamp when membership was created
    createdAt: v.number(),
  })
    // Index for finding all memberships of a user
    .index("by_user", ["userId"])
    // Index for finding all members of a tenant
    .index("by_tenant", ["tenantId"])
    // Index for finding a specific user's membership in a tenant
    .index("by_user_tenant", ["userId", "tenantId"])
    // Index for finding all members of a specific branch
    .index("by_branch", ["branchId"]),

  /**
   * TENANT ACCESS EMAILS TABLE (Allowlist)
   * =====================================
   * Stores email-based access rules for non-owner roles.
   *
   * - No invite flow / no emails sent
   * - When a user logs in, we can sync memberships from this allowlist
   *
   * IMPORTANT: email must be stored normalized (lowercase + trimmed).
   */
  tenantAccessEmails: defineTable({
    tenantId: v.id("tenants"),
    email: v.string(), // lowercase trimmed
    role: v.union(v.literal("MANAGER"), v.literal("WORKER")),
    // Branch scoping for multi-branch tenants (required when > 1 branch)
    branchId: v.optional(v.id("branches")),
    createdAt: v.number(),
    createdByUserId: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_email", ["tenantId", "email"])
    .index("by_email", ["email"]),

  /**
   * SHIFT SLOT TEMPLATES TABLE
   * ==========================
   * Permanent weekly shift structure per branch.
   * These templates repeat every week until edited/archived.
   */
  shiftSlotTemplates: defineTable({
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    dayOfWeek: v.number(), // 0..6 where 0 = Monday
    startMin: v.number(), // 0..1439
    endMin: v.number(), // 1..1440 (must be > startMin in mutations)
    position: v.optional(v.string()), // optional e.g. "Cashier", "Kitchen"
    label: v.optional(v.string()),
    createdAt: v.number(),
    createdByUserId: v.string(),
    isArchived: v.optional(v.boolean()),
  })
    .index("by_tenant_branch", ["tenantId", "branchId"])
    .index("by_tenant_branch_day", ["tenantId", "branchId", "dayOfWeek"]),

  /**
   * AVAILABILITY SETTINGS TABLE
   * ===========================
   * Tenant-level settings for worker availability (cutoff day).
   */
  availabilitySettings: defineTable({
    tenantId: v.id("tenants"),
    cutoffDayOfWeek: v.number(), // 0..6 where 0 = Monday (default 3 = Thursday)
    createdAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  /**
   * SLOT AVAILABILITIES TABLE
   * =========================
   * Worker says "I'm available for this template slot in this week".
   * One row = one worker + one slot + one week.
   */
  slotAvailabilities: defineTable({
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(), // ISO date YYYY-MM-DD of Monday
    workerUserId: v.string(), // Clerk userId
    slotTemplateId: v.id("shiftSlotTemplates"),
    createdAt: v.number(),
  })
    .index("by_tenant_branch_week", ["tenantId", "branchId", "weekStart"])
    .index("by_worker_week", ["workerUserId", "weekStart"])
    .index("by_tenant_worker_week", ["tenantId", "workerUserId", "weekStart"])
    .index("by_slot_week", ["slotTemplateId", "weekStart"]),

  /**
   * SCHEDULE PUBLISHES TABLE
   * ========================
   * Publish status per branch+week. Workers can only see schedule when PUBLISHED.
   * No row = DRAFT. Schedule remains editable after publish.
   */
  schedulePublishes: defineTable({
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(), // Monday YYYY-MM-DD
    status: v.union(v.literal("DRAFT"), v.literal("PUBLISHED")),
    publishedAt: v.optional(v.number()),
    publishedByUserId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_tenant_branch_week", ["tenantId", "branchId", "weekStart"]),

  /**
   * SLOT ASSIGNMENTS TABLE
   * ======================
   * Manager assigns workers to template slots for a given week.
   * One row = one worker assigned to one slot for one week.
   */
  slotAssignments: defineTable({
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(), // Monday YYYY-MM-DD
    slotTemplateId: v.id("shiftSlotTemplates"),
    workerUserId: v.string(),
    createdAt: v.number(),
    createdByUserId: v.string(),
  })
    .index("by_tenant_branch_week", ["tenantId", "branchId", "weekStart"])
    .index("by_slot_week", ["slotTemplateId", "weekStart"])
    .index("by_tenant_worker_week", ["tenantId", "workerUserId", "weekStart"]),
});
