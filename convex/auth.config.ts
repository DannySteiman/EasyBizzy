/**
 * CONVEX AUTH CONFIGURATION
 * =========================
 * 
 * This file configures Convex to verify Clerk JWT tokens.
 * 
 * When a user authenticates with Clerk, Clerk issues a JWT.
 * This config tells Convex how to verify that JWT.
 */

export default {
  providers: [
    {
      // The domain is derived from your Clerk publishable key
      // pk_test_aW4tcmVpbmRlZXItNTkuY2xlcmsuYWNjb3VudHMuZGV2JA
      // Base64 decodes to: in-reindeer-59.clerk.accounts.dev
      domain: "https://in-reindeer-59.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
};
