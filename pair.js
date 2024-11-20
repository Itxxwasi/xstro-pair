import { Boom } from '@hapi/boom';
import Baileys, { DisconnectReason, delay, Browsers, makeCacheableSignalKeyStore, useMultiFileAuthState, fetchLatestBaileysVersion } from 'baileys';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path, { dirname } from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { cleanPhoneNumber, upload } from './utils.js';

const app = express();

app.use((req, res, next) => {
	res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
	next();
});

app.use(cors());

const PORT = process.env.PORT || 8000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(path.join(__dirname, 'web')));

let sessionDir = `./auth`;
if (fs.existsSync(sessionDir)) fs.rmdirSync(sessionDir, { recursive: true });

const clearSession = () => {
	fs.rmdirSync(sessionDir, { recursive: true });
};

function removeSessionFolder() {
	if (!fs.existsSync(sessionDir)) return;
	fs.rmdirSync(sessionDir, { recursive: true });
}

app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'web'));
});

app.get('/pair', async (req, res) => {
	const phone = req.query.phone;

	if (!phone) return res.json({ error: 'Please provide a phone number' });
	const code = await initiatePairing(phone);
	res.json({ code: code });
});

async function initiatePairing(phone) {
	return new Promise(async (resolve, reject) => {
		if (!fs.existsSync(path.dirname(sessionDir))) {
			fs.mkdirSync(path.dirname(sessionDir), { recursive: true });
		}

		const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
		const { version, isLatest } = await fetchLatestBaileysVersion();
		const conn = Baileys.makeWASocket({
			version: version,
			printQRInTerminal: false,
			logger: pino({
				level: 'silent',
			}),
			browser: Browsers.macOS('Safari'),
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(
					state.keys,
					pino().child({
						level: 'fatal',
						stream: 'store',
					}),
				),
			},
		});

		if (!conn.authState.creds.registered) {
			let formattedPhone = cleanPhoneNumber(phone);
			if (formattedPhone.length < 11) return reject(new Error('Please enter your number with country code.'));

			setTimeout(async () => {
				let code = await conn.requestPairingCode(formattedPhone);
				console.log(`Your pairing code: ${code}`);
				resolve(code);
			}, 3000);
		}

		conn.ev.on('creds.update', saveCreds);

		conn.ev.on('connection.update', async update => {
			const { connection, lastDisconnect } = update;

			if (connection === 'open') {
				await delay(10000);
				const uploadData = await upload(sessionDir);
				const msg = await conn.sendMessage(conn.user.id, { text: uploadData });
				await delay(2000);
				await conn.sendMessage(conn.user.id, { text: '```PAIRING SUCCESS```\n\n```USE THE ABOVE CODE FOR YOUR DEPLOYMENT, LAST FOR 2WKS```' }, { quoted: msg });
				console.log('Connected to WhatsApp Servers');
				removeSessionFolder();
				process.send('reset');
			}

			if (connection === 'close') {
				let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
				console.log('Connection closed:', reason);
				if (reason === DisconnectReason.connectionClosed) {
					console.log('[Connection closed, reconnecting....!]');
					process.send('reset');
				} else if (reason === DisconnectReason.connectionLost) {
					console.log('[Connection lost from server, reconnecting....!]');
					process.send('reset');
				} else if (reason === DisconnectReason.loggedOut) {
					clearSession();
					console.log('[Device logged out, please try to login again....!]');
					process.send('reset');
				} else if (reason === DisconnectReason.restartRequired) {
					console.log('[Server restarting....!]');
					initiatePairing();
				} else if (reason === DisconnectReason.timedOut) {
					console.log('[Connection timed out, trying to reconnect....!]');
					process.send('reset');
				} else if (reason === DisconnectReason.badSession) {
					console.log('[Bad session exists, trying to reconnect....!]');
					clearSession();
					process.send('reset');
				} else if (reason === DisconnectReason.connectionReplaced) {
					console.log(`[Connection replaced, trying to reconnect....!]`);
					process.send('reset');
				} else {
					console.log('[Server disconnected: Maybe your WhatsApp account got messed up....!]');
					process.send('reset');
				}
			}
		});

		conn.ev.on('messages.upsert', () => {});
	});
}

app.listen(PORT, () => {
	console.log(`API running on port: ${PORT}`);
});
