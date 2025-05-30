/**
 * Chore-Bot - AI-powered Slack bot for managing household chore rotations
 *
 * Built with Cloudflare Workers, OpenAI GPT-4, and Google Calendar integration
 */

import { Env } from './types';
import { StateDO } from './state';
import { handleSlackWebhook } from './slack';
import { handleScheduledReminder } from './scheduler';

export { StateDO };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		console.log('🌐 Incoming request:', {
			method: request.method,
			pathname: url.pathname,
			origin: request.headers.get('origin'),
			userAgent: request.headers.get('user-agent'),
			timestamp: new Date().toISOString(),
		});

		try {
			// Handle different routes
			switch (url.pathname) {
				case '/slack':
					console.log('🎯 Routing to Slack webhook handler');
					return handleSlackWebhook(request, env, ctx);
				case '/health':
					console.log('💚 Health check requested');
					return new Response('OK', { status: 200 });
				default:
					console.log('❓ Unknown route:', url.pathname);
					return new Response('Not Found', { status: 404 });
			}
		} catch (error) {
			console.error('💥 Request handling error:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log('⏰ Cron trigger fired:', {
			scheduledTime: new Date(controller.scheduledTime).toISOString(),
			actualTime: new Date().toISOString(),
			cron: controller.cron,
		});

		try {
			await handleScheduledReminder(env);
		} catch (error) {
			console.error('💥 Scheduled handler error:', error);
		}
	},
};
