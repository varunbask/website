import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handleStart } from '../_lib/google/handlers.js';

const run = googleEndpoint(handleStart);

export async function POST(request) {
  return run(request);
}
