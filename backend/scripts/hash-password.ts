#!/usr/bin/env tsx
/**
 * Prints a bcrypt hash for a plaintext password so the operator never has to
 * store the plaintext anywhere.
 *
 *   npm run hash-password -- 'my great password'
 */
import bcrypt from 'bcryptjs';

const plaintext = process.argv[2];

if (!plaintext) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}

if (plaintext.length < 12) {
  console.error('Refusing: use at least 12 characters for the admin password.');
  process.exit(1);
}

const hash = await bcrypt.hash(plaintext, 12);
console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
