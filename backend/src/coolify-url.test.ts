import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coolifyDatabasePath } from '@app/shared';

const PROJECT = 'zzlafvhbzrsq8bwhw9t7mn8m';
const ENVIRONMENT = 'qtc2faahtqbxci1vwlto4pvi';
const DATABASE = 'ahfpsbstwckbt5qfekeryt6s';

test('matches the Coolify 4.x database route', () => {
  assert.equal(
    coolifyDatabasePath('http://1.2.3.4:8000', PROJECT, ENVIRONMENT, DATABASE),
    `http://1.2.3.4:8000/project/${PROJECT}/environment/${ENVIRONMENT}/database/${DATABASE}`,
  );
});

test('strips a trailing slash from the base', () => {
  assert.equal(
    coolifyDatabasePath('http://1.2.3.4:8000/', PROJECT, ENVIRONMENT, DATABASE),
    `http://1.2.3.4:8000/project/${PROJECT}/environment/${ENVIRONMENT}/database/${DATABASE}`,
  );
});

test('falls back to the Coolify root when the project is unresolved', () => {
  assert.equal(coolifyDatabasePath('http://1.2.3.4:8000', null, ENVIRONMENT, DATABASE), 'http://1.2.3.4:8000');
});

test('falls back to the Coolify root when the environment is unresolved', () => {
  assert.equal(
    coolifyDatabasePath('http://1.2.3.4:8000', PROJECT, undefined, DATABASE),
    'http://1.2.3.4:8000',
  );
});
