import { Env } from './types';
import { ChoreBot } from './openai';

export async function handleScheduledReminder(env: Env): Promise<void> {
	try {
		console.log('📅 Executing scheduled reminder...');
		const bot = new ChoreBot(env);
		await bot.sendScheduledReminder();
		console.log('✅ Scheduled reminder completed successfully');
	} catch (error) {
		console.error('💥 Error sending scheduled reminder:', error);
	}
}
