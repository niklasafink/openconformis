const noSession = { data: null, error: null };

export function createAuthClient() {
  return {
    useSession: () => ({ data: null, isPending: false, error: null }),
    signIn: {
      email: async () => noSession,
      magicLink: async () => noSession,
      social: async () => noSession,
    },
    signUp: {
      email: async () => noSession,
    },
    signOut: async () => noSession,
  };
}
