/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Env, SlackCommand, ChoreState } from './types';
import { StateDO } from './state';
import { verifySlackSignature } from './utils';
import { ChoreBot } from './openai';

export { StateDO };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		try {
			// Handle different routes
			switch (url.pathname) {
				case '/slack':
					return handleSlackWebhook(request, env);
				case '/health':
					return new Response('OK', { status: 200 });
				default:
					return new Response('Not Found', { status: 404 });
			}
		} catch (error) {
			console.error('Request handling error:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log('Cron trigger fired:', new Date().toISOString());

		try {
			await handleScheduledReminder(env);
		} catch (error) {
			console.error('Scheduled handler error:', error);
		}
	},
};

async function handleSlackWebhook(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	const body = await request.text();

	// Verify Slack signature
	const isValid = await verifySlackSignature(request, env.SLACK_SIGNING_SECRET, body);
	if (!isValid) {
		console.log('Invalid Slack signature');
		return new Response('Unauthorized', { status: 401 });
	}

	// Handle URL verification (when setting up webhook)
	const data = JSON.parse(body);
	if (data.type === 'url_verification') {
		return new Response(data.challenge, {
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	// Handle slash command
	if (data.command === '/chores') {
		return handleChoresCommand(data as SlackCommand, env);
	}

	// Handle events
	if (data.type === 'event_callback') {
		return handleSlackEvent(data, env);
	}

	return new Response('OK', { status: 200 });
}

async function handleChoresCommand(command: SlackCommand, env: Env): Promise<Response> {
	const text = command.text?.trim() || '';

	try {
		const bot = new ChoreBot(env);
		const response = await bot.processCommand(text);

		// Send response back to Slack
		return new Response(
			JSON.stringify({
				response_type: 'in_channel',
				text: response,
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch (error) {
		console.error('Error processing chores command:', error);
		return new Response(
			JSON.stringify({
				response_type: 'ephemeral',
				text: 'Sorry, I encountered an error processing your request. Please try again.',
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

async function handleSlackEvent(data: any, env: Env): Promise<Response> {
	const event = data.event;

	// Ignore bot messages to prevent loops
	if (event.bot_id || event.subtype === 'bot_message') {
		return new Response('OK', { status: 200 });
	}

	// Handle mentions or direct messages
	if (event.type === 'message' && (event.text?.includes('<@') || event.channel_type === 'im')) {
		try {
			const bot = new ChoreBot(env);
			const response = await bot.processMessage(event.text, event.user);

			// Send response to Slack
			await sendSlackMessage(env.SLACK_BOT_TOKEN, event.channel, response);
		} catch (error) {
			console.error('Error handling Slack event:', error);
		}
	}

	return new Response('OK', { status: 200 });
}

async function handleScheduledReminder(env: Env): Promise<void> {
	try {
		const bot = new ChoreBot(env);
		await bot.sendScheduledReminder();
	} catch (error) {
		console.error('Error sending scheduled reminder:', error);
	}
}

async function sendSlackMessage(token: string, channel: string, text: string): Promise<void> {
	const response = await fetch('https://slack.com/api/chat.postMessage', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			channel,
			text,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to send Slack message: ${error}`);
	}
}
