const { resolve } = require("node:path");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");

/**
 * The Agent's generated file: closure has no node_modules until installation.
 * Resolve each declared local dependency as an installed package, including its
 * public exports, before applying the host workspace's TypeScript aliases.
 */
class LocalFileDependenciesPlugin {
  apply(resolver) {
    const target = resolver.ensureHook("undescribedResolveInPackage");
    resolver.getHook("describedResolve").tapAsync("LocalFileDependenciesPlugin", (request, context, callback) => {
      const specifier = request.request;
      if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || !request.descriptionFileRoot) return callback();
      const segments = specifier.split("/");
      const name = segments.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
      const manifest = request.descriptionFileData;
      const dependency = manifest?.dependencies?.[name] ?? manifest?.optionalDependencies?.[name] ?? manifest?.peerDependencies?.[name];
      if (typeof dependency !== "string" || !dependency.startsWith("file:")) return callback();
      const subpath = specifier.slice(name.length);
      return resolver.doResolve(target, {
        ...request,
        path: resolve(request.descriptionFileRoot, dependency.slice(5)),
        request: subpath ? `.${subpath}` : ".",
        relativePath: undefined,
        descriptionFilePath: undefined,
        descriptionFileRoot: undefined,
        descriptionFileData: undefined,
      }, `local file dependency ${name}`, context, (error, result) => {
        if (error || result) return callback(error, result);
        return callback(new Error(`Cannot resolve declared local dependency ${name}: ${dependency}`));
      });
    });
  }
}

module.exports = {
  resolve: {
    plugins: [
      new LocalFileDependenciesPlugin(),
      new TsconfigPathsPlugin({
        configFile: resolve(__dirname, "tsconfig.json"),
        extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts"],
      }),
    ],
  },
};
