const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const projectNodeModules = path.join(projectRoot, "node_modules");
const workspaceNodeModules = path.join(workspaceRoot, "node_modules");

const reactNativeMarkedRuntimeDeps = [
  "html-entities",
  "marked",
  "github-slugger",
  "react-native-reanimated-table",
  "svg-parser",
  "@jsamr/react-native-li",
  "@jsamr/counter-style",
  "react-native-svg",
];

const config = getDefaultConfig(projectRoot);

const defaultNodeModulesPaths = config.resolver.nodeModulesPaths ?? [];
const preferredNodeModulesPaths = [projectNodeModules, workspaceNodeModules];

config.resolver.nodeModulesPaths = [
  ...preferredNodeModulesPaths,
  ...defaultNodeModulesPaths.filter((candidate) => !preferredNodeModulesPaths.includes(candidate)),
];

const extraNodeModules = { ...config.resolver.extraNodeModules };

for (const packageName of reactNativeMarkedRuntimeDeps) {
  try {
    extraNodeModules[packageName] = fs.realpathSync(path.join(projectNodeModules, packageName));
  } catch {
    // Ignore packages that are not installed in this checkout.
  }
}

// Metro can see the app-local Bun symlinks in nodeModulesPaths, but it won't
// resolve through those symlink paths reliably once a dependency was loaded from
// the real .bun store path. Point react-native-marked's runtime deps at their
// real package directories so transitive imports resolve deterministically.
config.resolver.extraNodeModules = extraNodeModules;

module.exports = config;
