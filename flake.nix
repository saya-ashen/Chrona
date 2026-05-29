{
  description = "Chrona development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

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
        nativeBuildInputs = [pkgs.bun];
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

          bun run build
        '';

        installPhase = ''
          release_dir="$(find dist/releases -mindepth 1 -maxdepth 1 -type d | head -n 1)"
          mkdir -p $out/bin
          cp -r "$release_dir/resources" $out/bin/resources
          cp "$release_dir/chrona" $out/bin/chrona
          chmod +x $out/bin/chrona
        '';
      };

      apps.binary-smoke = {
        type = "app";
        program = toString (pkgs.writeShellScript "chrona-binary-smoke" ''
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

          echo "==> Building binary"
          bun run build

          CHRONA_BIN="$(find "$ROOT/dist/releases" -path "*/chrona" -type f | head -n 1)"
          test -n "$CHRONA_BIN"

          mkdir -p "$TMP/home" "$TMP/data" "$TMP/config"

          echo "==> Checking CLI"
          HOME="$TMP/home" \
          CHRONA_DATA_DIR="$TMP/data" \
          CHRONA_CONFIG_DIR="$TMP/config" \
          "$CHRONA_BIN" --help

          echo "==> Starting Chrona briefly"
          set +e
          HOME="$TMP/home" \
          CHRONA_DATA_DIR="$TMP/data" \
          CHRONA_CONFIG_DIR="$TMP/config" \
          PORT=3101 \
          timeout 20s "$CHRONA_BIN" start
          code="$?"
          set -e

          if [ "$code" != "0" ] && [ "$code" != "124" ]; then
            echo "chrona start failed with exit code $code"
            exit "$code"
          fi

          test -f "$TMP/config/.env"
          test -f "$TMP/data/dev.db"

          echo "binary smoke test passed"
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
