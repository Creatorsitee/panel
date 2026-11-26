export const NON_EDITABLE_BINARY_EXTENSIONS = new Set([

  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.tbz',
  '.tbz2',
  '.xz',
  '.txz',
  '.zst',
  '.tzst',
  '.lz',
  '.lzma',
  '.7z',
  '.rar',
  '.cab',
  '.ar',
  '.cpio',
  '.iso',
  '.img',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.apk',
  '.xapk',
  '.apks',
  '.aab',
  '.ipa',
  '.jar',
  '.war',
  '.ear',
  '.whl',
  '.egg',
  '.nupkg',

  '.png',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.icns',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
  '.raw',
  '.cr2',
  '.nef',
  '.arw',
  '.dng',
  '.psd',
  '.psb',
  '.xcf',
  '.ai',
  '.eps',

  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.aiff',
  '.mid',
  '.midi',
  '.mp4',
  '.m4v',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.3gp',
  '.ts',

  '.m2ts',

  '.exe',
  '.msi',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.class',
  '.pyc',
  '.pyo',
  '.pyd',
  '.o',
  '.a',
  '.obj',
  '.lib',
  '.wasm',
  '.elf',
  '.out',
  '.appimage',
  '.node',

  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',

  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.db-wal',
  '.db-shm',
  '.mdb',
  '.accdb',
  '.parquet',
  '.feather',
  '.arrow',
  '.pkl',
  '.pickle',
  '.pt',
  '.pth',
  '.onnx',
  '.safetensors',
  '.gguf',
  '.h5',
  '.hdf5',
]);

NON_EDITABLE_BINARY_EXTENSIONS.delete('.ts');

const COMPOUND_ARCHIVE_SUFFIXES = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tar.zst',
  '.tar.lz',
  '.tar.lzma',
];

export function isEditableTextFile(filename: string): boolean {
  const baseName = filename.split('/').pop()?.toLowerCase().trim() ?? '';
  if (!baseName) return false;

  for (const suffix of COMPOUND_ARCHIVE_SUFFIXES) {
    if (baseName.endsWith(suffix)) {
      return false;
    }
  }

  const idx = baseName.lastIndexOf('.');
  if (idx <= 0) {

    if (idx === 0) {
      return !NON_EDITABLE_BINARY_EXTENSIONS.has(baseName);
    }
    return true;
  }

  const ext = baseName.slice(idx);
  return !NON_EDITABLE_BINARY_EXTENSIONS.has(ext);
}
