import { cardResponse } from '$lib/server/card/response';

export const GET = ({ params }) => cardResponse(params.lang, params.token);
