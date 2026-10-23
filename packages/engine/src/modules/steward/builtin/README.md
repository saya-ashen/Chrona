# Built-in module release resources

Each built-in lives in a child directory containing `module.json`, its entry and tests.
The runtime registers these directories through the normal module build pipeline.
This directory is shipped as `resources/builtin` in binary releases.
