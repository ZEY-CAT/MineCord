const test = require('node:test');
const assert = require('node:assert/strict');
const { UpdaterCrypto, TEST_PUBLIC_KEY_BASE64, TEST_PRIVATE_KEY_PEM, PROD_PUBLIC_KEY_BASE64 } = require('./updater-crypto-helpers.js');

test('UpdaterCrypto: valid signature with test key passes', () => {
  const message = 'test artifact content for signing';
  const signature = UpdaterCrypto.signWithTestKey(message);
  const verified = UpdaterCrypto.verifyWithTestKey(message, signature);
  assert.equal(verified, true);
});

test('UpdaterCrypto: altered artifact fails verification', () => {
  const message = 'test artifact content for signing';
  const signature = UpdaterCrypto.signWithTestKey(message);
  const alteredMessage = 'test artifact content for signing (tampered)';
  const verified = UpdaterCrypto.verifyWithTestKey(alteredMessage, signature);
  assert.equal(verified, false);
});

test('UpdaterCrypto: wrong public key fails verification', () => {
  const message = 'test artifact content for signing';
  const signature = UpdaterCrypto.signWithTestKey(message);
  // Try to verify with production key instead of test key
  const verified = UpdaterCrypto.verifyWithProdKey(message, signature);
  assert.equal(verified, false);
});

test('UpdaterCrypto: invalid signature format fails', () => {
  const message = 'test artifact content for signing';
  // Invalid signature (too short)
  const invalidSig = Buffer.from('invalid').toString('base64');
  const verified = UpdaterCrypto.verifyWithTestKey(message, invalidSig);
  assert.equal(verified, false);
});

test('UpdaterCrypto: truncated signature fails', () => {
  const message = 'test artifact content for signing';
  const signature = UpdaterCrypto.signWithTestKey(message);
  const sigBytes = Buffer.from(signature, 'base64');
  // Truncate the signature
  const truncatedSig = sigBytes.slice(0, 32).toString('base64');
  const verified = UpdaterCrypto.verifyWithTestKey(message, truncatedSig);
  assert.equal(verified, false);
});

test('UpdaterCrypto: malformed base64 signature fails', () => {
  const message = 'test artifact content for signing';
  const malformedSig = 'not-valid-base64!@#$%';
  const verified = UpdaterCrypto.verifyWithTestKey(message, malformedSig);
  assert.equal(verified, false);
});

test('UpdaterCrypto: SHA-256 hash matches for identical content', () => {
  const content = 'test artifact content for hashing';
  const hash1 = UpdaterCrypto.computeSHA256Base64(content);
  const hash2 = UpdaterCrypto.computeSHA256Base64(content);
  assert.equal(hash1, hash2);
});

test('UpdaterCrypto: SHA-256 hash differs for altered content', () => {
  const content = 'test artifact content for hashing';
  const alteredContent = 'test artifact content for hashing (tampered)';
  const hash1 = UpdaterCrypto.computeSHA256Base64(content);
  const hash2 = UpdaterCrypto.computeSHA256Base64(alteredContent);
  assert.notEqual(hash1, hash2);
});

test('UpdaterCrypto: signature covers exact artifact hash', () => {
  // The server should sign the SHA-256 hash of the artifact
  const artifactContent = 'this is the actual installer binary content';
  const artifactHash = UpdaterCrypto.computeSHA256Base64(artifactContent);
  
  // Sign the hash (what the server does)
  const signature = UpdaterCrypto.signWithTestKey(artifactHash);
  
  // Client verifies: compute hash of downloaded file, verify signature covers that hash
  const downloadedHash = UpdaterCrypto.computeSHA256Base64(artifactContent);
  const verified = UpdaterCrypto.verifyWithTestKey(downloadedHash, signature);
  assert.equal(verified, true);
  
  // Tampered artifact produces different hash
  const tamperedHash = UpdaterCrypto.computeSHA256Base64(artifactContent + 'tampered');
  const verifiedTampered = UpdaterCrypto.verifyWithTestKey(tamperedHash, signature);
  assert.equal(verifiedTampered, false);
});

test('UpdaterCrypto: empty message fails', () => {
  const signature = UpdaterCrypto.signWithTestKey('');
  const verified = UpdaterCrypto.verifyWithTestKey('', signature);
  assert.equal(verified, true); // Empty message can be signed/verified
  
  // But empty signature should fail
  const verifiedEmpty = UpdaterCrypto.verifyWithTestKey('message', '');
  assert.equal(verifiedEmpty, false);
});

test('UpdaterCrypto: signature length is 64 bytes', () => {
  const message = 'test';
  const signature = UpdaterCrypto.signWithTestKey(message);
  const sigBytes = Buffer.from(signature, 'base64');
  assert.equal(sigBytes.length, 64);
});

test('UpdaterCrypto: public key length is 32 bytes', () => {
  const pubKeyBytes = Buffer.from(TEST_PUBLIC_KEY_BASE64, 'base64');
  assert.equal(pubKeyBytes.length, 32);
});

module.exports = { UpdaterCrypto, TEST_PUBLIC_KEY_BASE64, TEST_PRIVATE_KEY_PEM, PROD_PUBLIC_KEY_BASE64 };