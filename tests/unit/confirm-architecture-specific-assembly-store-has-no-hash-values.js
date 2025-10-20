/** External Dependencies **/

const fs = require('fs');
const path = require('path');
const { argv, exit } = require('process');

/** Classes **/

class AssemblyStore {
  constructor(in_file_name) {
    this.raw = fs.readFileSync(in_file_name);

    this.hdr_lec = this.raw.readUInt32LE(8);
    this.hdr_gec = this.raw.readUInt32LE(12);
  }

  is_first_data_offset_correct(debug) {
    const assert_data_offset = 20 + (this.hdr_lec * 24);

    const offset = 20;
    const first_entry = this.raw.subarray(offset, offset + 24);
    const actual_data_offset = first_entry.readUInt32LE(0);

    if (debug) {
      console.log('assert data offset:', assert_data_offset, 'bytes')
      console.log('actual data offset:', actual_data_offset, 'bytes')
    }

    return (assert_data_offset === actual_data_offset)
  }
}

/** Utility functions **/

function do_unpack(in_filename) {
  in_filename = path.resolve(in_filename);

  if (!fs.existsSync(in_filename)) {
    console.log(`Blob '${in_filename}' does not exist!`);
    return 1;
  }

  const assembly_store = new AssemblyStore(in_filename);

  const is_correct = assembly_store.is_first_data_offset_correct(true)

  console.log(is_correct ? 'OK' : 'FAIL')

  return 0;
}

/** Command handlers **/

function unpack_store(args) {
  // Simple argument parsing
  const yargs = require('yargs/yargs');

  const parser = yargs(args)
    .usage('Usage: node confirm-architecture-specific-assembly-store-has-no-hash-values.js [options]')
    .option('blob', {
      alias: 'b',
      type: 'string',
      describe: 'Where to load architecture-specific blob from.',
    })
    .help(true)
    .version(false);

  const parsed_args = parser.parse();

  return do_unpack(parsed_args.blob);
}

/** Main **/

function main() {
  const args = argv.slice(2);
  return unpack_store(args);
}

if (require.main === module) {
  const ret = main();
  exit(ret);
}
