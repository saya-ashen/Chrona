import { join } from "node:path";

export type DemoArtifactPaths = {
  artifactsDir: string;
  playwrightOutputDir: string;
  palettePath: string;
  gifPath: string;
};

export type GifCommandSet = {
  palette: string[];
  gif: string[];
};

export function createDemoArtifactPaths(repoRoot: string): DemoArtifactPaths {
  return {
    artifactsDir: join(repoRoot, "artifacts", "demo"),
    playwrightOutputDir: join(repoRoot, "artifacts", "demo", "playwright"),
    palettePath: join(repoRoot, "artifacts", "demo", "chrona-readme-demo.palette.png"),
    gifPath: join(repoRoot, "docs", "assets", "demo", "chrona-readme-demo.gif"),
  };
}

export function buildGifCommands(options: {
  inputVideoPath: string;
  palettePath: string;
  outputGifPath: string;
  width?: number;
  fps?: number;
}): GifCommandSet {
  const width = options.width ?? 1280;
  const fps = options.fps ?? 12;
  const paletteFilter = `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`;
  const gifFilter = `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse`;

  return {
    palette: ["ffmpeg", "-y", "-i", options.inputVideoPath, "-vf", paletteFilter, options.palettePath],
    gif: [
      "ffmpeg",
      "-y",
      "-i",
      options.inputVideoPath,
      "-i",
      options.palettePath,
      "-filter_complex",
      gifFilter,
      options.outputGifPath,
    ],
  };
}

export function findRecordedVideo(files: string[]): string {
  const videos = files.filter((file) => file.endsWith(".webm") || file.endsWith(".mp4"));

  if (videos.length === 0) {
    throw new Error("No Playwright video found in the configured output directory.");
  }

  if (videos.length > 1) {
    throw new Error(
      `Expected exactly one Playwright video, but found ${videos.length}: ${videos.join(", ")}`,
    );
  }

  return videos[0];
}
