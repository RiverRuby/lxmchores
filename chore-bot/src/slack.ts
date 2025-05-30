import { Env, SlackCommand } from './types';
import { verifySlackSignature } from './utils';
import { ChoreBot } from './openai';

export async function handleSlackWebhook(request: Request, env: Env): Promise<Response> {
	console.log('🚀 Slack webhook received:', {
		method: request.method,
		url: request.url,
		headers: Object.fromEntries(request.headers.entries()),
		timestamp: new Date().toISOString(),
	});

	if (request.method !== 'POST') {
		console.log('❌ Invalid method:', request.method);
		return new Response('Method not allowed', { status: 405 });
	}

	const body = await request.text();
	console.log('📝 Request body:', body);

	// Verify Slack signature
	console.log('🔐 Verifying Slack signature...');
	const isValid = await verifySlackSignature(request, env.SLACK_SIGNING_SECRET, body);
	if (!isValid) {
		console.log('❌ Invalid Slack signature - request rejected');
		return new Response('Unauthorized', { status: 401 });
	}
	console.log('✅ Slack signature verified successfully');

	// Handle URL verification (when setting up webhook)
	const data = JSON.parse(body);
	console.log('📋 Parsed data:', data);

	if (data.type === 'url_verification') {
		console.log('🔗 URL verification challenge received:', data.challenge);
		return new Response(data.challenge, {
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	// Handle slash command
	if (data.command === '/chores') {
		console.log('⚡ Slash command received:', {
			command: data.command,
			text: data.text,
			user: data.user_name,
			channel: data.channel_name,
		});
		return handleChoresCommand(data as SlackCommand, env);
	}

	// Handle events
	if (data.type === 'event_callback') {
		console.log('📢 Event callback received:', {
			event_type: data.event?.type,
			user: data.event?.user,
			channel: data.event?.channel,
			text: data.event?.text?.substring(0, 100) + (data.event?.text?.length > 100 ? '...' : ''),
		});
		return handleSlackEvent(data, env);
	}

	console.log('❓ Unknown request type, responding with OK');
	return new Response('OK', { status: 200 });
}

async function handleChoresCommand(command: SlackCommand, env: Env): Promise<Response> {
	const text = command.text?.trim() || '';
	console.log('🎯 Processing chores command:', {
		user: command.user_name,
		channel: command.channel_name,
		text: text,
		timestamp: new Date().toISOString(),
	});

	try {
		const bot = new ChoreBot(env);
		console.log('🤖 Calling OpenAI for command processing...');
		const response = await bot.processCommand(text);
		console.log('✅ OpenAI response received:', response.substring(0, 200) + (response.length > 200 ? '...' : ''));

		// Send response back to Slack
		const slackResponse = {
			response_type: 'in_channel',
			text: response,
		};
		console.log('📤 Sending response to Slack:', slackResponse);

		return new Response(JSON.stringify(slackResponse), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('💥 Error processing chores command:', error);
		const errorResponse = {
			response_type: 'ephemeral',
			text: 'Sorry, I encountered an error processing your request. Please try again.',
		};
		console.log('📤 Sending error response to Slack:', errorResponse);

		return new Response(JSON.stringify(errorResponse), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

async function handleSlackEvent(data: any, env: Env): Promise<Response> {
	const event = data.event;
	console.log('📨 Processing Slack event:', {
		event_type: event.type,
		user: event.user,
		channel: event.channel,
		has_bot_id: !!event.bot_id,
		subtype: event.subtype,
		timestamp: new Date().toISOString(),
	});

	// Ignore bot messages to prevent loops
	if (event.bot_id || event.subtype === 'bot_message') {
		console.log('🤖 Ignoring bot message to prevent loops');
		return new Response('OK', { status: 200 });
	}

	// Handle mentions or direct messages
	if (event.type === 'message' && (event.text?.includes('<@') || event.channel_type === 'im')) {
		console.log('💬 Processing mention or DM:', {
			text: event.text?.substring(0, 100) + (event.text?.length > 100 ? '...' : ''),
			is_mention: event.text?.includes('<@'),
			is_dm: event.channel_type === 'im',
		});

		try {
			const bot = new ChoreBot(env);
			console.log('🤖 Calling OpenAI for message processing...');
			const response = await bot.processMessage(event.text, event.user);
			console.log('✅ OpenAI response for message:', response.substring(0, 200) + (response.length > 200 ? '...' : ''));

			// Send response to Slack
			console.log('📤 Sending message response to Slack channel:', event.channel);
			await sendSlackMessage(env.SLACK_BOT_TOKEN, event.channel, response);
			console.log('✅ Message sent successfully to Slack');
		} catch (error) {
			console.error('💥 Error handling Slack event:', error);
		}
	} else {
		console.log('ℹ️ Event not processed - not a mention or DM');
	}

	return new Response('OK', { status: 200 });
}

export async function sendSlackMessage(token: string, channel: string, text: string): Promise<void> {
	console.log('📨 Sending message to Slack:', {
		channel: channel,
		textLength: text.length,
		textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
		timestamp: new Date().toISOString(),
	});

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

	console.log('📤 Slack API response:', {
		status: response.status,
		statusText: response.statusText,
		ok: response.ok,
	});

	if (!response.ok) {
		const error = await response.text();
		console.error('💥 Failed to send Slack message:', error);
		throw new Error(`Failed to send Slack message: ${error}`);
	}

	console.log('✅ Message sent to Slack successfully');
}
