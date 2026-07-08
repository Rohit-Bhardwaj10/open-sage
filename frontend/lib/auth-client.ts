import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  /** The base URL of the auth server (optional if same domain) */
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "http://localhost:3000",
});

export const { signIn, signUp, signOut, useSession } = authClient;
