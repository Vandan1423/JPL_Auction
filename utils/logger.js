// Console-only logger. Nothing is written to disk: hosting platforms capture
// stdout/stderr, and auction data itself lives in MongoDB.

const COLORS = {
	INFO: '\x1b[36m', // Cyan
	WARN: '\x1b[33m', // Yellow
	ERROR: '\x1b[31m', // Red
	DEBUG: '\x1b[35m', // Magenta
	AUCTION: '\x1b[32m', // Green
	RESET: '\x1b[0m',
};

/**
 * Log a message with level and optional data
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG, AUCTION)
 * @param {string} message - Log message
 * @param {Object} data - Additional data to log
 */
function log(level, message, data = {}) {
	if (level === 'DEBUG' && process.env.DEBUG_LOG !== 'true') return;

	const timestamp = new Date().toISOString();
	const color = COLORS[level] || COLORS.INFO;
	const write = level === 'ERROR' ? console.error : console.log;
	const extra = data && Object.keys(data).length > 0 ? data : '';
	write(`${color}[${timestamp}] [${level}]${COLORS.RESET} ${message}`, extra);
}

export default {
	info: (message, data) => log('INFO', message, data),
	warn: (message, data) => log('WARN', message, data),
	error: (message, data) => log('ERROR', message, data),
	debug: (message, data) => log('DEBUG', message, data),
	auction: (event, details) => log('AUCTION', event, details),
};
