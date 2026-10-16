// Global error and 404 handlers.

const wantsJson = (req) => req.xhr || req.headers.accept?.includes('application/json') || req.originalUrl.includes('/api/');

/**
 * Global error handler
 * @param {Error} err - Error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
function errorHandler(err, req, res, next) {
	if (res.headersSent) return next(err);

	let status = err.status || 500;
	let message = err.message || 'Internal Server Error';

	if (err.name === 'ValidationError') {
		status = 400;
		message = Object.values(err.errors).map((e) => e.message).join(', ');
	} else if (err.code === 11000) {
		status = 400;
		message = `Duplicate ${Object.keys(err.keyPattern || {})[0] || 'value'}: this value already exists`;
	} else if (err.name === 'CastError') {
		status = 400;
		message = 'Invalid ID format';
	}

	// Expected failures (e.g. an invalid bid) are not crashes; don't log stack traces for them.
	if (!err.expected && status >= 500) console.error('Error:', err);

	if (wantsJson(req)) {
		return res.status(status).json({ success: false, message });
	}

	res.status(status).render('error', {
		title: `Error ${status}`,
		message,
		showNav: false,
	});
}

/**
 * 404 handler - must be placed after all routes
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
function notFoundHandler(req, res) {
	if (wantsJson(req)) {
		return res.status(404).json({ success: false, message: 'Resource not found' });
	}

	res.status(404).render('error', {
		title: '404 - Not Found',
		message: 'The page you are looking for does not exist',
		showNav: false,
	});
}

/**
 * Async error wrapper - forwards rejected promises to the error handler
 * @param {Function} fn - Async route handler
 * @returns {Function} - Wrapped handler
 */
function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

export { errorHandler, notFoundHandler, asyncHandler };
