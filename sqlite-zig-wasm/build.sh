#!/bin/bash
set -euo pipefail

# SQLite WASM build script using Zig (wasm32-freestanding, no libc)
# Produces a minimal sqlite3.wasm binary (~553KB, vs 897KB from Emscripten)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Configurable
ZIG="${ZIG:-zig}"
OPTIMIZE="${OPTIMIZE:--O ReleaseSmall}"
OUTPUT="dist/sqlite3.wasm"

mkdir -p dist

# SQLite feature flags — strip unused features for minimum size
SQLITE_FLAGS=(
    # Use custom OS layer (no-op VFS registered in wasm_stubs.c)
    -DSQLITE_OS_OTHER=1
    -DSQLITE_BYTEORDER=1234
    -DSQLITE_OMIT_AUTOINIT

    # Disable unused subsystems
    -DSQLITE_OMIT_LOAD_EXTENSION
    -DSQLITE_OMIT_DEPRECATED
    -DSQLITE_OMIT_UTF16
    -DSQLITE_OMIT_SHARED_CACHE
    -DSQLITE_OMIT_GET_TABLE
    -DSQLITE_OMIT_TRACE
    -DSQLITE_OMIT_AUTHORIZATION
    -DSQLITE_OMIT_EXPLAIN
    -DSQLITE_OMIT_JSON
    -DSQLITE_OMIT_PROGRESS_CALLBACK
    -DSQLITE_OMIT_COMPLETE
    -DSQLITE_OMIT_TCL_VARIABLE
    -DSQLITE_OMIT_DECLTYPE
    -DSQLITE_OMIT_FLAG_PRAGMAS
    -DSQLITE_OMIT_SCHEMA_PRAGMAS
    -DSQLITE_OMIT_SCHEMA_VERSION_PRAGMAS
    -DSQLITE_OMIT_INTEGRITY_CHECK
    -DSQLITE_OMIT_COMPILEOPTION_DIAGS
    -DSQLITE_OMIT_LIKE_OPTIMIZATION
    -DSQLITE_OMIT_INTROSPECTION_PRAGMAS
    -DSQLITE_OMIT_DATETIME_FUNCS
    -DSQLITE_OMIT_BETWEEN_OPTIMIZATION
    -DSQLITE_OMIT_OR_OPTIMIZATION
    -DSQLITE_OMIT_CAST
    -DSQLITE_OMIT_BLOB_LITERAL
    -DSQLITE_OMIT_BUILTIN_TEST
    -DSQLITE_OMIT_LOOKASIDE

    # Disable full-text search, R-tree, geo
    -DSQLITE_OMIT_FTS3
    -DSQLITE_OMIT_FTS4
    -DSQLITE_OMIT_FTS5
    -DSQLITE_OMIT_RTREE
    -DSQLITE_OMIT_GEOPOLY

    # Disable WAL (not needed for in-memory)
    -DSQLITE_OMIT_WAL

    # No threads in WASM
    -DSQLITE_THREADSAFE=0

    # Use memory for temp storage
    -DSQLITE_TEMP_STORE=3

    # Smaller defaults
    -DSQLITE_DEFAULT_MEMSTATUS=0
    -DSQLITE_DEFAULT_PAGE_SIZE=4096
    -DSQLITE_DEFAULT_CACHE_SIZE=10
    -DSQLITE_DEFAULT_MMAP_SIZE=0
    -DSQLITE_MAX_EXPR_DEPTH=0

    # Disable stack protector (not meaningful in WASM sandbox)
    -fno-stack-protector

    # Use custom stub headers instead of system libc
    -nostdinc
    -isystem src/include
)

echo "Building sqlite3.wasm (freestanding)..."
$ZIG build-exe \
    src/exports.zig \
    -target wasm32-freestanding \
    $OPTIMIZE \
    -fstrip \
    -fsingle-threaded \
    -fno-entry \
    -rdynamic \
    --export-table \
    --initial-memory=33554432 \
    --global-base=6560 \
    --gc-sections \
    -cflags "${SQLITE_FLAGS[@]}" -- \
    -Ivendor -Isrc vendor/sqlite3.c src/wasm_stubs.c \
    -femit-bin="$OUTPUT"

SIZE=$(wc -c < "$OUTPUT")
echo ""
echo "Built: $OUTPUT ($SIZE bytes, $(( SIZE / 1024 ))KB)"
echo "  Official sqlite3.wasm (Emscripten): 897KB"
echo "  wa-sqlite:                          566KB"
