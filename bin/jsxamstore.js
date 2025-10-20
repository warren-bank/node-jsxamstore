#! /usr/bin/env node

/** External Dependencies **/

const {lz4BlockCodec} = require('@warren-bank/lz4-wasm');
const xxhash = require('xxhashjs');

const fs = require('fs');
const path = require('path');
const { argv, exit } = require('process');

/** Global Constants **/

const ASSEMBLY_STORE_MAGIC = Buffer.from('XABA');
const ASSEMBLY_STORE_FORMAT_VERSION = 1;

const COMPRESSED_DATA_MAGIC = Buffer.from('XALZ');

const FILE_ASSEMBLIES_BLOB = 'assemblies.blob';
const FILE_ASSEMBLIES_BLOB_ARM = 'assemblies.armeabi_v7a.blob';
const FILE_ASSEMBLIES_BLOB_ARM_64 = 'assemblies.arm64_v8a.blob';
const FILE_ASSEMBLIES_BLOB_x86 = 'assemblies.x86.blob';
const FILE_ASSEMBLIES_BLOB_x86_64 = 'assemblies.x86_64.blob';

const ARCHITECTURE_MAP = {
  arm: FILE_ASSEMBLIES_BLOB_ARM,
  arm64: FILE_ASSEMBLIES_BLOB_ARM_64,
  x86: FILE_ASSEMBLIES_BLOB_x86,
  x86_64: FILE_ASSEMBLIES_BLOB_x86_64,
};

const FILE_ASSEMBLIES_MANIFEST = 'assemblies.manifest';
const FILE_ASSEMBLIES_JSON = 'assemblies.json';

let DEBUG = false;

function debug(message) {
  if (DEBUG) {
    console.log(`[debug] ${message}`);
  }
}

/** Global Variables **/

let lz4 = null;

/** Helper functions for reading/writing integers from Buffer **/

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readUInt64LE(buffer, offset) {
  // Node.js Buffer does not have native 64-bit int read, so read two 32-bit parts
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  // Combine to BigInt
  return BigInt(high) << 32n | BigInt(low);
}

function writeUInt32LE(buffer, value, offset) {
  buffer.writeUInt32LE(value, offset);
}

function writeUInt64LE(buffer, value, offset) {
  // value is BigInt
  const low = Number(value & 0xFFFFFFFFn);
  const high = Number(value >> 32n);
  buffer.writeUInt32LE(low, offset);
  buffer.writeUInt32LE(high, offset + 4);
}

/** Classes **/

class ManifestEntry {
  constructor(hash32, hash64, blob_id, blob_idx, name) {
    this.hash32 = hash32;
    this.hash64 = hash64;
    this.blob_id = Number(blob_id);
    this.blob_idx = Number(blob_idx);
    this.name = name;
  }
}

class ManifestList extends Array {
  get_idx(blob_id, blob_idx) {
    for (const entry of this) {
      if (entry.blob_idx === blob_idx && entry.blob_id === blob_id) {
        return entry;
      }
    }
    return null;
  }
}

class AssemblyStoreAssembly {
  constructor() {
    this.data_offset = 0;
    this.data_size = 0;
    this.debug_data_offset = 0;
    this.debug_data_size = 0;
    this.config_data_offset = 0;
    this.config_data_size = 0;
  }
}

class AssemblyStoreHashEntry {
  constructor() {
    this.hash_val = '';
    this.mapping_index = 0;
    this.local_store_index = 0;
    this.store_id = 0;
  }
}

class AssemblyStore {
  constructor(in_file_name, manifest_entries, primary = true) {
    this.manifest_entries = manifest_entries;
    this.file_name = path.basename(in_file_name);

    this.raw = fs.readFileSync(in_file_name);

    // Parse header
    // 0-3:   Magic
    // 4-7:   Version
    // 8-11:  LocalEntryCount
    // 12-15: GlobalEntryCount
    // 16-19: StoreID

    const magic = this.raw.subarray(0, 4);
    if (!magic.equals(ASSEMBLY_STORE_MAGIC)) {
      throw new Error(`Invalid Magic: ${magic.toString('utf8')}`);
    }

    const version = this.raw.readUInt32LE(4);
    if (version > ASSEMBLY_STORE_FORMAT_VERSION) {
      throw new Error(
        `This version is higher than expected! Max = ${ASSEMBLY_STORE_FORMAT_VERSION}, got ${version}`
      );
    }
    this.hdr_version = version;

    this.hdr_lec = this.raw.readUInt32LE(8);
    this.hdr_gec = this.raw.readUInt32LE(12);
    this.hdr_store_id = this.raw.readUInt32LE(16);

    debug(`Local entry count: ${this.hdr_lec}`);
    debug(`Global entry count: ${this.hdr_gec}`);

    this.assemblies_list = [];

    debug(`Entries start at: 20 (0x14)`);

    let offset = 20;
    for (let i = 0; i < this.hdr_lec; i++) {
      debug(`Extracting Assembly: ${offset} (0x${offset.toString(16)})`);
      const entry = this.raw.subarray(offset, offset + 24);

      const assembly = new AssemblyStoreAssembly();

      assembly.data_offset = entry.readUInt32LE(0);
      assembly.data_size = entry.readUInt32LE(4);
      assembly.debug_data_offset = entry.readUInt32LE(8);
      assembly.debug_data_size = entry.readUInt32LE(12);
      assembly.config_data_offset = entry.readUInt32LE(16);
      assembly.config_data_size = entry.readUInt32LE(20);

      this.assemblies_list.push(assembly);

      debug(`  Data Offset: ${assembly.data_offset} (0x${assembly.data_offset.toString(16)})`);
      debug(`  Data Size: ${assembly.data_size} (0x${assembly.data_size.toString(16)})`);
      debug(`  Config Offset: ${assembly.config_data_offset} (0x${assembly.config_data_offset.toString(16)})`);
      debug(`  Config Size: ${assembly.config_data_size} (0x${assembly.config_data_size.toString(16)})`);
      debug(`  Debug Offset: ${assembly.debug_data_offset} (0x${assembly.debug_data_offset.toString(16)})`);
      debug(`  Debug Size: ${assembly.debug_data_size} (0x${assembly.debug_data_size.toString(16)})`);

      offset += 24;
    }

    if (!primary) {
      debug('Skipping hash sections in non-primary store');
      return;
    }

    // Parse Hash32 section
    debug(`Hash32 start at: ${offset} (0x${offset.toString(16)})`);
    this.global_hash32 = [];

    for (let i = 0; i < this.hdr_lec; i++) {
      const entry = this.raw.subarray(offset, offset + 20);
      const hash_entry = new AssemblyStoreHashEntry();

      // hash_val is 4 bytes little endian hex string
      const hashValNum = entry.readUInt32LE(0);
      hash_entry.hash_val = `0x${hashValNum.toString(16).padStart(8, '0')}`;

      hash_entry.mapping_index = entry.readUInt32LE(8);
      hash_entry.local_store_index = entry.readUInt32LE(12);
      hash_entry.store_id = entry.readUInt32LE(16);

      debug('New Hash32 Section:');
      debug(`   mapping index: ${hash_entry.mapping_index}`);
      debug(`   local store index: ${hash_entry.local_store_index}`);
      debug(`   store id: ${hash_entry.store_id}`);
      debug(`   Hash32: ${hash_entry.hash_val}`);

      this.global_hash32.push(hash_entry);
      offset += 20;
    }

    // Parse Hash64 section
    debug(`Hash64 start at: ${offset} (0x${offset.toString(16)})`);
    this.global_hash64 = [];

    for (let i = 0; i < this.hdr_lec; i++) {
      const entry = this.raw.subarray(offset, offset + 20);
      const hash_entry = new AssemblyStoreHashEntry();

      // 8 bytes little endian for hash64
      const low = entry.readUInt32LE(0);
      const high = entry.readUInt32LE(4);
      const hash64BigInt = (BigInt(high) << 32n) | BigInt(low);
      hash_entry.hash_val = `0x${hash64BigInt.toString(16).padStart(16, '0')}`;

      hash_entry.mapping_index = entry.readUInt32LE(8);
      hash_entry.local_store_index = entry.readUInt32LE(12);
      hash_entry.store_id = entry.readUInt32LE(16);

      debug('New Hash64 Section:');
      debug(`   mapping index: ${hash_entry.mapping_index}`);
      debug(`   local store index: ${hash_entry.local_store_index}`);
      debug(`   store id: ${hash_entry.store_id}`);
      debug(`   Hash64: ${hash_entry.hash_val}`);

      this.global_hash64.push(hash_entry);
      offset += 20;
    }
  }

  extract_all(json_config, outpath = 'out') {
    // Initialize store JSON
    const store_json = {};
    store_json[this.file_name] = {
      store_idx: json_config.stores.length
    };

    store_json[this.file_name]['header'] = {
      version: this.hdr_version,
      lec: this.hdr_lec,
      gec: this.hdr_gec,
      store_id: this.hdr_store_id,
    };

    for (let i = 0; i < this.assemblies_list.length; i++) {
      const assembly = this.assemblies_list[i];
      const assembly_dict = {
        store_idx: store_json[this.file_name].store_idx
      };

      assembly_dict.lz4 = false;

      let assembly_data = null;

      const entry = this.manifest_entries.get_idx(this.hdr_store_id, i);

      if (!entry) {
        throw new Error(`Manifest entry not found for store_id ${this.hdr_store_id} index ${i}`);
      }

      assembly_dict.name = entry.name;
      assembly_dict.store_id = entry.blob_id;
      assembly_dict.blob_idx = entry.blob_idx;
      assembly_dict.hash32 = entry.hash32;
      assembly_dict.hash64 = entry.hash64;

      const out_file = path.join(outpath, `${entry.name}.dll`);
      assembly_dict.file = out_file;

      const assembly_header = this.raw.subarray(assembly.data_offset, assembly.data_offset + 4);

      if (assembly_header.equals(COMPRESSED_DATA_MAGIC)) {
        assembly_data = AssemblyStore.decompress_lz4(
          this.raw.subarray(assembly.data_offset, assembly.data_offset + assembly.data_size)
        );
        assembly_dict.lz4 = true;
        assembly_dict.lz4_desc_idx = this.raw.readUInt32LE(assembly.data_offset + 4);
      } else {
        assembly_data = this.raw.subarray(assembly.data_offset, assembly.data_offset + assembly.data_size);
      }

      console.log(`Extracting ${entry.name}...`);

      const dirName = path.dirname(out_file);
      if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
      }

      fs.writeFileSync(out_file, assembly_data);

      json_config.assemblies.push(assembly_dict);
    }

    json_config.stores.push(store_json);
    return json_config;
  }

  static decompress_lz4(compressed_data) {
    // compressed_data is a Buffer
    // Format:
    // 0-3: "XALZ"
    // 4-7: desc_idx (ignored here)
    // 8-11: packed_payload_len (uncompressed size)
    // 12-: compressed payload

    const unpacked_payload_len = compressed_data.readUInt32LE(8);
    const compressed_payload = compressed_data.subarray(12);

    const uncompressed = lz4.decodeBlock(compressed_payload, 0, unpacked_payload_len);
    const decompressedSize = uncompressed.length;

    if (decompressedSize !== unpacked_payload_len) {
      throw new Error(`Decompressed size mismatch. Header: ${unpacked_payload_len}B. Data: ${decompressedSize}B.`);
    }

    return uncompressed;
  }
}

/** Utility functions **/

function lz4_compress(file_data, desc_idx) {
  // file_data: Buffer
  // Compose header + compressed data

  // Header: 4sII
  // 4s: "XALZ"
  // I: desc_idx
  // I: packed_payload_len (uncompressed size)

  const header = Buffer.alloc(12);
  COMPRESSED_DATA_MAGIC.copy(header, 0);
  header.writeUInt32LE(desc_idx, 4);
  header.writeUInt32LE(file_data.length, 8);

  // Compress with lz4 high compression
  const compressedData = lz4.encodeBlock(file_data, 0);

  return Buffer.concat([header, compressedData]);
}

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

function read_manifest(in_manifest) {
  const manifest_list = new ManifestList();

  const content = fs.readFileSync(in_manifest, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.length === 0) continue;
    if (line.startsWith('Hash')) continue;

    const split_line = line.trim().split(/\s+/);
    if (split_line.length < 5) continue;

    manifest_list.push(
      new ManifestEntry(
        split_line[0], // hash32
        split_line[1], // hash64
        split_line[2], // blob_id
        split_line[3], // blob_idx
        split_line[4]  // name
      )
    );
  }

  return manifest_list;
}

function usage() {
  console.log('usage: node jsxamstore.js MODE <args>');
  console.log('');
  console.log('MODES:');
  console.log('  unpack <args>  Unpack assembly blobs.');
  console.log('  pack <args>    Repackage assembly blobs.');
  console.log('  hash file_name Generate xxHash values.');
  console.log('  help           Print this message.');
  return 0;
}

function do_unpack(in_directory, out_directory, include_arch_assemblies, force) {
  let has_arch_assemblies = false;

  in_directory  = path.resolve(in_directory);
  out_directory = path.resolve(out_directory);

  if (force && fs.existsSync(out_directory)) {
    fs.rmSync(out_directory, { recursive: true, force: true });
  }

  if (fs.existsSync(out_directory)) {
    console.log('Out directory already exists!');
    return 11;
  }

  const manifest_path = path.join(in_directory, FILE_ASSEMBLIES_MANIFEST);
  const assemblies_path = path.join(in_directory, FILE_ASSEMBLIES_BLOB);

  if (!fs.existsSync(manifest_path)) {
    console.log(`Manifest file '${manifest_path}' does not exist!`);
    return 12;
  } else if (!fs.existsSync(assemblies_path)) {
    console.log(`Main assemblies blob '${assemblies_path}' does not exist!`);
    return 13;
  }

  const manifest_entries = read_manifest(manifest_path);
  if (!manifest_entries) {
    console.log(`Unable to parse '${FILE_ASSEMBLIES_MANIFEST}' file!`);
    return 14;
  }

  const json_data = { stores: [], assemblies: [] };

  fs.mkdirSync(out_directory);

  const assembly_store = new AssemblyStore(assemblies_path, manifest_entries);

  // Extract primary assembly
  assembly_store.extract_all(json_data, path.join(out_directory, 'primary'));

  if (assembly_store.hdr_lec !== assembly_store.hdr_gec) {
    has_arch_assemblies = true;
    debug('Architecture-specific assemblies exist!');
  }

  if (has_arch_assemblies) {
    const valid_arch = Object.keys(ARCHITECTURE_MAP);
    let all_arch = true;

    if (!Array.isArray(include_arch_assemblies)) {
      include_arch_assemblies = (!!include_arch_assemblies && (typeof include_arch_assemblies === 'string')) ? [include_arch_assemblies] : [];
    }
    if (include_arch_assemblies.includes('no') || include_arch_assemblies.includes('0')) {
      all_arch = false;
      include_arch_assemblies = [];
    }
    if (include_arch_assemblies.length) {
      // normalize values to lowercase, then filter to remove invalid values
      include_arch_assemblies = include_arch_assemblies.map(arch => arch.toLowerCase()).filter(arch => valid_arch.includes(arch));
    }
    if (include_arch_assemblies.length) {
      all_arch = false;
    }
    if (all_arch) {
      include_arch_assemblies = valid_arch;
    }

    for (let arch of include_arch_assemblies) {
      const arch_assembly_path = path.join(in_directory, ARCHITECTURE_MAP[arch]);

      if (fs.existsSync(arch_assembly_path)) {
        // Extract architecture-specific assembly
        const arch_assembly_store = new AssemblyStore(arch_assembly_path, manifest_entries, false);
        arch_assembly_store.extract_all(json_data, path.join(out_directory, arch));
      }
    }
  }

  fs.writeFileSync(path.join(out_directory, FILE_ASSEMBLIES_JSON), JSON.stringify(json_data, null, 4));

  return 0;
}

function do_pack(in_json_config, out_directory) {
  in_json_config = path.resolve(in_json_config);
  out_directory = path.resolve(out_directory);

  if (!fs.existsSync(in_json_config)) {
    console.log(`Config file '${in_json_config}' does not exist!`);
    return 21;
  }

  if (!fs.existsSync(out_directory)) {
    fs.mkdirSync(out_directory);
  }

  const assemblies_manifest_path = path.join(out_directory, `${FILE_ASSEMBLIES_MANIFEST}.new`)

  if (fs.existsSync(assemblies_manifest_path)) {
    console.log('Output manifest exists!');
    return 22;
  }

  const json_data = JSON.parse(fs.readFileSync(in_json_config, 'utf8'));

  // Write new assemblies.manifest
  console.log("Writing 'assemblies.manifest.new'...");
  const assemblies_manifest_f = fs.openSync(assemblies_manifest_path, 'w');

  fs.writeSync(
    assemblies_manifest_f,
    'Hash 32     Hash 64             Blob ID  Blob idx  Name\r\n'
  );

  for (const assembly of json_data.assemblies) {
    if (assembly.store_idx >= 2) break;

    const [hash32, hash64] = gen_xxhash(assembly.name);

    const line = `0x${hash32}  0x${hash64}  ${assembly.store_id
      .toString()
      .padStart(3, '0')}      ${assembly.blob_idx.toString().padStart(4, '0')}      ${assembly.name}\r\n`;

    fs.writeSync(assemblies_manifest_f, line);
  }

  fs.closeSync(assemblies_manifest_f);

  // Determine lec/gec for store 0
  let store_zero_lec = 0;
  for (const assembly_store of json_data.stores) {
    for (const [store_name, store_data] of Object.entries(assembly_store)) {
      if (store_name === FILE_ASSEMBLIES_BLOB) {
        store_zero_lec = store_data.header.lec;
      }
    }
  }

  // Write blobs
  for (const assembly_store of json_data.stores) {
    for (const [store_name, store_data] of Object.entries(assembly_store)) {
      const out_store_name = `${store_name}.new`;
      const out_store_path = path.join(out_directory, out_store_name);

      if (fs.existsSync(out_store_path)) {
        console.log('Output blob exists!', out_store_name);
        return 23;
      }

      console.log(`Writing '${out_store_name}'...`);
      const assemblies_blob_f = fs.openSync(out_store_path, 'w+');

      const json_hdr = store_data.header;

      // Write header: 4sIIII
      const headerBuffer = Buffer.alloc(20);
      ASSEMBLY_STORE_MAGIC.copy(headerBuffer, 0);
      headerBuffer.writeUInt32LE(json_hdr.version, 4);
      headerBuffer.writeUInt32LE(json_hdr.lec, 8);
      headerBuffer.writeUInt32LE(json_hdr.gec, 12);
      headerBuffer.writeUInt32LE(json_hdr.store_id, 16);

      fs.writeSync(assemblies_blob_f, headerBuffer, 0, 20, 0);

      const primary = json_hdr.store_id === 0;

      let next_entry_offset = 20;
      let next_data_offset = 20 + (json_hdr.lec * 24) + (json_hdr.gec * 40);

      if (!primary) {
        next_data_offset = 20 + json_hdr.lec * 24;
      }

      // First pass: write entries + DLL content
      for (const assembly of json_data.assemblies) {
        if (assembly.store_idx !== store_data.store_idx) {
          debug('Skipping assembly for another store');
          continue;
        }

        let assembly_data = fs.readFileSync(assembly.file);
        if (assembly.lz4) {
          assembly_data = lz4_compress(assembly_data, assembly.lz4_desc_idx);
        }

        const data_size = assembly_data.length;

        // Write entry data
        const entryBuffer = Buffer.alloc(24);
        entryBuffer.writeUInt32LE(next_data_offset, 0);
        entryBuffer.writeUInt32LE(data_size, 4);
        // The rest 4 uint32 zeros
        entryBuffer.writeUInt32LE(0, 8);
        entryBuffer.writeUInt32LE(0, 12);
        entryBuffer.writeUInt32LE(0, 16);
        entryBuffer.writeUInt32LE(0, 20);

        fs.writeSync(assemblies_blob_f, entryBuffer, 0, 24, next_entry_offset);

        // Write binary data
        fs.writeSync(assemblies_blob_f, assembly_data, 0, data_size, next_data_offset);

        next_data_offset += data_size;
        next_entry_offset += 24;
      }

      if (!primary) {
        fs.closeSync(assemblies_blob_f);
        continue;
      }

      // Second + third pass: write hashes
      let next_hash32_offset = 20 + (json_hdr.lec * 24);
      let next_hash64_offset = 20 + (json_hdr.lec * 24) + (json_hdr.gec * 20);

      const assembly_data = json_data.assemblies;

      // hash32
      const sortedHash32 = sort_assemblies_by_hash(json_data.assemblies, 'hash32');
      if (sortedHash32.length !== json_hdr.gec) {
        console.log(`Sorted hash32 is the wrong length. Expected: ${json_hdr.gec}. Found: ${sortedHash32.length}.`);
        return 24;
      }
      for (const assembly of sortedHash32) {
        const [hash32, hash64] = gen_xxhash(assembly.name, true);
        const mapping_id = assembly.store_id === 0 ? assembly.blob_idx : store_zero_lec + assembly.blob_idx;

        const hash32Buffer = Buffer.alloc(20);
        // hash32 is 4 bytes
        hash32.copy(hash32Buffer, 0);
        // 4 bytes zero
        hash32Buffer.writeUInt32LE(0, 4);
        // mapping_id
        hash32Buffer.writeUInt32LE(mapping_id, 8);
        // local_store_index (blob_idx)
        hash32Buffer.writeUInt32LE(assembly.blob_idx, 12);
        // store_id
        hash32Buffer.writeUInt32LE(assembly.store_id, 16);

        fs.writeSync(assemblies_blob_f, hash32Buffer, 0, 20, next_hash32_offset);
        next_hash32_offset += 20;
      }

      // hash64
      const sortedHash64 = sort_assemblies_by_hash(json_data.assemblies, 'hash64');
      if (sortedHash64.length !== json_hdr.gec) {
        console.log(`Sorted hash64 is the wrong length. Expected: ${json_hdr.gec}. Found: ${sortedHash64.length}.`);
        return 25;
      }
      for (const assembly of sortedHash64) {
        const [hash32, hash64] = gen_xxhash(assembly.name, true);
        const mapping_id = assembly.store_id === 0 ? assembly.blob_idx : store_zero_lec + assembly.blob_idx;

        const hash64Buffer = Buffer.alloc(20);
        // hash64 is 8 bytes
        hash64.copy(hash64Buffer, 0);
        // mapping_id
        hash64Buffer.writeUInt32LE(mapping_id, 8);
        // local_store_index (blob_idx)
        hash64Buffer.writeUInt32LE(assembly.blob_idx, 12);
        // store_id
        hash64Buffer.writeUInt32LE(assembly.store_id, 16);

        fs.writeSync(assemblies_blob_f, hash64Buffer, 0, 20, next_hash64_offset);
        next_hash64_offset += 20;
      }

      fs.closeSync(assemblies_blob_f);
    }
  }
  return 0;
}

function sort_assemblies_by_hash(assembly_data, key) {
  let sortedHash = [...assembly_data];

  // only keep assemblies belonging to: the primary store, and the first architecture-specific store
  sortedHash = sortedHash.filter(assembly => assembly.store_idx < 2);

  // sort by hash => lexicographical order of hex-encoded strings
  sortedHash.sort((a, b) => {
    a = a[key];
    b = b[key];

    return (a > b) ? 1 : ((a < b) ? -1 : 0);
  });

  return sortedHash;
}

/** Command handlers **/

function unpack_store(args) {
  // Simple argument parsing
  const yargs = require('yargs/yargs');

  const parser = yargs(args)
    .usage('Usage: jsxamstore unpack [options]')
    .option('dir', {
      alias: 'd',
      type: 'string',
      default: './',
      describe: 'Where to load blobs/manifest from.',
    })
    .option('out', {
      alias: 'o',
      type: 'string',
      default: './out/',
      describe: 'Where to save dlls/manifest to.',
    })
    .option('arch', {
      alias: 'a',
      array: true,
      type: 'string',
      default: [],
      describe: 'Which architectures to unpack. By default, all are selected. To select a subset, repeat flag with any combination of: "arm", "arm64", "x86", "x86_64". To exclude all, use: "no" or "0".',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Force re-create out/ directory.',
    })
    .help(true)
    .version(false);

  const parsed_args = parser.parse();

  return do_unpack(parsed_args.dir, parsed_args.out, parsed_args.arch, parsed_args.force);
}

function pack_store(args) {
  const yargs = require('yargs/yargs');

  const parser = yargs(args)
    .usage('Usage: jsxamstore pack [options]')
    .option('config', {
      alias: 'c',
      type: 'string',
      default: 'assemblies.json',
      describe: 'Input assemblies.json file.',
    })
    .option('out', {
      alias: 'o',
      type: 'string',
      default: './out/',
      describe: 'Where to save blobs/manifest to.',
    })
    .help(true)
    .version(false);

  const parsed_args = parser.parse();

  return do_pack(parsed_args.config, parsed_args.out);
}

function gen_hash(args) {
  if (args.length < 1) {
    console.log('Need to provide a string to hash!');
    return 31;
  }

  const file_name = args.shift();
  const hash_name = path.parse(path.basename(file_name)).name;

  console.log(`Generating hashes for string '${file_name}' (${hash_name})`);
  const [hash32, hash64] = gen_xxhash(hash_name);

  console.log(`Hash32: 0x${hash32}`);
  console.log(`Hash64: 0x${hash64}`);

  return 0;
}

/** Main **/

function main() {
  if (argv.length < 3) {
    console.log('Mode is required!');
    usage();
    return 1;
  }

  const mode = argv[2];
  const args = argv.slice(3);

  switch (mode) {
    case 'unpack':
      return unpack_store(args);
    case 'pack':
      return pack_store(args);
    case 'hash':
      return gen_hash(args);
    case '-h':
    case '--h':
    case 'help':
      return usage();
    default:
      console.log(`Unknown mode: '${mode}'`);
      return 2;
  }
}

async function init() {
  lz4 = await lz4BlockCodec.createInstance();

  const ret = main();
  exit(ret);
}

if (require.main === module) {
  init()
}
