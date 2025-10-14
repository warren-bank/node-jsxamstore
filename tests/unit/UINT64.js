const hex_input = 'FAFBFCFDFEF0F1F2'

// -----------------------------------------------------------------------------

const print_hex_result = (buffer, prefix) => {
  const hex_output = buffer.toString('hex').toUpperCase()

  console.log(
    prefix,
    (hex_input === hex_output) ? 'OK' : `Error: expected "${hex_input}", got "${hex_output}"`
  )
}

const print_equality_result = (buffer1, buffer2, prefix) => {
  console.log(
    prefix,
    'buffers',
    buffer1.equals(buffer2) ? 'are' : 'are not',
    'equal'
  )
}

// -----------------------------------------------------------------------------

const get_buffer_from_native_bigint = () => {
  const buffer = Buffer.alloc(8)
  const uint64Value = BigInt('0x' + hex_input)

  buffer.writeBigUInt64BE(uint64Value, 0)

  return buffer
}

// -----------------------------------------------------------------------------

const UINT64 = require('cuint').UINT64

function getHighBitsUnsigned(uint64) {
  return (uint64._a48 * 65536) + uint64._a32;
}

function getLowBitsUnsigned(uint64) {
  return uint64.toNumber();
}

const get_buffer_from_library_uint64 = () => {
  const buffer = Buffer.alloc(8)
  const uint64Value = UINT64(hex_input, 16)

  buffer.writeUInt32BE(getHighBitsUnsigned(uint64Value), 0);
  buffer.writeUInt32BE(getLowBitsUnsigned(uint64Value), 4);

  return buffer
}

// -----------------------------------------------------------------------------

const run_tests = () => {
  const buffer_from_native_bigint = get_buffer_from_native_bigint()
  print_hex_result(
    buffer_from_native_bigint,
    'BigInt:'
  )

  const buffer_from_library_uint64 = get_buffer_from_library_uint64()
  print_hex_result(
    buffer_from_library_uint64,
    'UINT64:'
  )

  print_equality_result(
    buffer_from_native_bigint,
    buffer_from_library_uint64,
    'BigInt and UINT64'
  )
}

run_tests()
