import OpenAI from 'openai';
import { Env, OpenAITool, ChoreState, CalendarEvent } from './types';
import { getGoogleAccessToken, createCalendarEvent } from './utils';

export class ChoreBot {
	private openai: OpenAI;
	private env: Env;

	constructor(env: Env) {
		this.env = env;
		this.openai = new OpenAI({
			apiKey: env.OPENAI_API_KEY,
		});
	}

	private getTools(): OpenAITool[] {
		return [
			{
				type: 'function',
				function: {
					name: 'readState',
					description: "Read the current chore rotation state including who's next, chore list, and last update time",
					parameters: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'writeState',
					description: 'Update the chore rotation state with new assignments, rotation order, or chore list',
					parameters: {
						type: 'object',
						properties: {
							rotation: {
								type: 'array',
								items: { type: 'string' },
								description: 'Array of user names in rotation order',
							},
							currentIndex: {
								type: 'number',
								description: 'Index of current person responsible for chores',
							},
							chores: {
								type: 'array',
								items: { type: 'string' },
								description: 'List of chores to be done',
							},
						},
						required: [],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'createCalendarEvent',
					description: 'Create a calendar event for chore reminders',
					parameters: {
						type: 'object',
						properties: {
							summary: {
								type: 'string',
								description: 'Event title/summary',
							},
							description: {
								type: 'string',
								description: 'Event description with chore details',
							},
							startDateTime: {
								type: 'string',
								description: 'ISO 8601 datetime string for event start',
							},
							endDateTime: {
								type: 'string',
								description: 'ISO 8601 datetime string for event end',
							},
						},
						required: ['summary', 'startDateTime', 'endDateTime'],
					},
				},
			},
		];
	}

	private getSystemPrompt(): string {
		return `You are ChoreBot, a helpful assistant that manages household chore rotations and schedules.

Your capabilities:
1. Read and update chore rotation state (who's next, chore lists, rotation order)
2. Create calendar events for chore reminders
3. Answer questions about current assignments and schedules

Always respond in a friendly, helpful tone. When updating schedules or assignments, confirm the changes clearly.

For all tool responses, format them as natural conversational responses that would be appropriate for Slack.

Current date: ${new Date().toISOString()}`;
	}

	async processCommand(text: string): Promise<string> {
		try {
			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4',
				messages: [
					{ role: 'system', content: this.getSystemPrompt() },
					{ role: 'user', content: `Slash command: /chores ${text}` },
				],
				tools: this.getTools(),
				tool_choice: 'auto',
			});

			const message = completion.choices[0].message;

			if (message.tool_calls) {
				return await this.handleToolCalls(message.tool_calls);
			}

			return message.content || "I'm not sure how to help with that. Try asking about current chores or updating the rotation.";
		} catch (error) {
			console.error('OpenAI API error:', error);
			return "Sorry, I'm having trouble processing your request right now. Please try again later.";
		}
	}

	async processMessage(text: string, userId?: string): Promise<string> {
		try {
			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4',
				messages: [
					{ role: 'system', content: this.getSystemPrompt() },
					{ role: 'user', content: `Message from user ${userId}: ${text}` },
				],
				tools: this.getTools(),
				tool_choice: 'auto',
			});

			const message = completion.choices[0].message;

			if (message.tool_calls) {
				return await this.handleToolCalls(message.tool_calls);
			}

			return message.content || "I'm here to help with chore management! Ask me about current assignments or updating the rotation.";
		} catch (error) {
			console.error('OpenAI API error:', error);
			return "Sorry, I'm having trouble right now. Please try again later.";
		}
	}

	async sendScheduledReminder(): Promise<void> {
		try {
			// Get current state
			const stateId = this.env.STATE.idFromName('chore-state');
			const stateStub = this.env.STATE.get(stateId);
			const stateResponse = await stateStub.fetch(new Request('http://localhost/read'));
			const state: ChoreState = await stateResponse.json();

			// Check if we need to send a reminder
			const now = new Date();
			const lastSent = state.lastSent ? new Date(state.lastSent) : null;

			// Only send if we haven't sent today
			if (lastSent && lastSent.toDateString() === now.toDateString()) {
				console.log('Reminder already sent today, skipping');
				return;
			}

			// Generate reminder message
			const currentPerson = state.rotation[state.currentIndex];
			const choresText = state.chores.join(', ');

			const reminderText = `🏠 Daily Chore Reminder!\n\nHi ${currentPerson}! It's your turn for chores today.\n\nToday's chores: ${choresText}\n\nReply to this message when you're done!`;

			// You would need to implement sending to a specific Slack channel here
			// For now, we'll just update the state to mark reminder as sent
			const updateData = {
				...state,
				lastSent: now.toISOString(),
			};

			await stateStub.fetch(
				new Request('http://localhost/write', {
					method: 'POST',
					body: JSON.stringify(updateData),
				})
			);

			console.log(`Reminder sent for ${currentPerson}`);
		} catch (error) {
			console.error('Error sending scheduled reminder:', error);
		}
	}

	private async handleToolCalls(toolCalls: any[]): Promise<string> {
		const results: string[] = [];

		for (const toolCall of toolCalls) {
			const functionName = toolCall.function.name;
			const args = JSON.parse(toolCall.function.arguments);

			try {
				switch (functionName) {
					case 'readState':
						results.push(await this.readState());
						break;
					case 'writeState':
						results.push(await this.writeState(args));
						break;
					case 'createCalendarEvent':
						results.push(await this.createCalendarEventTool(args));
						break;
					default:
						results.push(`Unknown function: ${functionName}`);
				}
			} catch (error) {
				console.error(`Error executing ${functionName}:`, error);
				results.push(`Error executing ${functionName}: ${error}`);
			}
		}

		return results.join('\n\n');
	}

	private async readState(): Promise<string> {
		const stateId = this.env.STATE.idFromName('chore-state');
		const stateStub = this.env.STATE.get(stateId);
		const response = await stateStub.fetch(new Request('http://localhost/read'));
		const state: ChoreState = await response.json();

		const currentPerson = state.rotation[state.currentIndex] || 'No one assigned';
		const nextIndex = (state.currentIndex + 1) % state.rotation.length;
		const nextPerson = state.rotation[nextIndex] || 'No one next';

		return `📋 **Current Chore Status**
👤 **Current:** ${currentPerson}
👤 **Next:** ${nextPerson}
🏠 **Chores:** ${state.chores.join(', ')}
🔄 **Rotation:** ${state.rotation.join(' → ')}
⏰ **Last Updated:** ${new Date(state.lastUpdated).toLocaleDateString()}`;
	}

	private async writeState(updates: Partial<ChoreState>): Promise<string> {
		const stateId = this.env.STATE.idFromName('chore-state');
		const stateStub = this.env.STATE.get(stateId);

		// Get current state first
		const currentResponse = await stateStub.fetch(new Request('http://localhost/read'));
		const currentState: ChoreState = await currentResponse.json();

		// Merge updates
		const newState: ChoreState = {
			...currentState,
			...updates,
			lastUpdated: new Date().toISOString(),
		};

		// Write back
		await stateStub.fetch(
			new Request('http://localhost/write', {
				method: 'POST',
				body: JSON.stringify(newState),
			})
		);

		return `✅ **State Updated Successfully**
${updates.rotation ? `🔄 Rotation updated: ${updates.rotation.join(' → ')}` : ''}
${updates.chores ? `🏠 Chores updated: ${updates.chores.join(', ')}` : ''}
${updates.currentIndex !== undefined ? `👤 Current person: ${newState.rotation[newState.currentIndex]}` : ''}`;
	}

	private async createCalendarEventTool(args: {
		summary: string;
		description?: string;
		startDateTime: string;
		endDateTime: string;
	}): Promise<string> {
		try {
			const accessToken = await getGoogleAccessToken(this.env.GCP_SERVICE_ACCOUNT);

			// Convert to proper CalendarEvent structure
			const event: CalendarEvent = {
				summary: args.summary,
				description: args.description,
				start: {
					dateTime: args.startDateTime,
					timeZone: 'America/New_York', // TODO: Make configurable
				},
				end: {
					dateTime: args.endDateTime,
					timeZone: 'America/New_York',
				},
			};

			const response = await createCalendarEvent(accessToken, 'primary', event);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Calendar API error: ${errorText}`);
			}

			return `📅 **Calendar Event Created**
📝 ${args.summary}
🕐 ${new Date(args.startDateTime).toLocaleString()}`;
		} catch (error) {
			console.error('Calendar creation error:', error);
			return `❌ Failed to create calendar event: ${error}`;
		}
	}
}
