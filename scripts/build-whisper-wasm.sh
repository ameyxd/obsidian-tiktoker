#!/usr/bin/env bash
# Reproducible build of the vendored whisper WASM engine
# (src/vendor/whisper-wasm.js), used for on-device transcription on mobile.
#
# Why a custom build instead of an off-the-shelf package:
# every prebuilt whisper WASM (including @transcribe/shout) is compiled with
# pthreads, which declares WebAssembly.Memory({shared: true}) and therefore
# requires SharedArrayBuffer. Obsidian mobile is a Capacitor WebView, which
# does not expose SharedArrayBuffer and cannot set the COOP/COEP headers that
# would enable it, so those builds cannot even instantiate. This build removes
# threading entirely.
#
# Requirements: emscripten (brew install emscripten) and cmake.
# Usage: ./scripts/build-whisper-wasm.sh [whisper.cpp git ref]

set -euo pipefail

WHISPER_REF="${1:-080bbbe85230f624f0b52127f1ae1218247989f9}"
WORKDIR="$(mktemp -d -t whisper-wasm-build.XXXXXX)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$REPO_ROOT/src/vendor/whisper-wasm.txt"

for cmd in emcc cmake git python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing dependency: $cmd" >&2; exit 1; }
done

echo "Building whisper.cpp @ $WHISPER_REF in $WORKDIR"
git clone https://github.com/ggml-org/whisper.cpp "$WORKDIR/whisper.cpp"
cd "$WORKDIR/whisper.cpp"
git checkout --quiet "$WHISPER_REF"

python3 - <<'PATCH'
import re

# 1. Drop the global -pthread flags. Upstream adds them only because the
#    linker requests --shared-memory via USE_PTHREADS; patch 2 removes that,
#    so compile and link stay consistently thread-free.
p = 'CMakeLists.txt'
s = open(p).read()
old = '''    set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}   -pthread")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -pthread")'''
new = '''    set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}   -DGGML_NO_OPENMP")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DGGML_NO_OPENMP")'''
assert old in s, 'global -pthread flags not found'
open(p, 'w').write(s.replace(old, new, 1))

# 2. Replace the example link flags: no pthreads, mobile-sized memory
#    (64MB initial, grows to 1GB instead of a 512MB up-front allocation),
#    and MODULARIZE so esbuild can bundle it as a factory function.
p = 'examples/whisper.wasm/CMakeLists.txt'
s = open(p).read()
new_flags = '''set_target_properties(${TARGET} PROPERTIES LINK_FLAGS " \\
    --bind \\
    -s MODULARIZE=1 \\
    -s EXPORT_NAME=createWhisperModule \\
    -s INITIAL_MEMORY=64MB \\
    -s MAXIMUM_MEMORY=1024MB \\
    -s ALLOW_MEMORY_GROWTH=1 \\
    -s FORCE_FILESYSTEM=1 \\
    -s EXPORTED_RUNTIME_METHODS=\\"['print', 'printErr', 'ccall', 'cwrap', 'HEAPU8', 'FS', 'FS_createDataFile', 'FS_unlink']\\" \\
    ${EXTRA_FLAGS} \\
    ")'''
s2 = re.sub(r'set_target_properties\(\$\{TARGET\} PROPERTIES LINK_FLAGS " \\.*?\n    "\)',
            new_flags, s, count=1, flags=re.S)
assert s2 != s, 'example LINK_FLAGS block not replaced'
assert 'USE_PTHREADS' not in s2
open(p, 'w').write(s2)

# 3. Run inference synchronously. Upstream wraps whisper_full in a
#    std::thread, which aborts with "thread constructor failed" in a
#    thread-free build. The plugin runs this module inside a Web Worker
#    instead, so the UI stays responsive.
p = 'examples/whisper.wasm/emscripten.cpp'
s = open(p).read()
old = """        // run the worker
        {
            g_worker = std::thread([index, params, pcmf32 = std::move(pcmf32), is_multilingual]() {
                whisper_reset_timings(g_contexts[index]);
                whisper_full(g_contexts[index], params, pcmf32.data(), pcmf32.size());
                whisper_print_timings(g_contexts[index]);
                if (is_multilingual) {
                    free((void*)params.language);
                }
            });
        }"""
new = """        {
            whisper_reset_timings(g_contexts[index]);
            whisper_full(g_contexts[index], params, pcmf32.data(), pcmf32.size());
            whisper_print_timings(g_contexts[index]);
            if (is_multilingual) {
                free((void*)params.language);
            }
        }"""
assert old in s, 'worker block not found'
s = s.replace(old, new, 1)
s = s.replace("""        if (g_worker.joinable()) {
            g_worker.join();
        }

""", '', 1)
open(p, 'w').write(s)
print('patches applied')
PATCH

emcmake cmake -B build-em \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_WASM_SINGLE_FILE=ON \
  -DGGML_OPENMP=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF

cmake --build build-em --target libmain -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

ARTIFACT="build-em/bin/libmain.js"
[ -f "$ARTIFACT" ] || { echo "Build produced no artifact" >&2; exit 1; }

# Fail loudly if a threaded build slipped through: it would be unloadable on mobile
for forbidden in 'shared:true' 'SharedArrayBuffer' 'pthread_create'; do
  if grep -aq "$forbidden" "$ARTIFACT"; then
    echo "FAIL: artifact contains '$forbidden' - it would not load on Obsidian mobile" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$OUTPUT")"
{
  echo "// GENERATED FILE - DO NOT EDIT."
  echo "// whisper.cpp ($WHISPER_REF) compiled to WebAssembly, thread-free so it"
  echo "// runs in Obsidian mobile's WebView (shared memory is unavailable there)."
  echo "// Regenerate with: ./scripts/build-whisper-wasm.sh"
  echo "// License: MIT (whisper.cpp, ggml)"
  cat "$ARTIFACT"
} > "$OUTPUT"

echo "Wrote $OUTPUT ($(wc -c < "$OUTPUT") bytes)"
rm -rf "$WORKDIR"
