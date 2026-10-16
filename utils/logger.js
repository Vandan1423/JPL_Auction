import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, '../logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Log a message with level and optional data
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
 * @param {string} message - Log message
 * @param {Object} data - Additional data to log
 */
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        data
    };
    
    // Console log with color coding
    const colors = {
        INFO: '\x1b[36m',    // Cyan
        WARN: '\x1b[33m',    // Yellow
        ERROR: '\x1b[31m',   // Red
        DEBUG: '\x1b[35m',   // Magenta
        RESET: '\x1b[0m'     // Reset
    };
    
    const color = colors[level] || colors.INFO;
    console.log(`${color}[${timestamp}] [${level}]${colors.RESET} ${message}`, Object.keys(data).length > 0 ? data : '');
    
    // File log (only in production or when DEBUG is enabled)
    if (process.env.NODE_ENV === 'production' || process.env.DEBUG_LOG === 'true') {
        try {
            const logFile = path.join(logsDir, `${new Date().toISOString().split('T')[0]}.log`);
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (err) {
            console.error('Failed to write to log file:', err.message);
        }
    }
}

/**
 * Log auction-specific events
 * @param {string} event - Event name
 * @param {Object} details - Event details
 */
function logAuctionEvent(event, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        event,
        details
    };
    
    console.log(`[${timestamp}] [AUCTION] ${event}`, details);
    
    // Always log auction events to file
    try {
        const auctionLogFile = path.join(logsDir, `auction-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(auctionLogFile, JSON.stringify(logEntry) + '\n');
    } catch (err) {
        console.error('Failed to write auction log:', err.message);
    }
}

/**
 * Clean up old log files (older than 30 days)
 */
function cleanupOldLogs() {
    try {
        const files = fs.readdirSync(logsDir);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        files.forEach(file => {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime < thirtyDaysAgo) {
                fs.unlinkSync(filePath);
                console.log(`Deleted old log file: ${file}`);
            }
        });
    } catch (err) {
        console.error('Failed to cleanup old logs:', err.message);
    }
}

export default {
    info: (message, data) => log('INFO', message, data),
    warn: (message, data) => log('WARN', message, data),
    error: (message, data) => log('ERROR', message, data),
    debug: (message, data) => log('DEBUG', message, data),
    auction: logAuctionEvent,
    cleanup: cleanupOldLogs
};
