#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEFAULT_JAVA_HOME="${HOME}/.local/share/jdks/temurin-17"
DEFAULT_ANDROID_SDK_ROOT="${HOME}/.local/android-sdk"
DEFAULT_NODE_VERSION="v24.13.1"
DEFAULT_NODE_HOME="${HOME}/.local/share/nodes/${DEFAULT_NODE_VERSION}-linux-x64"
JDK_DOWNLOAD_URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
NODE_DOWNLOAD_URL="https://nodejs.org/dist/${DEFAULT_NODE_VERSION}/node-${DEFAULT_NODE_VERSION}-linux-x64.tar.xz"

resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    printf '%s\n' "${JAVA_HOME}"
    return
  fi

  if command -v java >/dev/null 2>&1; then
    local java_bin
    java_bin="$(command -v java)"
    printf '%s\n' "$(cd "$(dirname "${java_bin}")/.." && pwd)"
    return
  fi

  if [[ -x "${DEFAULT_JAVA_HOME}/bin/java" ]]; then
    printf '%s\n' "${DEFAULT_JAVA_HOME}"
    return
  fi

  mkdir -p "$(dirname "${DEFAULT_JAVA_HOME}")"
  local archive_path="${DEFAULT_JAVA_HOME}.tar.gz"
  local temp_dir="${DEFAULT_JAVA_HOME}.tmp"

  echo "Bootstrapping Temurin 17 into ${DEFAULT_JAVA_HOME}..."
  curl -L "${JDK_DOWNLOAD_URL}" -o "${archive_path}"
  rm -rf "${temp_dir}"
  mkdir -p "${temp_dir}"
  tar -xzf "${archive_path}" -C "${temp_dir}" --strip-components=1
  rm -rf "${DEFAULT_JAVA_HOME}"
  mv "${temp_dir}" "${DEFAULT_JAVA_HOME}"
  printf '%s\n' "${DEFAULT_JAVA_HOME}"
}

resolve_android_sdk_root() {
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
    printf '%s\n' "${ANDROID_HOME}"
    return
  fi

  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}" ]]; then
    printf '%s\n' "${ANDROID_SDK_ROOT}"
    return
  fi

  if [[ -d "${DEFAULT_ANDROID_SDK_ROOT}" ]]; then
    printf '%s\n' "${DEFAULT_ANDROID_SDK_ROOT}"
    return
  fi

  echo "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT first." >&2
  exit 1
}

resolve_node_home() {
  if [[ -n "${NODE_HOME:-}" && -x "${NODE_HOME}/bin/node" ]]; then
    printf '%s\n' "${NODE_HOME}"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    local system_node_version
    system_node_version="$(node --version)"
    if [[ "${system_node_version}" == "${DEFAULT_NODE_VERSION}" ]]; then
      printf '%s\n' "$(cd "$(dirname "$(command -v node)")/.." && pwd)"
      return
    fi
  fi

  if [[ -x "${DEFAULT_NODE_HOME}/bin/node" ]]; then
    printf '%s\n' "${DEFAULT_NODE_HOME}"
    return
  fi

  mkdir -p "$(dirname "${DEFAULT_NODE_HOME}")"
  local archive_path="${DEFAULT_NODE_HOME}.tar.xz"
  local temp_dir="${DEFAULT_NODE_HOME}.tmp"

  echo "Bootstrapping Node ${DEFAULT_NODE_VERSION} into ${DEFAULT_NODE_HOME}..."
  curl -L "${NODE_DOWNLOAD_URL}" -o "${archive_path}"
  rm -rf "${temp_dir}"
  mkdir -p "${temp_dir}"
  tar -xJf "${archive_path}" -C "${temp_dir}"
  rm -rf "${DEFAULT_NODE_HOME}"
  mv "${temp_dir}/node-${DEFAULT_NODE_VERSION}-linux-x64" "${DEFAULT_NODE_HOME}"
  rmdir "${temp_dir}"
  printf '%s\n' "${DEFAULT_NODE_HOME}"
}

JAVA_HOME="$(resolve_java_home)"
ANDROID_SDK_ROOT="$(resolve_android_sdk_root)"
ANDROID_HOME="${ANDROID_SDK_ROOT}"
NODE_HOME="$(resolve_node_home)"

export JAVA_HOME
export ANDROID_HOME
export ANDROID_SDK_ROOT
export NODE_HOME
export PATH="${NODE_HOME}/bin:${JAVA_HOME}/bin:${ANDROID_HOME}/platform-tools:${PATH}"

cd "${REPO_ROOT}/apps/mobile/android"
./gradlew assembleRelease

echo
echo "APK: ${REPO_ROOT}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
