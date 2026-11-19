import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { handleArenaRequest } from '../../../server/platform.mjs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) { return handleArenaRequest(request, { db: env.DB, user: await getChatGPTUser() }); }
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
