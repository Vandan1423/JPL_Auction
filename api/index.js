// Vercel serverless entry: every request that isn't a static file in public/
// is handled by the Express app (see vercel.json).
import app from '../app.js';

export default app;
