import { CalendarEvent, Env } from './types';

/**
 * Verify Slack request signature
 */
export async function verifySlackSignature(request: Request, signingSecret: string, body: string): Promise<boolean> {
	const timestamp = request.headers.get('X-Slack-Request-Timestamp');
	const signature = request.headers.get('X-Slack-Signature');

	if (!timestamp || !signature) {
		return false;
	}

	// Check if request is too old (more than 5 minutes)
	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - parseInt(timestamp)) > 300) {
		return false;
	}

	// Create the signature base string
	const sigBaseString = `v0:${timestamp}:${body}`;

	// Create HMAC
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const signature_bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBaseString));

	// Convert to hex
	const computed_signature =
		'v0=' +
		Array.from(new Uint8Array(signature_bytes))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

	return computed_signature === signature;
}

/**
 * Send message to Slack
 */
export async function sendSlackMessage(token: string, channel: string, text: string, blocks?: any[]): Promise<Response> {
	const payload: any = {
		channel,
		text,
	};

	if (blocks) {
		payload.blocks = blocks;
	}

	return fetch('https://slack.com/api/chat.postMessage', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
}

/**
 * Get Google Calendar access token using service account
 */
export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
	const serviceAccount = JSON.parse(serviceAccountJson);

	// Create JWT
	const header = {
		alg: 'RS256',
		typ: 'JWT',
	};

	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iss: serviceAccount.client_email,
		scope: 'https://www.googleapis.com/auth/calendar',
		aud: 'https://oauth2.googleapis.com/token',
		exp: now + 3600,
		iat: now,
	};

	// Import private key
	const privateKey = await crypto.subtle.importKey(
		'pkcs8',
		pemToArrayBuffer(serviceAccount.private_key),
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: 'SHA-256',
		},
		false,
		['sign']
	);

	// Create JWT
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signatureInput = `${encodedHeader}.${encodedPayload}`;

	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signatureInput));

	const encodedSignature = base64UrlEncode(signature);
	const jwt = `${signatureInput}.${encodedSignature}`;

	// Exchange JWT for access token
	const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	});

	const tokenData = (await tokenResponse.json()) as { access_token: string };
	return tokenData.access_token;
}

/**
 * Create Google Calendar event
 */
export async function createCalendarEvent(accessToken: string, calendarId: string, event: CalendarEvent): Promise<Response> {
	return fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(event),
	});
}

/**
 * Helper functions for JWT creation
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
	const b64 = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s/g, '');

	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

function base64UrlEncode(data: string | ArrayBuffer): string {
	let base64: string;

	if (typeof data === 'string') {
		base64 = btoa(data);
	} else {
		const bytes = new Uint8Array(data);
		const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
		base64 = btoa(binary);
	}

	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Parse Slack command text and extract user mentions
 */
export function parseSlackText(text: string): {
	cleanText: string;
	mentions: string[];
} {
	const mentionRegex = /<@([A-Z0-9]+)>/g;
	const mentions: string[] = [];
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		mentions.push(match[1]);
	}

	const cleanText = text.replace(mentionRegex, '').trim();

	return { cleanText, mentions };
}

/**
 * Format chore list for Slack display
 */
export function formatChoreList(chores: string[], currentPerson?: string): string {
	if (chores.length === 0) {
		return 'No chores configured yet.';
	}

	let formatted = '📋 *Current Chores:*\n';
	chores.forEach((chore, index) => {
		formatted += `${index + 1}. ${chore}\n`;
	});

	if (currentPerson) {
		formatted += `\n👤 *Current assignee:* <@${currentPerson}>`;
	}

	return formatted;
}

/**
 * Create Slack blocks for rich formatting
 */
export function createSlackBlocks(text: string, chores?: string[], currentPerson?: string): any[] {
	const blocks: any[] = [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: text,
			},
		},
	];

	if (chores && chores.length > 0) {
		const choreText = chores.map((chore, index) => `${index + 1}. ${chore}`).join('\n');
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `📋 *Chores:*\n${choreText}`,
			},
		});

		if (currentPerson) {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `👤 *Current assignee:* <@${currentPerson}>`,
				},
			});
		}
	}

	return blocks;
}
