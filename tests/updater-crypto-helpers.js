const crypto = require('crypto');

const TEST_PUBLIC_KEY_BASE64 = 'kxKYdXpXwSUX6ZEAPfVSKYE9kvQgBq3Lqr0LGqTxMWo=';
const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEICZRtH+Q7jQdJeACoJN9RBtZgUNTlkf0YQ8gtYZXtwHU
-----END PRIVATE KEY-----`;

const PROD_PUBLIC_KEY_BASE64 = '9fbByVDf7DgyNEmzLzECdJLiG+/lQyZQ1FD8INpt7M4=';

class UpdaterCrypto {
  static signWithTestKey(message) {
    const privKeyObj = crypto.createPrivateKey({ 
      key: TEST_PRIVATE_KEY_PEM, 
      format: 'pem', 
      type: 'pkcs8' 
    });
    const signature = crypto.sign(null, Buffer.from(message), { 
      key: privKeyObj, 
      dsaEncoding: 'ieee-p1363' 
    });
    return signature.toString('base64');
  }

  static verifyWithTestKey(message, signatureBase64) {
    const pubKeyObj = crypto.createPublicKey({ 
      key: `-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA${TEST_PUBLIC_KEY_BASE64}\n-----END PUBLIC KEY-----`, 
      format: 'pem', 
      type: 'spki' 
    });
    try {
      return crypto.verify(null, Buffer.from(message), { 
        key: pubKeyObj, 
        dsaEncoding: 'ieee-p1363' 
      }, Buffer.from(signatureBase64, 'base64'));
    } catch {
      return false;
    }
  }

  static verifyWithProdKey(message, signatureBase64) {
    const pubKeyObj = crypto.createPublicKey({ 
      key: `-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA${PROD_PUBLIC_KEY_BASE64}\n-----END PUBLIC KEY-----`, 
      format: 'pem', 
      type: 'spki' 
    });
    try {
      return crypto.verify(null, Buffer.from(message), { 
        key: pubKeyObj, 
        dsaEncoding: 'ieee-p1363' 
      }, Buffer.from(signatureBase64, 'base64'));
    } catch {
      return false;
    }
  }

  static computeSHA256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static computeSHA256Base64(data) {
    return crypto.createHash('sha256').update(data).digest('base64');
  }
}

module.exports = { UpdaterCrypto, TEST_PUBLIC_KEY_BASE64, TEST_PRIVATE_KEY_PEM, PROD_PUBLIC_KEY_BASE64 };