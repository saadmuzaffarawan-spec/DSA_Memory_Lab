// Platform profiles: the "machine" a program runs on.
// Verified against real compilers: Linux/GCC (g++ 13, glibc) via tests/oracle.
// Data models and class layouts for all three ABIs are cross-checked against
// clang's record-layout dumps (x86_64-pc-windows-msvc, x86_64-unknown-linux-gnu, x86_64-apple-darwin).

export type PlatformId = 'windows' | 'linux' | 'macos';
export type Abi = 'msvc' | 'itanium';
export type AllocKind = 'glibc' | 'ucrt' | 'macos';
export type Confidence = 'verified' | 'documented' | 'approximate';

export interface Platform {
  id: PlatformId;
  label: string;
  compiler: string;
  abi: Abi;
  stdlib: 'msvc-stl' | 'libstdc++' | 'libc++';
  longBytes: 4 | 8;
  longDoubleBytes: 8 | 16;
  wcharBytes: 2 | 4;
  wcharSigned: boolean;
  charSigned: boolean;
  sizeTIsLongLong: boolean;
  image: { text: number; rodata: number; data: number; bss: number; textSize: number; rodataSize: number; dataSize: number; bssSize: number };
  heap: { base: number; size: number };
  stack: { top: number; size: number };
  sys: { base: number; size: number; mainReturn: number; mainReturnLabel: string };
  frame: { savedFp: boolean; shadow: number };
  allocator: AllocKind;
  /** debug build behaviours (MSVC /Od + debug CRT) */
  debug: boolean;
  vectorGrowth: 'x2' | 'x1.5';
  /** how confident we are in each part of the model */
  confidence: { dataModel: Confidence; classLayout: Confidence; stdlib: Confidence; heap: Confidence; stack: Confidence };
  faultName: string;
  macros: Record<string, string>;
}

const MB = 1024 * 1024;

export const LINUX: Platform = {
  id: 'linux',
  label: 'Linux x86-64',
  compiler: 'GCC 13 · glibc · libstdc++ (gdb layout, ASLR off)',
  abi: 'itanium',
  stdlib: 'libstdc++',
  longBytes: 8,
  longDoubleBytes: 16,
  wcharBytes: 4,
  wcharSigned: true,
  charSigned: true,
  sizeTIsLongLong: false,
  image: {
    text: 0x555555555000, textSize: 0x10000,
    rodata: 0x555555565000, rodataSize: 0x20000,
    data: 0x555555585000, dataSize: 0x10000,
    bss: 0x555555595000, bssSize: 0x10000,
  },
  heap: { base: 0x5555555a5000, size: 4 * MB },
  stack: { top: 0x7ffffffff000, size: 8 * MB },
  sys: { base: 0x7ffff7c29000, size: 0x1000, mainReturn: 0x7ffff7c29d90, mainReturnLabel: '__libc_start_call_main+128' },
  frame: { savedFp: true, shadow: 0 },
  allocator: 'glibc',
  debug: false,
  vectorGrowth: 'x2',
  confidence: { dataModel: 'verified', classLayout: 'verified', stdlib: 'verified', heap: 'verified', stack: 'verified' },
  faultName: 'Segmentation fault (SIGSEGV)',
  macros: { __linux__: '1', __GNUC__: '13', __x86_64__: '1', __cplusplus: '201703L' },
};

export const WINDOWS: Platform = {
  id: 'windows',
  label: 'Windows x64',
  compiler: 'MSVC · Debug build (/Od) · UCRT · MSVC STL',
  abi: 'msvc',
  stdlib: 'msvc-stl',
  longBytes: 4,
  longDoubleBytes: 8,
  wcharBytes: 2,
  wcharSigned: false,
  charSigned: true,
  sizeTIsLongLong: true,
  image: {
    text: 0x00007ff7a1b21000, textSize: 0x10000,
    rodata: 0x00007ff7a1b31000, rodataSize: 0x20000,
    data: 0x00007ff7a1b51000, dataSize: 0x10000,
    bss: 0x00007ff7a1b61000, bssSize: 0x10000,
  },
  heap: { base: 0x000001f4b7d40000, size: 4 * MB },
  stack: { top: 0x000000c35c800000, size: 1 * MB },
  sys: { base: 0x00007ffb8a1c7000, size: 0x1000, mainReturn: 0x00007ffb8a1c7374, mainReturnLabel: 'BaseThreadInitThunk+0x14' },
  frame: { savedFp: false, shadow: 32 },
  allocator: 'ucrt',
  debug: true,
  vectorGrowth: 'x1.5',
  confidence: { dataModel: 'documented', classLayout: 'documented', stdlib: 'approximate', heap: 'approximate', stack: 'approximate' },
  faultName: 'Access violation (0xC0000005)',
  macros: { _WIN32: '1', _WIN64: '1', _MSC_VER: '1940', _M_X64: '1', __cplusplus: '199711L' },
};

export const MACOS: Platform = {
  id: 'macos',
  label: 'macOS x86-64',
  compiler: 'Apple Clang · libc++ · system malloc',
  abi: 'itanium',
  stdlib: 'libc++',
  longBytes: 8,
  longDoubleBytes: 16,
  wcharBytes: 4,
  wcharSigned: true,
  charSigned: true,
  sizeTIsLongLong: false,
  image: {
    text: 0x0000000100003000, textSize: 0x10000,
    rodata: 0x0000000100013000, rodataSize: 0x20000,
    data: 0x0000000100033000, dataSize: 0x10000,
    bss: 0x0000000100043000, bssSize: 0x10000,
  },
  heap: { base: 0x00007f8d3a504000, size: 4 * MB },
  stack: { top: 0x00007ffeefc00000, size: 8 * MB },
  sys: { base: 0x00007ff80a3d9000, size: 0x1000, mainReturn: 0x00007ff80a3d9418, mainReturnLabel: 'start+1' },
  frame: { savedFp: true, shadow: 0 },
  allocator: 'macos',
  debug: false,
  vectorGrowth: 'x2',
  confidence: { dataModel: 'documented', classLayout: 'documented', stdlib: 'approximate', heap: 'approximate', stack: 'approximate' },
  faultName: 'Segmentation fault: 11 (EXC_BAD_ACCESS)',
  macros: { __APPLE__: '1', __clang__: '1', __x86_64__: '1', __cplusplus: '201703L' },
};

export const PLATFORMS: Record<PlatformId, Platform> = { windows: WINDOWS, linux: LINUX, macos: MACOS };
export const DEFAULT_PLATFORM: PlatformId = 'windows';

export function withOverrides(p: Platform, o: { stackKB?: number; heapKB?: number; debug?: boolean }): Platform {
  const q: Platform = { ...p, stack: { ...p.stack }, heap: { ...p.heap } };
  if (o.stackKB) q.stack.size = o.stackKB * 1024;
  if (o.heapKB) q.heap.size = o.heapKB * 1024;
  if (o.debug !== undefined && p.id === 'windows') q.debug = o.debug;
  return q;
}
