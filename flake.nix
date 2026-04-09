{
  description = "AgentDashboard development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
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
      in {
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
