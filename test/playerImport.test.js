import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { fieldForHeader, matchOption, readPlayerSheet, buildTemplate } from '../services/playerImport.js';

const ROLES = ['Batsman', 'Bowler', 'Batting All-Rounder', 'Bowling All-Rounder', 'Wicket-Keeper Batsman'];

describe('header matching', () => {
	test('recognises plain and Google Forms style headers', () => {
		assert.equal(fieldForHeader('Name'), 'name');
		assert.equal(fieldForHeader('Full Name'), 'name');
		assert.equal(fieldForHeader('Mobile Number'), 'phone');
		assert.equal(fieldForHeader('WhatsApp number'), 'phone');
		assert.equal(fieldForHeader('Playing role'), 'role');
		assert.equal(fieldForHeader('T-Shirt Size'), 'jerseySize');
		assert.equal(fieldForHeader('Category *'), 'category');
		assert.equal(fieldForHeader('What is your mobile number?'), 'phone');
	});

	test('ignores unrelated columns', () => {
		assert.equal(fieldForHeader('Timestamp'), null);
		assert.equal(fieldForHeader('Email address'), null);
		assert.equal(fieldForHeader(''), null);
	});
});

describe('option matching', () => {
	test('ignores case and punctuation', () => {
		assert.deepEqual(matchOption('wicket keeper batsman', ROLES, 'Role'), { value: 'Wicket-Keeper Batsman' });
		assert.deepEqual(matchOption('BOWLER', ROLES, 'Role'), { value: 'Bowler' });
	});

	test('accepts a unique partial match', () => {
		assert.deepEqual(matchOption('Wicket Keeper', ROLES, 'Role'), { value: 'Wicket-Keeper Batsman' });
	});

	test('reports an ambiguous partial match', () => {
		const result = matchOption('All Rounder', ROLES, 'Role');
		assert.match(result.error, /could mean Batting All-Rounder or Bowling All-Rounder/);
	});

	test('reports an unknown value and allows blanks', () => {
		assert.match(matchOption('Captain', ROLES, 'Role').error, /is not one of/);
		assert.deepEqual(matchOption('', ROLES, 'Role'), { value: '' });
	});
});

describe('reading sheets', () => {
	const tournament = {
		roles: ROLES,
		categories: [
			{ name: 'A', basePrice: 15000 },
			{ name: 'B', basePrice: 6000 },
		],
		playerFields: { phone: 'required', jerseySize: 'optional', jerseyNumber: 'hidden', age: 'optional' },
	};

	test('reads a Google Forms style CSV', async () => {
		const csv = [
			'Timestamp,Full Name,Mobile Number,Playing role,T-Shirt Size',
			'2026/10/01 10:00,Rohan Verma,9000000001,Batsman,L',
			',,,,',
			'2026/10/01 10:05,"Shah, Dev",9000000002,wicket keeper,M',
		].join('\n');
		const { columns, rows } = await readPlayerSheet({ originalname: 'form.csv', mimetype: 'text/csv', buffer: Buffer.from(csv) });
		assert.deepEqual(Object.keys(columns).sort(), ['jerseySize', 'name', 'phone', 'role']);
		assert.equal(rows.length, 2);
		assert.deepEqual(rows[1].values, { name: 'Shah, Dev', phone: '9000000002', role: 'wicket keeper', jerseySize: 'M' });
	});

	test('the generated template reads back with the same columns', async () => {
		const workbook = buildTemplate(tournament);
		const sheet = workbook.getWorksheet('Players');
		sheet.addRow({ name: 'Test Player', role: 'Bowler', category: 'B', phone: '9000000003', jerseySize: 'XL', age: 21 });
		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

		const { columns, rows } = await readPlayerSheet({ originalname: 'players.xlsx', mimetype: 'application/octet-stream', buffer });
		assert.deepEqual(Object.keys(columns).sort(), ['age', 'category', 'jerseySize', 'name', 'phone', 'role']);
		assert.deepEqual(rows[0].values, { name: 'Test Player', role: 'Bowler', category: 'B', phone: '9000000003', jerseySize: 'XL', age: '21' });
	});

	test('a sheet without a name column is rejected', async () => {
		const csv = 'Foo,Bar\n1,2';
		await assert.rejects(() => readPlayerSheet({ originalname: 'x.csv', mimetype: 'text/csv', buffer: Buffer.from(csv) }), /header row/);
	});

	test('the template has dropdowns for role and category', async () => {
		const workbook = buildTemplate(tournament);
		const sheet = workbook.getWorksheet('Players');
		assert.equal(sheet.getCell('B2').dataValidation.type, 'list');
		assert.equal(sheet.getCell('C2').dataValidation.formulae[0], 'Options!$B$2:$B$3');
		assert.ok(ExcelJS);
	});
});
