### [_jsxamstore_](https://github.com/warren-bank/node-jsxamstore)

Xamarin AssemblyStore Explorer

#### Summary

* rewrite of [_pyxamstore_](https://github.com/jakev/pyxamstore) by [Jake Valletta](https://github.com/jakev)
* converted implementation from Python to JavaScript
* made a few tweaks

- - - -

#### Installation

```bash
  npm install --global "@warren-bank/jsxamstore"
```

#### Usage

##### Unpacking:

I recommend using the tool in conjunction with [`apktool`](https://github.com/iBotPeaches/Apktool).
Run the following commands to unpack an APK, and unpack the Xamarin DLLs:

```bash
  apktool d yourapp.apk
  jsxamstore unpack -d yourapp/unknown/assemblies/
```

Assemblies that are detected as compressed with LZ4 will be automatically decompressed in the extraction process.

##### Repacking:

If you want to make changes to the DLLs within the AssemblyStore,
you can use `jsxamstore` along with the `assemblies.json` generated during the unpack to create a new `assemblies.blob` file(s).
Run the following command from the directory where your `assemblies.json` file exists:

```bash
  jsxamstore pack
```

From here you'll need to copy the new manifest and blobs as well as repackage/sign the APK.

##### Help:

```bash
> jsxamstore help

usage: node jsxamstore.js MODE <args>

MODES:
  unpack <args>  Unpack assembly blobs.
  pack <args>    Repackage assembly blobs.
  hash file_name Generate xxHash values.
  help           Print this message.
```

```bash
> jsxamstore unpack --help

Usage: jsxamstore unpack [options]

Options:
  -d, --dir    Where to load blobs/manifest from.       [string] [default: "./"]
  -o, --out    Where to save dlls/manifest to.      [string] [default: "./out/"]
  -a, --arch   Which architecture to unpack: arm(64), x86(_64). No action if a
               blob for the chosen architecture does not exist. When no valid
               architecture is chosen, unpack the primary blob.
                                                          [string] [default: ""]
  -f, --force  Force re-create out/ directory.        [boolean] [default: false]
      --help   Show help                                               [boolean]
```

```bash
> jsxamstore pack --help

Usage: jsxamstore pack [options]

Options:
  -c, --config  Input assemblies.json file.[string] [default: "assemblies.json"]
  -o, --out     Where to save blobs/manifest to.    [string] [default: "./out/"]
      --help    Show help                                              [boolean]
```

- - - -

#### Related Reading

* [several articles written by _Jake Valletta_](https://www.thecobraden.com/posts/unpacking_xamarin_assembly_stores/)
  - author of: [_pyxamstore_](https://github.com/jakev/pyxamstore)
* [Unpacking Xamarin Android Mobile Applications](https://cihansol.com/blog/index.php/2021/08/09/unpacking-xamarin-android-mobile-applications/)
  - author of: [_XamAsmUnZ_](https://github.com/cihansol/XamAsmUnZ)
* [Introduction to the Exploitation of Xamarin Apps](https://medium.com/@justmobilesec/introduction-to-the-exploitation-of-xamarin-apps-fde4619a51bf)
* [Decompiling an Android Application Written in .NET MAUI](https://mwalkowski.com/post/decompiling-an-android-application-written-in-net-maui-9-xamarin/)

#### Known Limitations

* DLLs that have debug/config data associated with them

#### Legal

* copyright: [Warren Bank](https://github.com/warren-bank)
* license: [GPL-2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt)
