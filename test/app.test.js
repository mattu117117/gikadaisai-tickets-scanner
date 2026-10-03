import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { __test } from '../api/index.js';

test('management IDs are normalized', () => {
  assert.equal(__test.normalizeId(' S01-001 '), 's01-001');
  assert.match(__test.dateKeyTokyo(), /^\d{8}$/);
});

test('training mode is enabled only by the explicit environment value', () => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = 'training';
  assert.equal(__test.isTraining(), true);
  process.env.APP_ENV = 'production';
  assert.equal(__test.isTraining(), false);
  if (previous === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previous;
});

test('spreadsheet exports escape values safely', () => {
  assert.equal(__test.csvCell('a,b'), '"a,b"');
  assert.equal(__test.csvCell('a"b'), '"a""b"');
  assert.equal(__test.tsvCell('a\tb\nc'), 'a b c');
  assert.equal(__test.exportValue(true, 'boolean'), '有効');
});

test('all six spreadsheet-compatible tables are available', () => {
  assert.deepEqual(Object.keys(__test.TABLES), ['tickets','usage_logs','sessions','stores','staff','cancellations']);
  assert.deepEqual(__test.TABLES.tickets.columns.map(column => column[1]), ['管理番号','区分','ID','連番','配布先','金額','状態','使用店舗','使用日時','確認担当者','処理ID']);
});

test('seed data contains 2,142 unique valid tickets and 81 stores', () => {
  const storePath = new URL('../data/stores.json', import.meta.url);
  if (fs.existsSync(storePath)) {
    const stores = JSON.parse(fs.readFileSync(storePath));
    assert.equal(stores.length, 81);
  }
  const ticketPath = new URL('../data/tickets.json', import.meta.url);
  if (fs.existsSync(ticketPath)) {
    const tickets = JSON.parse(fs.readFileSync(ticketPath));
    assert.equal(tickets.length, 2142);
    assert.equal(new Set(tickets.map(ticket => ticket.managementId)).size, tickets.length);
    for (const ticket of tickets) assert.match(ticket.managementId, /^[sdpm]\d{2}-\d{3}$/);
  }
});

test('scanner and read-only admin controls exist', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  assert.match(html, /カメラを許可して回収開始/);
  assert.match(html, /id="copy-table"/);
  assert.match(html, /id="reset-training"/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /id="manual-toggle-button"/);
  assert.doesNotMatch(html, /id="photo-scan-input"/);
  assert.match(client, /facingMode:'environment'/);
  assert.match(client, /fps:15/);
  assert.match(client, /zoom:target/);
  assert.match(client, /Html5QrcodeSupportedFormats\.QR_CODE/);
  assert.doesNotMatch(html, /max-height:42vh/);
  assert.match(client, /format:'tsv'/);
  assert.match(client, /resetTraining/);
  assert.match(fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8'), /本番環境は初期化できません/);
  assert.match(schema, /one_active_session_per_store/);
});
