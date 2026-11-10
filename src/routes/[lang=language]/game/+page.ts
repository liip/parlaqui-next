import { isCouncilChoice } from '$lib/game/protocol';

export const ssr = false;

export const load = ({ url }) => {
	const council = url.searchParams.get('council');
	return { council: isCouncilChoice(council) ? council : ('all' as const) };
};
