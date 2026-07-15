{self}: {
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.chrona;
  defaultPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.chrona;
  configFile = pkgs.writeText "chrona-config.json" (builtins.toJSON cfg.settings);
  hasStoreApiKey =
    cfg.settings ? security
    && cfg.settings.security ? apiKey
    && cfg.settings.security.apiKey != null;
in {
  options.services.chrona = {
    enable = lib.mkEnableOption "Chrona local AI task server";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression "self.packages.\${pkgs.stdenv.hostPlatform.system}.chrona";
      description = "Chrona package to run.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "chrona";
      description = "User account under which Chrona runs.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "chrona";
      description = "Group account under which Chrona runs.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address on which the Chrona HTTP server listens.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3101;
      description = "Port on which the Chrona HTTP server listens.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the configured TCP port in the NixOS firewall.";
    };

    unsafePublicBind = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Allow Chrona to bind to a non-loopback address. Enable only with suitable access controls.";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/chrona";
      description = "Persistent data directory used for the Chrona SQLite database.";
    };

    configDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/chrona/config";
      description = "Writable directory used for Chrona runtime configuration files.";
    };

    settings = lib.mkOption {
      type = (pkgs.formats.json {}).type;
      default = {};
      example = {
        server.allowedOrigins = ["https://chrona.example.com"];
        experimental.dashboardAiSummary = true;
      };
      description = "Chrona config.json contents. Do not place secrets here because the Nix store is world-readable.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      example = {TZ = "Asia/Shanghai";};
      description = "Additional environment variables for the Chrona service. Do not use this for secrets.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [];
      example = ["/run/keys/chrona.env"];
      description = "Environment files loaded by systemd. Use these for API_KEY and other secrets.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !hasStoreApiKey;
        message = "services.chrona.settings.security.apiKey would expose a secret in the Nix store; set API_KEY through services.chrona.environmentFile instead.";
      }
    ];

    users.users = lib.mkIf (cfg.user == "chrona") {
      chrona = {
        isSystemUser = true;
        group = cfg.group;
        home = cfg.dataDir;
        createHome = true;
      };
    };

    users.groups = lib.mkIf (cfg.group == "chrona") {
      chrona = {};
    };

    networking.firewall.allowedTCPPorts = lib.optionals cfg.openFirewall [cfg.port];

    systemd.services.chrona = {
      description = "Chrona local AI task server";
      preStart = ''
        install -d -m 0700 ${lib.escapeShellArg (toString cfg.dataDir)} ${lib.escapeShellArg (toString cfg.configDir)}
      '';
      wantedBy = ["multi-user.target"];
      after = ["network.target"];
      environment = cfg.environment // {
        CHRONA_CONFIG_DIR = toString cfg.configDir;
        CHRONA_CONFIG_FILE = configFile;
        CHRONA_DATA_DIR = toString cfg.dataDir;
        CHRONA_NO_OPEN = "1";
        CHRONA_UNSAFE_PUBLIC_BIND = lib.boolToString cfg.unsafePublicBind;
      };
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${lib.getExe cfg.package} start --host ${lib.escapeShellArg cfg.host} --port ${toString cfg.port} --no-open";
        EnvironmentFile = cfg.environmentFile;
        Restart = "on-failure";
        RestartSec = 5;
        StateDirectory = lib.mkIf (cfg.dataDir == "/var/lib/chrona") "chrona";
        UMask = "0077";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [
          (toString cfg.dataDir)
          (toString cfg.configDir)
        ];
      };
    };
  };
}
