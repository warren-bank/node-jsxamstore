// -----------------------------------------------------------------------------
// code to validate:

const xxhash = require('xxhashjs');

function gen_xxhash(name, raw = false) {
  // xxhashjs expects string or Buffer
  // seed 0

  const h32 = xxhash.h32(0);
  const h64 = xxhash.h64(0);

  h32.update(name);
  h64.update(name);

  if (raw) {
    const h32buf = Buffer.alloc(4);
    const h32digest = h32.digest();
    h32buf.writeUInt32BE(h32digest.toNumber(), 0);

    const h64buf = Buffer.alloc(8);
    const h64digest = h64.digest();
    // h64digest is a UINT64 object, convert to Buffer BE
    h64buf.writeUInt32BE(getHighBitsUnsigned(h64digest), 0);
    h64buf.writeUInt32BE(getLowBitsUnsigned(h64digest), 4);

    // Return Buffer reversed (to match Python [::-1])
    return [Buffer.from(h32buf).reverse(), Buffer.from(h64buf).reverse()];
  }

  return [h32.digest().toString(16).padStart(8, '0'), h64.digest().toString(16).padStart(16, '0')];
}

// https://github.com/pierrec/js-xxhash/blob/master/lib/xxhash64.js
// https://github.com/pierrec/js-cuint/blob/master/lib/uint64.js

function getHighBitsUnsigned(uint64) {
  return (uint64._a48 * 65536) + uint64._a32;
}

function getLowBitsUnsigned(uint64) {
  return uint64.toNumber();
}

// -----------------------------------------------------------------------------
// helpers:

const convert_hash_buffer_to_hex = (hbuf) => {
  if (hbuf.length === 4) {
    // hash32
    const hashValNum = hbuf.readUInt32LE(0);
    return hashValNum.toString(16).padStart(8, '0');
  }
  else if (hbuf.length === 8) {
    // hash64
    const low = hbuf.readUInt32LE(0);
    const high = hbuf.readUInt32LE(4);
    const hash64BigInt = (BigInt(high) << 32n) | BigInt(low);
    return hash64BigInt.toString(16).padStart(16, '0');
  }
  else {
    throw new Error('hash buffer is an incorrect length')
  }
}

// -----------------------------------------------------------------------------
// test cases:

const name = 'https://github.com/warren-bank/node-jsxamstore'

const test_hash_round_trip = () => {
  const [expect_hex_hash32, expect_hex_hash64] = gen_xxhash(name, false)

  const [hbuf32, hbuf64]  = gen_xxhash(name, true)
  const actual_hex_hash32 = convert_hash_buffer_to_hex(hbuf32)
  const actual_hex_hash64 = convert_hash_buffer_to_hex(hbuf64)

  console.log('hash32:', (expect_hex_hash32 === actual_hex_hash32) ? 'OK' : `Fail (expect: "${expect_hex_hash32}". actual: "${actual_hex_hash32}")`)
  console.log('hash64:', (expect_hex_hash64 === actual_hex_hash64) ? 'OK' : `Fail (expect: "${expect_hex_hash64}". actual: "${actual_hex_hash64}")`)
}

test_hash_round_trip()
