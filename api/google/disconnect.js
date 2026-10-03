import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handleDisconnect } from '../_lib/google/handlers.js';

const run = googleEndpoint(handleDisconnect);

export async function POST(request) {
  return run(request);
}
