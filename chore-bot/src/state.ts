import { ChoreState } from './types';

export class StateDO {
	private state: DurableObjectState;
	private env: any;

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;

		try {
			switch (url.pathname) {
				case '/read':
					return this.handleRead();
				case '/write':
					return this.handleWrite(request);
				case '/backup':
					return this.handleBackup();
				default:
					return new Response('Not Found', { status: 404 });
			}
		} catch (error) {
			console.error('StateDO error:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	}

	private async handleRead(): Promise<Response> {
		const state = await this.getState();
		return new Response(JSON.stringify(state), {
			headers: { 'Content-Type': 'application/json' },
		});
	}

	private async handleWrite(request: Request): Promise<Response> {
		const newState = (await request.json()) as ChoreState;

		// Validate the state structure
		if (!this.validateState(newState)) {
			return new Response('Invalid state structure', { status: 400 });
		}

		// Update the timestamp
		newState.lastUpdated = new Date().toISOString();

		// Store the state
		await this.state.storage.put('choreState', newState);

		// Create a backup every day
		const today = new Date().toISOString().split('T')[0];
		const backupKey = `backup_${today}`;
		await this.state.storage.put(backupKey, newState);

		return new Response(JSON.stringify(newState), {
			headers: { 'Content-Type': 'application/json' },
		});
	}

	private async handleBackup(): Promise<Response> {
		const state = await this.getState();
		const timestamp = new Date().toISOString();
		const backupKey = `manual_backup_${timestamp}`;

		await this.state.storage.put(backupKey, state);

		return new Response(
			JSON.stringify({
				success: true,
				backupKey,
				timestamp,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	private async getState(): Promise<ChoreState> {
		const stored = (await this.state.storage.get('choreState')) as ChoreState | undefined;

		if (!stored) {
			// Initialize with default state
			const defaultState: ChoreState = {
				rotation: [],
				currentIndex: 0,
				lastSent: null,
				chores: [],
				lastUpdated: new Date().toISOString(),
			};
			await this.state.storage.put('choreState', defaultState);
			return defaultState;
		}

		return stored;
	}

	private validateState(state: any): state is ChoreState {
		return (
			typeof state === 'object' &&
			Array.isArray(state.rotation) &&
			typeof state.currentIndex === 'number' &&
			Array.isArray(state.chores) &&
			(state.lastSent === null || typeof state.lastSent === 'string') &&
			state.currentIndex >= 0 &&
			state.currentIndex < state.rotation.length
		);
	}

	// Helper method to get next person in rotation
	async getNextPerson(): Promise<string | null> {
		const state = await this.getState();
		if (state.rotation.length === 0) return null;

		return state.rotation[state.currentIndex];
	}

	// Helper method to advance rotation
	async advanceRotation(): Promise<ChoreState> {
		const state = await this.getState();
		if (state.rotation.length === 0) return state;

		state.currentIndex = (state.currentIndex + 1) % state.rotation.length;
		state.lastUpdated = new Date().toISOString();

		await this.state.storage.put('choreState', state);
		return state;
	}
}
