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

  extract_hashes(json_data) {
    let offset = 20 + (this.hdr_lec * 24);

    // Parse Hash32 section
    for (let i = 0; i < this.hdr_lec; i++) {
      const entry = this.raw.subarray(offset, offset + 20);

      // hash32 is 4 bytes little endian hex string
      const hashValNum = entry.readUInt32LE(0);

      const hashHexStr = hashValNum.toString(16).padStart(8, '0')
      const hashDecStr = BigInt('0x' + hashHexStr).toString()

      json_data.hash32.hex.push(hashHexStr)
      json_data.hash32.dec.push(hashDecStr)

      offset += 20;
    }

    // Parse Hash64 section
    for (let i = 0; i < this.hdr_lec; i++) {
      const entry = this.raw.subarray(offset, offset + 20);

      // hash64 is 8 bytes little endian hex string
      const low = entry.readUInt32LE(0);
      const high = entry.readUInt32LE(4);
      const hash64BigInt = (BigInt(high) << 32n) | BigInt(low);

      const hashHexStr = hash64BigInt.toString(16).padStart(16, '0')
      const hashDecStr = hash64BigInt.toString()

      json_data.hash64.hex.push(hashHexStr)
      json_data.hash64.dec.push(hashDecStr)

      offset += 20;
    }
  }
}

/** Utility functions **/

function do_unpack(in_filename, out_filename) {
  in_filename  = path.resolve(in_filename);
  out_filename = path.resolve(out_filename);

  if (!fs.existsSync(in_filename)) {
    console.log(`Main assemblies blob '${in_filename}' does not exist!`);
    return 1;
  }

  const json_data = { hash32: {hex: [], dec: []}, hash64: {hex: [], dec: []} };

  const assembly_store = new AssemblyStore(in_filename);

  // Extract primary assembly
  assembly_store.extract_hashes(json_data);

  fs.writeFileSync(out_filename, JSON.stringify(json_data, null, 4));

  return 0;
}

/** Command handlers **/

function unpack_store(args) {
  // Simple argument parsing
  const yargs = require('yargs/yargs');

  const parser = yargs(args)
    .usage('Usage: node print-primary-assembly-store-ordered-hash-values.js [options]')
    .option('blob', {
      alias: 'b',
      type: 'string',
      default: './assemblies.blob',
      describe: 'Where to load primary blob from.',
    })
    .option('out', {
      alias: 'o',
      type: 'string',
      default: './hashes.json',
      describe: 'Where to save ordered list of hashes to.',
    })
    .help(true)
    .version(false);

  const parsed_args = parser.parse();

  return do_unpack(parsed_args.blob, parsed_args.out);
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
