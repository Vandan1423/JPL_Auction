import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { describeCloudinaryError } from '../services/cloudinary.js';

describe('describeCloudinaryError', () => {
	test('HTTP 420 is the hourly rate limit', () => {
		const info = describeCloudinaryError({ message: 'Rate Limit Exceeded', http_code: 420 });
		assert.equal(info.kind, 'rate');
		assert.match(info.message, /^Cloudinary limit reached/);
	});

	test('Admin API errors are nested under `error`', () => {
		const info = describeCloudinaryError({ error: { message: 'Rate Limit Exceeded', http_code: 420 } });
		assert.equal(info.kind, 'rate');
	});

	test('used-up credits are a quota limit', () => {
		for (const message of [
			'Your account has exceeded its usage limits',
			'Monthly usage limit reached. Please upgrade your plan',
			'Account is disabled due to quota',
		]) {
			const info = describeCloudinaryError({ message, http_code: 400 });
			assert.equal(info.kind, 'quota', message);
			assert.match(info.message, /^Cloudinary limit reached/);
		}
	});

	test('oversized files are not mistaken for a quota limit', () => {
		const info = describeCloudinaryError({ message: 'File size too large. Got 12582912. Maximum is 10485760.', http_code: 400 });
		assert.equal(info.kind, 'size');
		assert.equal(info.status, 413);
	});

	test('anything else keeps the original message', () => {
		const info = describeCloudinaryError({ message: 'Invalid image file', http_code: 400 });
		assert.equal(info.kind, 'other');
		assert.match(info.message, /Invalid image file/);
	});
});

describe('when Cloudinary refuses an upload for a plan limit', () => {
	test('the upload fails with a clear message and admin pages show the limit banner', async (t) => {
		// Dummy keys and a stubbed SDK: nothing here touches the network.
		Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret' });
		delete process.env.CLOUDINARY_URL;
		const { v2: sdk } = await import('cloudinary');
		t.mock.method(sdk.uploader, 'upload_stream', (options, callback) => ({
			end: () => callback({ message: 'Your account has exceeded its monthly usage limits', http_code: 400 }),
		}));
		t.mock.method(sdk.api, 'usage', async () => ({ plan: 'Free', credits: { usage: 25.4, limit: 25, used_percent: 101.6 } }));

		const { uploadImage, getCloudinaryNotice } = await import('../services/cloudinary.js');
		await assert.rejects(uploadImage(Buffer.from('x'), { tournamentId: 't1', kind: 'players' }), (error) => {
			assert.match(error.message, /^Cloudinary limit reached/);
			assert.equal(error.cloudinaryLimit, true);
			return true;
		});

		const notice = getCloudinaryNotice();
		assert.equal(notice.level, 'error');
		assert.equal(notice.title, 'Cloudinary limit reached');
	});
});
