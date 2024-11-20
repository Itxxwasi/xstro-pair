import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cluster from 'cluster';
import { watchFile, unwatchFile } from 'fs';
import { createInterface } from 'readline';
import yargs from 'yargs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rl = createInterface(process.stdin, process.stdout);

var isRunning = false;

function start(file) {
	if (isRunning) return;
	isRunning = true;
	let args = [join(__dirname, file), ...process.argv.slice(2)];

	cluster.setupMaster({
		exec: args[0],
		args: args.slice(1),
	});

	let p = cluster.fork(); 
	p.on('message', data => {
		switch (data) {
			case 'reset':
				p.process.kill();
				isRunning = false;
				start.apply(this, arguments);
				break;
			case 'uptime':
				p.send(process.uptime());
				break;
		}
	});

	p.on('exit', (_, code) => {
		isRunning = false;
		console.error('An Error occurred:', code);
		if (code === 0) return;
		watchFile(args[0], () => {
			unwatchFile(args[0]);
			start(file);
		});
	});

	let opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
	if (!opts['test'])
		if (!rl.listenerCount())
			rl.on('line', line => {
				p.emit('message', line.trim());
			});
}

start('pair.js');
