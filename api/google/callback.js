import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handleCallback } from '../_lib/google/handlers.js';

const run = googleEndpoint(handleCallback);

export async function GET(request) {
  return run(request);
}
