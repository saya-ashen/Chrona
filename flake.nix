{
  description = "Chrona development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
      playwrightLibs = with pkgs; [
        glib
        nspr
        nss
        atk
        at-spi2-atk
        at-spi2-core
        dbus
        expat
        libdrm
        libgbm
        mesa
        libxkbcommon
        alsa-lib
        udev
        cups
        gtk3
        pango
        cairo
        xorg.libX11
        xorg.libXcomposite
        xorg.libXdamage
        xorg.libXext
        xorg.libXfixes
        xorg.libXrandr
        xorg.libxcb
      ];
      smokeTools = with pkgs; [
        bun
        nodejs_22
        coreutils
        findutils
        gnugrep
        gnused
        sqlite
        prisma-engines
      ];

      chronaNodeModules = pkgs.stdenv.mkDerivation {
        name = "chrona-node-modules";
        src = self;
        nativeBuildInputs = [ pkgs.bun ];
        outputHashMode = "recursive";
        outputHashAlgo = "sha256";
        outputHash = "sha256-SYKc1Hu5MHi2QUC/ZTtfSmudZI3ja5M9MXseFzFk2Ek=";
        dontCheckForBrokenSymlinks = true;
        dontPatchShebangs = true;
        dontFixup = true;
        buildPhase = ''
          export HOME=$TMPDIR
          bun install --ignore-scripts
        '';
        installPhase = ''
          mkdir -p $out
          cp -r node_modules $out/
        '';
      };
    in {
      packages.chrona = pkgs.stdenv.mkDerivation {
        name = "chrona-0.1.3";
        src = self;
        nativeBuildInputs = with pkgs; [
          bun
          nodejs_22
          makeWrapper
        ];
        PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/schema-engine";

        buildPhase = ''
          export HOME=$TMPDIR
          rm -rf node_modules
          cp -r ${chronaNodeModules}/node_modules node_modules
          chmod -R u+w node_modules

          mkdir -p .local/bin
          ln -sf ${pkgs.nodejs_22}/bin/node .local/bin/node
          export PATH="$PWD/.local/bin:$PATH"

          ROOT="$PWD"
          (cd apps/web && node "$ROOT/node_modules/vite/bin/vite.js" build)
          bun run build:npm
        '';

        installPhase = ''
          mkdir -p $out/lib/chrona/apps/web $out/lib/chrona/prisma $out/bin

          cp -r dist $out/lib/chrona/
          cp -r apps/web/dist $out/lib/chrona/apps/web/
          cp -r prisma $out/lib/chrona/
          cp .env.example $out/lib/chrona/
          rm -rf node_modules/@chrona node_modules/.bin/chrona node_modules/.bin/agentdash
          cp -r node_modules $out/lib/chrona/

          makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/chrona \
            --add-flags "$out/lib/chrona/dist/cli.js" \
            --set PRISMA_SCHEMA_ENGINE_BINARY ${pkgs.prisma-engines}/bin/schema-engine
        '';
      };

      apps.npm-smoke = {
        type = "app";
        program = toString (pkgs.writeShellScript "chrona-npm-smoke" ''
          set -euo pipefail

          export PATH="${pkgs.lib.makeBinPath smokeTools}:$PATH"
          export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"

          ROOT="$(pwd)"
          TMP="$(mktemp -d)"
          trap 'rm -rf "$TMP"' EXIT

          echo "==> Installing dependencies"
          bun install

          echo "==> Running checks"
          bun run typecheck
          bunx vitest run  # no --coverage to avoid jsdom teardown flakiness

          echo "==> Building npm package"
          bun run build
          bun run build:npm

          echo "==> Packing"
          PKG="$(npm pack --silent)"

          mkdir -p "$TMP/home" "$TMP/app" "$TMP/cache" "$TMP/data" "$TMP/config"

          echo "==> Installing tarball in clean app"
          cd "$TMP/app"
          npm init -y >/dev/null

          HOME="$TMP/home" \
          npm_config_cache="$TMP/cache" \
          npm install "$ROOT/$PKG"

          echo "==> Checking CLI"
          HOME="$TMP/home" \
          CHRONA_DATA_DIR="$TMP/data" \
          CHRONA_CONFIG_DIR="$TMP/config" \
          ./node_modules/.bin/chrona --help

          echo "==> Starting Chrona briefly"
          set +e
          HOME="$TMP/home" \
          CHRONA_DATA_DIR="$TMP/data" \
          CHRONA_CONFIG_DIR="$TMP/config" \
          PORT=3101 \
          timeout 20s ./node_modules/.bin/chrona start
          code="$?"
          set -e

          if [ "$code" != "0" ] && [ "$code" != "124" ]; then
            echo "chrona start failed with exit code $code"
            exit "$code"
          fi

          test -f "$TMP/config/.env"
          test -f "$TMP/data/dev.db"

          echo "npm smoke test passed"
        '');
      };

      devShells.default = pkgs.mkShell {
        packages =
          (with pkgs; [
            bun
            nodejs_22
            prisma-engines
            uv
            python313
            sqlite
            pkg-config
            openssl
            typescript-language-server
            just
          ])
          ++ playwrightLibs;

        shellHook = ''
          export PLAYWRIGHT_BROWSERS_PATH="''${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
          export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath playwrightLibs}:''${LD_LIBRARY_PATH:-}"
        '';
      };
    });
}
