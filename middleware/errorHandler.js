// Global error handler middleware

/**
 * Global error handler
 * @param {Error} err - Error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
function errorHandler(err, req, res, next) {
    console.error('Error:', err);
    
    // Log to file in production
    if (process.env.NODE_ENV === 'production') {
        logError(err);
    }
    
    // Mongoose validation error
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: 'Validation Error',
            errors: Object.values(err.errors).map(e => e.message)
        });
    }
    
    // Mongoose duplicate key error
    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return res.status(400).json({
            success: false,
            message: `Duplicate ${field} - This value already exists`
        });
    }
    
    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
    
    // Token expired error
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expired'
        });
    }
    
    // Cast error (invalid ObjectId)
    if (err.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'Invalid ID format'
        });
    }
    
    // Check if it's an API request
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(err.status || 500).json({
            success: false,
            message: err.message || 'Internal Server Error'
        });
    }
    
    // Default error page
    res.status(err.status || 500).render('error', {
        title: `Error ${err.status || 500}`,
        message: err.message || 'Internal Server Error',
        showNav: false
    });
}

/**
 * 404 handler - must be placed after all routes
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
function notFoundHandler(req, res, next) {
    // Check if it's an API request
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({
            success: false,
            message: 'Resource not found'
        });
    }
    
    res.status(404).render('error', {
        title: '404 - Not Found',
        message: 'The page you are looking for does not exist',
        showNav: false
    });
}

/**
 * Async error wrapper - wraps async functions to catch errors
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Wrapped function
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Log error to console/file
 * @param {Error} err - Error to log
 */
function logError(err) {
    // In production, you might want to use a logging service
    console.error('Production Error:', {
        message: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
    });
}

export {
    errorHandler,
    notFoundHandler,
    asyncHandler
};
