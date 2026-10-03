import { googleEndpoint } from '../_lib/google/endpoint.js';
import { handlePersonal } from '../_lib/google/handlers.js';

const run = googleEndpoint(handlePersonal);

export async function GET(request) {
  return run(request);
}
