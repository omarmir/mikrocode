module.exports = function (api) {
  api.cache(true);

  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [require.resolve("./babel/reanimated-compat-plugin.cjs")],
  };
};
