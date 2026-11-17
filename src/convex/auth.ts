// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";

/**
 * Registered-account authentication only.
 *
 * LifeLink previously exposed Convex Auth's Anonymous provider for a "demo
 * guest" session. Guest access has been removed: there is no anonymous sign-in
 * path, no guest session creation and no guest identity that can reach a
 * protected function. Every session must come from the email OTP provider and
 * therefore belongs to a real account.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp],
});
