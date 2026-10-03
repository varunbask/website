import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handleSync } from '../_lib/google/handlers.js';

const run = googleEndpoint(handleSync);

export async function POST(request) {
  return run(request);
}
