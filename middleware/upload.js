import multer from 'multer';

// Files are held in memory only long enough to process them (images go to
// Cloudinary, spreadsheets are parsed); nothing is written inside the project.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SHEET_BYTES = 5 * 1024 * 1024;

const SHEET_TYPES = new Set([
	'text/csv',
	'application/csv',
	'text/plain',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const images = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_IMAGE_BYTES, files: 60 },
	fileFilter: (_req, file, cb) => {
		if (file.mimetype?.startsWith('image/')) return cb(null, true);
		const error = new Error(`"${file.originalname}" is not an image`);
		error.code = 'NOT_AN_IMAGE';
		cb(error);
	},
});

const spreadsheets = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_SHEET_BYTES, files: 1 },
	fileFilter: (_req, file, cb) => {
		const name = file.originalname?.toLowerCase() || '';
		if (SHEET_TYPES.has(file.mimetype) || name.endsWith('.csv') || name.endsWith('.xlsx')) return cb(null, true);
		const error = new Error('Upload an Excel (.xlsx) or CSV (.csv) file');
		error.code = 'NOT_A_SPREADSHEET';
		cb(error);
	},
});

const describe = (error) => {
	if (error.code === 'LIMIT_FILE_SIZE') return 'That file is too large';
	if (error.code === 'LIMIT_FILE_COUNT') return 'Too many files in one upload';
	return error.message || 'Upload failed';
};

/**
 * Wrap a multer handler so upload problems become `req.uploadError` (a
 * friendly message) instead of crashing the request. Controllers decide how
 * to show it.
 */
const tolerant = (handler) => (req, res, next) => {
	handler(req, res, (error) => {
		if (error) req.uploadError = describe(error);
		next();
	});
};

/** Accept any image fields; controllers pick files by field name. */
export const acceptImages = () => tolerant(images.any());

/** Accept a single spreadsheet in the "file" field. */
export const acceptSpreadsheet = () => tolerant(spreadsheets.single('file'));

/** Find an uploaded file by its form field name. */
export const fileFor = (req, fieldName) => (req.files || []).find((f) => f.fieldname === fieldName) || null;
