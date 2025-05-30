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
					description: 'Read the current chore state description - a comprehensive text description of the household chore situation',
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
					name: 'updateState',
					description: 'Update the chore state with a new comprehensive description of the household chore situation',
					parameters: {
						type: 'object',
						properties: {
							description: {
								type: 'string',
								description:
									'A detailed text description of the current chore state including who is responsible, rotation order, specific chores, schedules, temporary arrangements, etc.',
							},
						},
						required: ['description'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'createCalendarEvent',
					description: 'Create a calendar event for chore reminders or scheduling',
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
		return `You are ChoreBot, an intelligent household chore management assistant. You help manage and coordinate household responsibilities with flexibility and understanding.

## Your Capabilities:
- **State Management**: Read and update comprehensive text descriptions of the current chore situation
- **Flexible Organization**: Handle rotating schedules, temporary swaps, additions/removals, and complex arrangements
- **Calendar Integration**: Create reminders and schedule chore-related events
- **Natural Communication**: Understand and respond to requests in natural language

## State Management Philosophy:
- The chore state is a detailed text description that captures ALL relevant information
- Include who is responsible, rotation order, specific chores, schedules, temporary arrangements, history, etc.
- Be comprehensive but readable - think of it as documentation a human would write
- Update the state whenever changes are made to keep it current and accurate

## Formatting Guidelines:
- Use single asterisks (*) for bold text, NOT double asterisks (**)
- Include appropriate line breaks for readability
- Format lists clearly with numbers or bullets
- Keep formatting consistent with Slack markdown standards

## Interaction Style:
- Be helpful, understanding, and accommodating
- Handle complex requests that might involve multiple steps or considerations
- Ask clarifying questions when needed
- Provide clear confirmations of changes made
- Be proactive in suggesting improvements or handling edge cases

## Key Functions:
1. **readState()** - Get the current detailed state description
2. **updateState(description)** - Update with new comprehensive state description  
3. **createCalendarEvent()** - Schedule chore-related events

## Guidelines:
- Always read the current state before making changes
- Think through the full implications of requests
- Update the state description to reflect all changes accurately
- Be flexible and creative in problem-solving
- Consider both immediate needs and long-term organization

Current date: ${new Date().toISOString()}

Remember: You can use multiple tool calls to gather information, analyze the situation, and make comprehensive updates. Take your time to fully understand and address each request.`;
	}

	async processCommand(text: string): Promise<string> {
		return this.processWithAgenticLoop(`Slash command: /rusty ${text}`);
	}

	async processMessage(text: string, userId?: string): Promise<string> {
		return this.processWithAgenticLoop(`Message from user ${userId ? userId : 'unknown'}: ${text}`);
	}

	private async processWithAgenticLoop(userMessage: string): Promise<string> {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: 'system', content: this.getSystemPrompt() },
			{ role: 'user', content: userMessage },
		];

		const maxIterations = 5; // Prevent infinite loops
		let iteration = 0;

		try {
			while (iteration < maxIterations) {
				iteration++;

				const completion = await this.openai.chat.completions.create({
					model: 'gpt-4o',
					messages,
					tools: this.getTools(),
					tool_choice: 'auto',
				});

				const choice = completion.choices[0];
				const finishReason = choice.finish_reason;
				const assistantMsg = choice.message;

				// Assistant is done - return final response
				if (finishReason === 'stop') {
					return assistantMsg.content || "I've completed your request. Is there anything else you'd like me to help with?";
				}

				// Assistant requested tool calls
				if (finishReason === 'tool_calls' && assistantMsg.tool_calls) {
					// Add the assistant's message to conversation
					messages.push(assistantMsg);

					// Execute each tool call
					for (const toolCall of assistantMsg.tool_calls) {
						try {
							const toolOutput = await this.runTool(toolCall);

							// Add tool result to conversation
							messages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: toolOutput,
							});
						} catch (error) {
							console.error(`Tool execution error for ${toolCall.function.name}:`, error);
							messages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: `Error executing ${toolCall.function.name}: ${error}`,
							});
						}
					}

					// Continue the loop to let the model process tool results
					continue;
				}

				// Handle other finish reasons
				if (finishReason === 'length') {
					return "I need to continue this conversation, but I've reached the length limit. Could you please restate your request?";
				}

				// Fallback for unexpected finish reasons
				break;
			}

			// If we exit the loop without a final response
			return "I've processed your request with multiple steps. The chore state has been updated as needed. Is there anything specific you'd like me to clarify?";
		} catch (error) {
			console.error('Agentic loop error:', error);
			return "I'm experiencing some technical difficulties. Please try your request again.";
		}
	}

	private async runTool(toolCall: any): Promise<string> {
		const functionName = toolCall.function.name;
		const args = JSON.parse(toolCall.function.arguments);

		switch (functionName) {
			case 'readState':
				return await this.readState();
			case 'updateState':
				return await this.updateState(args.description);
			case 'createCalendarEvent':
				return await this.createCalendarEventTool(args);
			default:
				throw new Error(`Unknown function: ${functionName}`);
		}
	}

	private async readState(): Promise<string> {
		const stateId = this.env.STATE.idFromName('chore-state');
		const stateStub = this.env.STATE.get(stateId);
		const response = await stateStub.fetch(new Request('http://localhost/read'));
		const state: ChoreState = await response.json();

		return `Current chore state (last updated: ${new Date(state.lastUpdated).toLocaleString()}):

${state.description}`;
	}

	private async updateState(description: string): Promise<string> {
		const stateId = this.env.STATE.idFromName('chore-state');
		const stateStub = this.env.STATE.get(stateId);

		const newState: ChoreState = {
			description,
			lastUpdated: new Date().toISOString(),
		};

		await stateStub.fetch(
			new Request('http://localhost/write', {
				method: 'POST',
				body: JSON.stringify(newState),
			})
		);

		return `✅ Chore state updated successfully at ${new Date().toLocaleString()}`;
	}

	private async createCalendarEventTool(args: {
		summary: string;
		description?: string;
		startDateTime: string;
		endDateTime: string;
	}): Promise<string> {
		try {
			const accessToken = await getGoogleAccessToken(this.env.GCP_SERVICE_ACCOUNT);

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

			return `📅 Calendar event created: "${args.summary}" scheduled for ${new Date(args.startDateTime).toLocaleString()}`;
		} catch (error) {
			console.error('Calendar creation error:', error);
			return `❌ Failed to create calendar event: ${error}`;
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

			// Generate reminder using the agentic system
			const reminderResponse = await this.processWithAgenticLoop(
				'Generate a daily reminder message based on the current chore state. Be specific about who needs to do what today.'
			);

			// Update state to mark reminder as sent
			const updatedState: ChoreState = {
				...state,
				lastSent: now.toISOString(),
			};

			await stateStub.fetch(
				new Request('http://localhost/write', {
					method: 'POST',
					body: JSON.stringify(updatedState),
				})
			);

			console.log('Scheduled reminder generated:', reminderResponse);
		} catch (error) {
			console.error('Error sending scheduled reminder:', error);
		}
	}
}
