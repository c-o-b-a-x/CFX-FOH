import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFormTemplate, formatDuration, parseFormResponse } from '../src/form.js';

test('parses a labelled form with markdown and optional blanks', () => {
  const result = parseFormResponse(`
    **Full name:** Jane Doe
    **Email:** jane@example.com
    Service or product: Logo design
    Quantity (optional): 2
    Budget (optional):
    Deadline (optional): Dec 1
    Details: Please include the source files.
  `);

  assert.equal(result.missing.length, 0);
  assert.equal(result.data.name, 'Jane Doe');
  assert.equal(result.data.email, 'jane@example.com');
  assert.equal(result.data.service, 'Logo design');
  assert.equal(result.data.quantity, '2');
  assert.equal(result.data.deadline, 'Dec 1');
  assert.equal(result.data.details, 'Please include the source files.');
  assert.equal(result.data.budget, undefined);
  assert.equal(result.isBlank, false);
});

test('parses numbered answers in field order', () => {
  const result = parseFormResponse(`
    1. John Smith
    2. john@example.com
    3. Website redesign
    4. 1
    5. $500
    6. Friday
    7. Needs a contact form and basic SEO.
  `);

  assert.equal(result.missing.length, 0);
  assert.equal(result.data.name, 'John Smith');
  assert.equal(result.data.email, 'john@example.com');
  assert.equal(result.data.service, 'Website redesign');
  assert.equal(result.data.details, 'Needs a contact form and basic SEO.');
});

test('keeps values written on the line after an empty label', () => {
  const result = parseFormResponse(`
    Full name:
    Jane Doe
    Email: jane@example.com
    Service or product: Illustration
    Details:
    Two characters
    Full body, coloured
  `);

  assert.equal(result.data.name, 'Jane Doe');
  assert.equal(result.data.details, 'Two characters\nFull body, coloured');
  assert.equal(result.missing.length, 0);
});

test('reports missing required fields', () => {
  const result = parseFormResponse('Full name: Jane Doe');

  assert.deepEqual(
    result.missing.map((field) => field.key),
    ['email', 'service', 'details'],
  );
  assert.equal(result.data.name, 'Jane Doe');
});

test('captures unrecognised labelled lines as extras', () => {
  const result = parseFormResponse(`
    Full name: Jane Doe
    Email: jane@example.com
    Service or product: Logo
    Details: Simple wordmark
    Discord: jane#0001
    Website: https://example.com
  `);

  assert.equal(result.missing.length, 0);
  assert.deepEqual(
    result.extras.map((extra) => extra.label),
    ['Discord', 'Website'],
  );
  assert.equal(result.extras[1].value, 'https://example.com');
});

test('detects a blank template without values', () => {
  const result = parseFormResponse(buildFormTemplate());

  assert.equal(result.isBlank, true);
  assert.equal(result.hasFormLabels, true);
  assert.equal(result.missing.length, 4);
});

test('treats plain chat text as blank', () => {
  const result = parseFormResponse('hey, how do I order?');

  assert.equal(result.isBlank, true);
  assert.equal(result.hasFormLabels, false);
  assert.equal(result.missing.length, 4);
});

test('template labels are all parseable, including optional markers', () => {
  const template = buildFormTemplate();
  const filled = template
    .split('\n')
    .map((line, index) => `${line} answer ${index + 1}`)
    .join('\n');

  const result = parseFormResponse(filled);
  assert.equal(result.missing.length, 0);
  assert.equal(result.data.name, 'answer 1');
  assert.equal(result.data.details, 'answer 7');
});

test('formats timeouts for humans', () => {
  assert.equal(formatDuration(1440), '1 day');
  assert.equal(formatDuration(60), '1 hour');
  assert.equal(formatDuration(15), '15 minutes');
});
