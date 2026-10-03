import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handleNotify } from '../_lib/google/handlers.js';

const run = googleEndpoint(handleNotify);

export async function POST(request) {
  return run(request);
}
