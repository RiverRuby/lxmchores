import { Env, ChoreState } from './types';

export async function handleChoreStateAPI(request: Request, env: Env): Promise<Response> {
	// Only allow GET requests
	if (request.method !== 'GET') {
		return new Response('Method Not Allowed', { status: 405 });
	}

	try {
		// Get the chore state from the Durable Object
		const stateId = env.STATE.idFromName('chore-state');
		const stateStub = env.STATE.get(stateId);
		const response = await stateStub.fetch(new Request('http://localhost/read'));

		if (!response.ok) {
			throw new Error(`Failed to read state: ${response.status}`);
		}

		const state: ChoreState = await response.json();

		// Return the state with CORS headers for the frontend
		return new Response(JSON.stringify(state), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	} catch (error) {
		console.error('Error fetching chore state:', error);

		// Return a fallback response
		const fallbackState: ChoreState = {
			description: 'Unable to load chore information at this time. Please try again later.',
			lastUpdated: new Date().toISOString(),
		};

		return new Response(JSON.stringify(fallbackState), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}
}
