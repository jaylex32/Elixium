cmake_minimum_required(VERSION 3.22.1)
project(elixiumnode)

# The runtime is downloaded at build time rather than committed; NODE_DIR points
# at where the fetch task unpacked it.
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
        IMPORTED_LOCATION ${NODE_DIR}/bin/${ANDROID_ABI}/libnode.so)

include_directories(${NODE_DIR}/include/node)

add_library(elixiumnode SHARED src/main/cpp/node-bridge.cpp)

find_library(log-lib log)
target_link_libraries(elixiumnode node ${log-lib})
