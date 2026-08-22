const unavailable = async () => new Response(null, { status: 503 });

export function createNeonAuth() {
  return {
    getSession: async () => ({ data: null, error: null }),
    handler: () => ({
      GET: unavailable,
      POST: unavailable,
      PUT: unavailable,
      DELETE: unavailable,
      PATCH: unavailable,
    }),
    middleware: () => unavailable,
  };
}
