{self}: {
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.chrona;
  defaultPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.chrona;
  configRelativePath = "chrona/config.json";
  configPath = "${config.xdg.configHome}/${configRelativePath}";
  hasStoreApiKey =
    cfg.settings ? security
    && cfg.settings.security ? apiKey
    && cfg.settings.security.apiKey != null;
  environment = cfg.environment // {
    CHRONA_CONFIG_DIR = cfg.configDir;
    CHRONA_CONFIG_FILE = configPath;
    CHRONA_DATA_DIR = cfg.dataDir;
    CHRONA_NO_OPEN = "1";
    CHRONA_UNSAFE_PUBLIC_BIND = lib.boolToString cfg.unsafePublicBind;
  };
in {
  options.services.chrona = {
    enable = lib.mkEnableOption "Chrona local AI task server";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression "self.packages.\${pkgs.stdenv.hostPlatform.system}.chrona";
      description = "Chrona package to install and run.";
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

    unsafePublicBind = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Allow Chrona to bind to a non-loopback address. Enable only with suitable access controls.";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.xdg.dataHome}/chrona";
      description = "Persistent data directory used for the Chrona SQLite database.";
    };

    configDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.xdg.configHome}/chrona";
      description = "Writable directory used for Chrona runtime configuration files.";
    };

    settings = lib.mkOption {
      type = (pkgs.formats.json {}).type;
      default = {};
      example = {
        experimental.dashboardAiSummary = true;
      };
      description = "Chrona config.json contents. Do not place secrets here because the Nix store is world-readable.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      example = {TZ = "Asia/Shanghai";};
      description = "Additional environment variables for Chrona. Do not use this for secrets in shared configurations.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      example = ["%h/.config/chrona/secrets.env"];
      description = "Environment files loaded by the Linux user service. Use these for API_KEY and other secrets.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !hasStoreApiKey;
        message = "services.chrona.settings.security.apiKey would expose a secret in the Nix store; set API_KEY through services.chrona.environmentFile instead.";
      }
      {
        assertion = pkgs.stdenv.isLinux || cfg.environmentFile == [];
        message = "services.chrona.environmentFile is currently supported only by the Linux systemd user service.";
      }
    ];

    home.packages = [cfg.package];

    xdg.configFile.${configRelativePath}.text = builtins.toJSON cfg.settings;

    systemd.user.services.chrona = lib.mkIf pkgs.stdenv.isLinux {
      Unit = {
        Description = "Chrona local AI task server";
        After = ["network.target"];
      };
      Service = {
        Environment = lib.mapAttrsToList (name: value: "${name}=${value}") environment;
        EnvironmentFile = cfg.environmentFile;
        ExecStart = "${lib.getExe cfg.package} start --host ${lib.escapeShellArg cfg.host} --port ${toString cfg.port} --no-open";
        Restart = "on-failure";
        RestartSec = 5;
        UMask = "0077";
      };
      Install.WantedBy = ["default.target"];
    };

    launchd.agents.chrona = lib.mkIf pkgs.stdenv.isDarwin {
      enable = true;
      config = {
        ProgramArguments = [
          (lib.getExe cfg.package)
          "start"
          "--host"
          cfg.host
          "--port"
          (toString cfg.port)
          "--no-open"
        ];
        EnvironmentVariables = environment;
        KeepAlive = true;
        ProcessType = "Interactive";
        RunAtLoad = true;
        StandardErrorPath = "${config.xdg.stateHome}/chrona/stderr.log";
        StandardOutPath = "${config.xdg.stateHome}/chrona/stdout.log";
      };
    };
  };
}
