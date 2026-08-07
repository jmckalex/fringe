#!/usr/bin/env node
// Adds or replaces a login for the status API. Reads the password from stdin so
// it never appears in argv (which any local user can read from `ps`).
//
//   printf '%s' 'the-password' | node make-user.js jules /etc/fringe/users.json
//
// Passwords are stored scrypt-hashed with a per-user salt — never in plaintext,
// and not reversible if the file leaks.

const fs = require('fs');
const crypto = require('crypto');

const [, , user, file = '/etc/fringe/users.json'] = process.argv;
if (!user) {
  console.error('usage: printf %s <password> | node make-user.js <username> [users.json]');
  process.exit(1);
}

let password = '';
process.stdin.on('data', d => (password += d));
process.stdin.on('end', () => {
  password = password.replace(/\n$/, '');
  if (!password) {
    console.error('no password on stdin');
    process.exit(1);
  }

  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  users[user] = { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };

  fs.writeFileSync(file, JSON.stringify(users, null, 2) + '\n', { mode: 0o600 });
  console.log(`wrote ${user} to ${file} (${Object.keys(users).length} user(s))`);
});
