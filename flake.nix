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
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_22
            uv
            python313
            sqlite
            pkg-config
            openssl
          ];

          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers"
          '';
        };
      });
}
