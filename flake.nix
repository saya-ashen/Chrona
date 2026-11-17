{
  description = "Chrona kernel, host, CLI and SDK";

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
      pkgs = import nixpkgs {
        inherit system;
        overlays = [(final: prev: {
          bun = prev.bun.overrideAttrs (old: {
            version = "1.4.2";
            passthru = old.passthru // {
              # Keep explicit platform asset overrides for Bun 1.4 release artifacts.
              sources = builtins.mapAttrs (platform: source: final.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-${source.name}.zip";
                inherit (source) hash;
              }) {
                aarch64-darwin = { name = "darwin-aarch64"; hash = "sha256-kJh6OhbX21VtiGrD1VHnttPt8KHPQ6yu1iLoZ2vh0S8="; };
                aarch64-linux = { name = "linux-aarch64"; hash = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac="; };
                x86_64-linux = { name = "linux-x64-baseline"; hash = "sha256-xngEDxT+BEDrg503y9DOTAUaMtpygGrJfeamqra/co8="; };
              };
            };
          });
        })];
      };
      smokeTools = with pkgs; [
        bun
        git
        stdenv.cc
        gnutar
        gzip
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
        outputHash = "sha256-L64cmtpCQ4B0J0ynrCxlfItou7O88tSVwDZ0mMBMu2I=";
        dontCheckForBrokenSymlinks = true;
        dontPatchShebangs = true;
        dontFixup = true;
        buildPhase = ''
          export HOME=$TMPDIR
          bun install --frozen-lockfile --ignore-scripts
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
          git
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

          wrapProgram $out/bin/chrona --prefix PATH : ${pkgs.lib.makeBinPath [pkgs.git pkgs.bun pkgs.bash]}

          runHook postInstall
        '';

        meta = {
          description = "Kernel and host runtime for independently maintained applications";
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

          bun install --frozen-lockfile
          bun run ci:local
          bun run build
          bun run build:smoke
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
        packages = with pkgs; [
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
        ];

        shellHook = ''
          export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
        '';
      };

    });
}
