{
  description = "Chrona packages and modules";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    flake-utils.url = "github:numtide/flake-utils";

    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    home-manager,
  }: let
    version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
    nixosModule = import ./nix/modules/nixos.nix {inherit self;};
    homeManagerModule = import ./nix/modules/home-manager.nix {inherit self;};
  in {
    overlays.default = final: _prev: {
      chrona = self.packages.${final.stdenv.hostPlatform.system}.chrona;
    };

    nixosModules = {
      default = nixosModule;
      chrona = nixosModule;
    };

    homeManagerModules = {
      default = homeManagerModule;
      chrona = homeManagerModule;
    };
  }
  // flake-utils.lib.eachDefaultSystem (system: let
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
      source = pkgs.lib.cleanSourceWith {
        src = self;
        filter = path: type:
          let
            name = baseNameOf path;
          in
            !(builtins.elem name [".codegraph" "node_modules" "dist" "result"]);
      };

      chronaNodeModules = pkgs.stdenv.mkDerivation {
        name = "chrona-node-modules";
        src = source;
        nativeBuildInputs = [pkgs.bun];
        outputHashMode = "recursive";
        outputHashAlgo = "sha256";
        outputHash = "sha256-6Gsc4Fh13T6G01tUcy/hhtsiVLCeekrTl6PMQfkb6Sc=";
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
    in let
      chrona = pkgs.stdenv.mkDerivation {
        pname = "chrona";
        inherit version;
        src = source;
        nativeBuildInputs = with pkgs; [
          bun
          nodejs_22
          makeWrapper
        ];
        PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/schema-engine";
        # Bun appends the compiled application payload to the ELF file. Nix's
        # generic ELF rewriting invalidates that payload and turns the result
        # back into a bare Bun executable.
        dontPatchELF = true;
        dontStrip = true;

        buildPhase = ''
          runHook preBuild

          export HOME=$TMPDIR
          rm -rf node_modules
          cp -r ${chronaNodeModules}/node_modules node_modules
          chmod -R u+w node_modules
          patchShebangs node_modules

          mkdir -p .local/bin
          ln -sf ${pkgs.nodejs_22}/bin/node .local/bin/node
          export PATH="$PWD/.local/bin:$PATH"

          bun run build

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          release_dir="$(find dist/releases -mindepth 1 -maxdepth 1 -type d | head -n 1)"
          test -n "$release_dir"
          mkdir -p $out/bin
          cp -r "$release_dir/resources" $out/bin/resources
          install -Dm755 "$release_dir/chrona" $out/bin/chrona
          for addon in "$release_dir"/*.node; do
            test -e "$addon" || continue
            cp "$addon" $out/bin/
          done

          runHook postInstall
        '';

        meta = {
          description = "Local AI work executor for governed planning, scheduling, recovery, and results";
          homepage = "https://github.com/saya-ashen/Chrona";
          license = pkgs.lib.licenses.mit;
          mainProgram = "chrona";
          platforms = pkgs.lib.platforms.unix;
        };
      };
    in {
      packages = {
        inherit chrona;
        default = chrona;
      };

      apps = {
        default = {
          type = "app";
          program = pkgs.lib.getExe chrona;
        };
        chrona = {
          type = "app";
          program = pkgs.lib.getExe chrona;
        };
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
          test -f "$TMP/data/chrona.db"

          echo "binary smoke test passed"
        '');
      };
      checks = {
        package = chrona;
      }
      // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
        nixos-module = pkgs.runCommand "chrona-nixos-module-check" {} ''
          test ${pkgs.lib.escapeShellArg ((nixpkgs.lib.nixosSystem {
            inherit system;
            modules = [
              self.nixosModules.default
              {
                services.chrona.enable = true;
              }
            ];
          }).config.systemd.services.chrona.serviceConfig.User)} = chrona
          touch $out
        '';
        home-manager-module = (home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          modules = [
            self.homeManagerModules.default
            {
              home = {
                username = "chrona";
                homeDirectory = "/tmp/chrona-home";
                stateVersion = "26.05";
              };
              services.chrona.enable = true;
            }
          ];
        }).activationPackage;
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
          export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
          export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath playwrightLibs}:''${LD_LIBRARY_PATH:-}"
        '';
      };

    });
}
