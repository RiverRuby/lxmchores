export interface Env {
	// Secrets
	SLACK_BOT_TOKEN: string;
	SLACK_SIGNING_SECRET: string;
	GCP_SERVICE_ACCOUNT: string;
	OPENAI_API_KEY: string;

	// Durable Object binding
	STATE: DurableObjectNamespace;

	// Static assets binding
	ASSETS: {
		fetch: typeof fetch;
	};

	// Environment variables
	ENVIRONMENT: string;
}

export interface ChoreState {
	description: string;
	lastUpdated: string;
	lastSent?: string;
}

export interface SlackEvent {
	type: string;
	text?: string;
	user?: string;
	channel?: string;
	ts?: string;
}

export interface SlackCommand {
	token: string;
	team_id: string;
	team_domain: string;
	channel_id: string;
	channel_name: string;
	user_id: string;
	user_name: string;
	command: string;
	text: string;
	response_url: string;
	trigger_id: string;
}

export interface OpenAITool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, any>;
			required?: string[];
		};
	};
}

export interface CalendarEvent {
	summary: string;
	description?: string;
	start: {
		dateTime: string;
		timeZone: string;
	};
	end: {
		dateTime: string;
		timeZone: string;
	};
	attendees?: Array<{
		email: string;
	}>;
}
