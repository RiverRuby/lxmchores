import { Env, SlackCommand } from './types';
import { verifySlackSignature } from './utils';
import { ChoreBot } from './openai';

export async function handleSlackWebhook(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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

	// Parse the request body based on content type
	const contentType = request.headers.get('content-type') || '';
	let data: any;

	if (contentType.includes('application/json')) {
		// Handle JSON data (for events and URL verification)
		console.log('📋 Parsing as JSON data');
		try {
			data = JSON.parse(body);
		} catch (error) {
			console.error('❌ Failed to parse JSON:', error);
			return new Response('Bad Request', { status: 400 });
		}
	} else if (contentType.includes('application/x-www-form-urlencoded')) {
		// Handle form-encoded data (for slash commands)
		console.log('📋 Parsing as form-encoded data');
		const params = new URLSearchParams(body);
		data = Object.fromEntries(params.entries());
	} else {
		// Try to parse as form data first (Slack commands), then fallback to JSON
		console.log('📋 Unknown content type, trying form-encoded first');
		try {
			const params = new URLSearchParams(body);
			data = Object.fromEntries(params.entries());
			console.log('✅ Successfully parsed as form data');
		} catch (error) {
			console.log('⚠️ Form parsing failed, trying JSON');
			try {
				data = JSON.parse(body);
				console.log('✅ Successfully parsed as JSON');
			} catch (jsonError) {
				console.error('❌ Failed to parse request body as either form or JSON:', error, jsonError);
				return new Response('Bad Request', { status: 400 });
			}
		}
	}

	console.log('📋 Parsed data:', data);

	// Handle URL verification (when setting up webhook)
	if (data.type === 'url_verification') {
		console.log('🔗 URL verification challenge received:', data.challenge);
		return new Response(data.challenge, {
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	// Handle slash command
	if (data.command === '/rusty') {
		console.log('⚡ Slash command received:', {
			command: data.command,
			text: data.text,
			user: data.user_name,
			channel: data.channel_name,
		});
		return handleChoresCommand(data as SlackCommand, env, ctx);
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

async function handleChoresCommand(command: SlackCommand, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const text = command.text?.trim() || '';
	console.log('🎯 Processing chores command:', {
		user: command.user_name,
		channel: command.channel_name,
		text: text,
		response_url: command.response_url,
		timestamp: new Date().toISOString(),
	});

	// Respond immediately to avoid Slack timeout
	const immediateResponse = {
		response_type: 'in_channel',
		text: '🤖 Processing your request...',
	};

	// Process the request asynchronously
	console.log('🚀 Starting async processing...');
	const asyncProcessing = (async () => {
		try {
			console.log('⏳ About to create ChoreBot instance...');
			const bot = new ChoreBot(env);
			console.log('✅ ChoreBot instance created successfully');

			console.log('🤖 Calling OpenAI API for command processing...');
			const startTime = Date.now();
			const response = await bot.processCommand(text);
			const endTime = Date.now();

			console.log('🎉 OpenAI API response received!', {
				responseLength: response.length,
				processingTimeMs: endTime - startTime,
				responsePreview: response.substring(0, 200) + (response.length > 200 ? '...' : ''),
				timestamp: new Date().toISOString(),
			});

			// Send the actual response using response_url
			const delayedResponse = {
				response_type: 'in_channel',
				text: response,
				replace_original: true,
			};

			console.log('📤 About to send delayed response to Slack via response_url:', {
				url: command.response_url,
				responseType: delayedResponse.response_type,
				replaceOriginal: delayedResponse.replace_original,
				textLength: delayedResponse.text.length,
			});

			const webhookResponse = await fetch(command.response_url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(delayedResponse),
			});

			console.log('📨 Webhook response received:', {
				status: webhookResponse.status,
				statusText: webhookResponse.statusText,
				ok: webhookResponse.ok,
				headers: Object.fromEntries(webhookResponse.headers.entries()),
			});

			if (!webhookResponse.ok) {
				const errorText = await webhookResponse.text();
				console.error('💥 Failed to send delayed response:', {
					status: webhookResponse.status,
					statusText: webhookResponse.statusText,
					errorText: errorText,
				});
			} else {
				console.log('✅ Delayed response sent successfully to Slack!');
			}
		} catch (error) {
			console.error('💥 Error in async processing:', {
				error: error,
				message: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
				timestamp: new Date().toISOString(),
			});

			// Send error response using response_url
			const errorResponse = {
				response_type: 'ephemeral',
				text: 'Sorry, I encountered an error processing your request. Please try again.',
				replace_original: true,
			};

			try {
				console.log('📤 Sending error response via response_url...');
				const errorWebhookResponse = await fetch(command.response_url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(errorResponse),
				});

				console.log('📨 Error webhook response:', {
					status: errorWebhookResponse.status,
					ok: errorWebhookResponse.ok,
				});

				if (errorWebhookResponse.ok) {
					console.log('✅ Error response sent via response_url');
				} else {
					console.error('💥 Failed to send error response via response_url:', await errorWebhookResponse.text());
				}
			} catch (webhookError) {
				console.error('💥 Failed to send error response via response_url:', webhookError);
			}
		}
	})();

	// Use ctx.waitUntil to ensure async processing continues after response is returned
	if (ctx) {
		console.log('⏰ Using ctx.waitUntil to ensure async processing continues...');
		ctx.waitUntil(asyncProcessing);
	} else {
		console.log('⚠️ No ExecutionContext provided, async processing may be terminated early');
	}

	console.log('⚡ Returning immediate response to prevent timeout');
	// Return immediate response to prevent timeout
	return new Response(JSON.stringify(immediateResponse), {
		headers: { 'Content-Type': 'application/json' },
	});
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
