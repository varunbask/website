import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handleSettings } from '../_lib/google/handlers.js';

const run = googleEndpoint(handleSettings);

export async function POST(request) {
  return run(request);
}
