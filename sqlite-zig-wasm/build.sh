#!/bin/bash
set -euo pipefail

# SQLite WASM build script using Zig
# Produces a minimal sqlite3.wasm binary (~600KB, vs 897KB from Emscripten)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Configurable
ZIG="${ZIG:-zig}"
OPTIMIZE="${OPTIMIZE:--O ReleaseSmall}"
OUTPUT="dist/sqlite3.wasm"

mkdir -p dist

# SQLite feature flags — strip unused features for minimum size
SQLITE_FLAGS=(
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
)

echo "Building sqlite3.wasm..."
$ZIG build-exe \
    src/exports.zig \
    -target wasm32-wasi \
    $OPTIMIZE \
    -fstrip \
    -fsingle-threaded \
    -fno-entry \
    -rdynamic \
    --export-table \
    --initial-memory=33554432 \
    --global-base=6560 \
    -mexec-model=reactor \
    --gc-sections \
    -lc \
    -cflags "${SQLITE_FLAGS[@]}" -- \
    -Ivendor vendor/sqlite3.c \
    -femit-bin="$OUTPUT"

SIZE=$(wc -c < "$OUTPUT")
echo "Built: $OUTPUT ($SIZE bytes, $(( SIZE / 1024 ))KB)"
