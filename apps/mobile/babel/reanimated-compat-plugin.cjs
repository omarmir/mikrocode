const Module = require("module");
const { createRequire } = require("module");

const expoRequire = createRequire(require.resolve("expo/package.json"));
const coreRequire = createRequire(expoRequire.resolve("@babel/core"));
const redirectedModules = new Map(
  ["@babel/core", "@babel/generator", "@babel/parser", "@babel/traverse", "@babel/types"].map(
    (name) => [name, coreRequire.resolve(name)],
  ),
);

function shouldRedirect(parentFilename) {
  return (
    typeof parentFilename === "string" &&
    (parentFilename.includes("/react-native-worklets/") ||
      parentFilename.includes("/react-native-reanimated/"))
  );
}

if (!globalThis.__mikrocodeReanimatedCompatInstalled) {
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    const redirected = redirectedModules.get(request);
    if (redirected && shouldRedirect(parent?.filename)) {
      return redirected;
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  globalThis.__mikrocodeReanimatedCompatInstalled = true;
}

module.exports = require("react-native-reanimated/plugin");
