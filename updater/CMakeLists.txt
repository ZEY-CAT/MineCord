cmake_minimum_required(VERSION 3.20)
project(MineCordUpdater LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Fetch nlohmann/json
include(FetchContent)
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(nlohmann_json)

# Windows-specific settings
if(WIN32)
    add_definitions(-DWIN32 -D_WIN32_WINNT=0x0A00 -DUNICODE -D_UNICODE)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /W3 /WX- /MP")
    if(CMAKE_BUILD_TYPE STREQUAL "Release")
        set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /O2 /Ob2 /DNDEBUG")
    elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} /Od /Zi /D_DEBUG")
    endif()
endif()

# Platform-specific definitions
add_definitions(-DMINE_CORD_UPDATER_EXPORTS)

# Output directories
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/${CMAKE_BUILD_TYPE}")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/${CMAKE_BUILD_TYPE}")
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/${CMAKE_BUILD_TYPE}")

# Sources
set(SOURCES
    src/MineCordUpdater.cpp
    src/UpdateCheck.cpp
    src/Download.cpp
    src/Install.cpp
    src/Verify.cpp
    src/Utils.cpp
)

add_library(MineCordUpdater SHARED ${SOURCES})

target_include_directories(MineCordUpdater PRIVATE src)
target_link_libraries(MineCordUpdater PRIVATE nlohmann_json::nlohmann_json)

# Windows libraries
target_link_libraries(MineCordUpdater PRIVATE
    winhttp.lib
    crypt32.lib
    bcrypt.lib
    shell32.lib
    userenv.lib
    version.lib
    shlwapi.lib
)

# Export all symbols on Windows using .def file for undecorated names
if(WIN32)
    target_link_options(MineCordUpdater PRIVATE "/DEF:${CMAKE_CURRENT_SOURCE_DIR}/MineCordUpdater.def")
endif()

# Install targets
install(TARGETS MineCordUpdater
    RUNTIME DESTINATION bin
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
)

# Install headers
install(FILES src/MineCordUpdater.h DESTINATION include)