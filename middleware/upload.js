import multer from 'multer';

// Files are held in memory only long enough to stream them to Cloudinary;
// nothing is ever written inside the project folder.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

const describe = (error) => {
	if (error.code === 'LIMIT_FILE_SIZE') return 'Each image must be 8 MB or smaller';
	if (error.code === 'LIMIT_FILE_COUNT') return 'Too many images in one upload';
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

/** Find an uploaded file by its form field name. */
export const fileFor = (req, fieldName) => (req.files || []).find((f) => f.fieldname === fieldName) || null;
